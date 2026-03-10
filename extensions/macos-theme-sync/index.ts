/**
 * macOS Theme Sync — pi extension
 *
 * Instantly syncs pi's theme when macOS switches between dark and light mode.
 * Uses a single shared osascript watcher process across all pi sessions —
 * zero polling, zero npm dependencies, event-driven via NSDistributedNotificationCenter.
 *
 * Architecture:
 *   osascript (1 process, detached)
 *     → writes "dark" or "light" to /tmp/pi-macos-theme on every change
 *   pi session 1 ─── fs.watch() ──→ ctx.ui.setTheme()
 *   pi session 2 ─── fs.watch() ──→ ctx.ui.setTheme()
 *   pi session N ─── fs.watch() ──→ ctx.ui.setTheme()
 *
 * Features:
 *   - Event-driven (no polling) — reacts within milliseconds
 *   - Single watcher shared by all pi sessions (~3 MB RAM, 0% CPU)
 *   - Theme mapping: macOS dark → any pi theme (configurable)
 *   - `/macos-theme-map` command to configure mapping interactively
 *   - Zero dependencies — uses osascript (JXA) built into every Mac
 *   - Works in any terminal (iTerm2, Terminal.app, Kitty, Alacritty, etc.)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const STATE_FILE = "/tmp/pi-macos-theme";
const STATE_DIR = path.dirname(STATE_FILE);
const STATE_FILE_NAME = path.basename(STATE_FILE);
const PID_FILE = "/tmp/pi-macos-theme.pid";
const WATCH_RETRY_MS = 1000;

type ThemeState = "dark" | "light";

interface PiTheme {
	name: string;
}

interface ThemeUi {
	theme: { fg: (token: string, text: string) => string };
	setTheme: (themeName: string) => void;
	setStatus: (id: string, text: string | undefined) => void;
	notify: (message: string, level: "info" | "warning" | "error") => void;
	select: (title: string, options: string[]) => Promise<string | undefined>;
	getAllThemes: () => PiTheme[];
}

interface ThemeContext {
	ui: ThemeUi;
}

// ── JXA watcher script (runs inside osascript) ──────────

const JXA_WATCHER = `
ObjC.import('Cocoa');
ObjC.import('Foundation');

var stateFile = "${STATE_FILE}";

function isDark() {
	var style = $.NSUserDefaults.standardUserDefaults
		.stringForKey('AppleInterfaceStyle');
	return (style && style.js === 'Dark');
}

function writeState() {
	var state = isDark() ? 'dark' : 'light';
	var str = $.NSString.alloc.initWithUTF8String(state);
	str.writeToFileAtomicallyEncodingError(
		stateFile, true, $.NSUTF8StringEncoding, null
	);
}

// Write initial state
writeState();

// Subscribe to appearance change notification
ObjC.registerSubclass({
	name: 'PiThemeWatcher' + $.NSProcessInfo.processInfo.processIdentifier,
	methods: {
		'themeChanged:': {
			types: ['void', ['id']],
			implementation: function(notification) {
				writeState();
			}
		}
	}
});

var className = 'PiThemeWatcher' + $.NSProcessInfo.processInfo.processIdentifier;
var handler = $.NSClassFromString(className).new;
$.NSDistributedNotificationCenter.defaultCenter
	.addObserverSelectorNameObject(
		handler,
		'themeChanged:',
		'AppleInterfaceThemeChangedNotification',
		$.nil
	);

// Keep alive
var runLoop = $.NSRunLoop.currentRunLoop;
while (true) {
	runLoop.runModeBeforeDate(
		$.NSDefaultRunLoopMode,
		$.NSDate.dateWithTimeIntervalSinceNow(60.0)
	);
}
`;

// ── Shared watcher management ────────────────────────────

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function isExpectedWatcherProcess(pid: number): boolean {
	if (!isProcessAlive(pid)) {
		return false;
	}

	try {
		const command = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8" }).trim();
		return command.includes("osascript") && command.includes("JavaScript");
	} catch {
		return false;
	}
}

function getRunningWatcherPid(): number | null {
	try {
		const pidStr = fs.readFileSync(PID_FILE, "utf-8").trim();
		const pid = parseInt(pidStr, 10);
		if (!Number.isNaN(pid) && isExpectedWatcherProcess(pid)) {
			return pid;
		}

		// PID file points to stale/unexpected process → remove it
		try {
			fs.unlinkSync(PID_FILE);
		} catch {
			// Best effort
		}
	} catch {
		// PID file doesn't exist or can't be read
	}
	return null;
}

function ensureWatcherRunning(): void {
	if (getRunningWatcherPid() !== null) {
		return; // Already running
	}

	const child = spawn("osascript", ["-l", "JavaScript", "-e", JXA_WATCHER], {
		detached: true,
		stdio: "ignore",
	});

	child.unref();

	if (child.pid) {
		try {
			fs.writeFileSync(PID_FILE, String(child.pid) + "\n", "utf-8");
		} catch {
			// Best effort
		}
	}
}

function readCurrentState(): ThemeState {
	try {
		const content = fs.readFileSync(STATE_FILE, "utf-8").trim();
		if (content === "dark" || content === "light") {
			return content;
		}
	} catch {
		// File doesn't exist yet — detect directly
	}

	// Fallback: direct query
	try {
		execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", { encoding: "utf-8" });
		return "dark";
	} catch {
		return "light";
	}
}

// ── Theme Mapping ────────────────────────────────────────

function getThemeMapPath(): string {
	const agentDir = process.env.PI_AGENT_DIR || path.join(process.env.HOME || "~", ".pi", "agent");
	return path.join(agentDir, "extensions", "macos-theme-map.json");
}

function loadThemeMap(): Record<string, string> {
	try {
		const content = fs.readFileSync(getThemeMapPath(), "utf-8");
		const parsed = JSON.parse(content);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, string>;
		}
	} catch {
		// File doesn't exist or invalid JSON
	}
	return {};
}

function saveThemeMap(map: Record<string, string>): void {
	const mapPath = getThemeMapPath();
	const dir = path.dirname(mapPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n", "utf-8");
}

// ── Extension ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let fileWatcher: fs.FSWatcher | null = null;
	let watchRetryTimer: ReturnType<typeof setTimeout> | null = null;
	let lastState: ThemeState | null = null;
	let themeMap: Record<string, string> = {};

	function resolvePiTheme(macosState: ThemeState, ctx: ThemeContext): string {
		const mapped = themeMap[macosState];
		if (mapped) {
			const available = ctx.ui.getAllThemes();
			if (available.some((theme) => theme.name === mapped)) {
				return mapped;
			}
		}
		return macosState; // "dark" and "light" are built-in pi themes
	}

	function updateStatus(ctx: ThemeContext, state: ThemeState) {
		const theme = ctx.ui.theme;
		const icon = state === "dark" ? "🌙" : "☀️";
		const label = theme.fg("dim", ` ${icon}`);
		ctx.ui.setStatus("macos-theme", label);
	}

	function applyTheme(state: ThemeState, ctx: ThemeContext) {
		if (state === lastState) return;
		lastState = state;
		const piTheme = resolvePiTheme(state, ctx);
		ctx.ui.setTheme(piTheme);
		updateStatus(ctx, state);
	}

	function stopWatchingStateFile(): void {
		if (fileWatcher) {
			fileWatcher.close();
			fileWatcher = null;
		}
	}

	function clearRetryTimer(): void {
		if (watchRetryTimer) {
			clearTimeout(watchRetryTimer);
			watchRetryTimer = null;
		}
	}

	function scheduleWatchRetry(ctx: ThemeContext): void {
		clearRetryTimer();
		watchRetryTimer = setTimeout(() => {
			watchRetryTimer = null;
			ensureWatcherRunning();
			startStateWatcher(ctx);
		}, WATCH_RETRY_MS);
	}

	function startStateWatcher(ctx: ThemeContext): void {
		stopWatchingStateFile();

		try {
			fileWatcher = fs.watch(STATE_DIR, (_eventType, filename) => {
				if (!filename) {
					applyTheme(readCurrentState(), ctx);
					return;
				}

				const changedFile = typeof filename === "string" ? filename : filename.toString("utf-8");
				if (changedFile !== STATE_FILE_NAME) {
					return;
				}

				applyTheme(readCurrentState(), ctx);
			});

			fileWatcher.on("error", () => {
				stopWatchingStateFile();
				scheduleWatchRetry(ctx);
			});
		} catch {
			scheduleWatchRetry(ctx);
		}
	}

	// ── Lifecycle ────────────────────────────────────────

	pi.on("session_start", (_event, ctx) => {
		// Only activate on macOS
		if (process.platform !== "darwin") return;

		// Skip if running inside Ghostty IDE (ghostty-ide-sync handles that)
		if (process.env.GHOSTTY_AGENT_PORT) return;

		// Load theme mapping
		themeMap = loadThemeMap();

		// Ensure the shared watcher is running
		ensureWatcherRunning();

		// Apply initial theme immediately (with defaults fallback)
		applyTheme(readCurrentState(), ctx as ThemeContext);

		// Watch state file updates
		startStateWatcher(ctx as ThemeContext);
	});

	pi.on("session_shutdown", () => {
		clearRetryTimer();
		stopWatchingStateFile();
		// Don't kill the watcher — other sessions may still use it.
		// It's a detached 3 MB process, harmless until reboot.
	});

	// ── Commands ─────────────────────────────────────────

	pi.registerCommand("macos-theme-map", {
		description: "Configure macOS dark/light mode mappings in one flow",
		async handler(_args, ctx) {
			if (process.platform !== "darwin") {
				ctx.ui.notify("This command only works on macOS", "warning");
				return;
			}

			const themeCtx = ctx as ThemeContext;
			const allThemes = themeCtx.ui.getAllThemes();
			const themeNames = allThemes.map((theme) => theme.name);

			const buildOptions = (state: ThemeState): string[] => {
				const currentMapping = themeMap[state];
				const currentPiTheme = resolvePiTheme(state, themeCtx);
				return themeNames.map((name) => {
					if (name === currentMapping) return `${name} ← current mapping`;
					if (!currentMapping && name === currentPiTheme) return `${name} ← active (default)`;
					return name;
				});
			};

			const darkSelected = await themeCtx.ui.select(
				'Map macOS "dark" → pi theme:',
				buildOptions("dark"),
			);
			if (!darkSelected) {
				themeCtx.ui.notify("Mapping update cancelled", "warning");
				return;
			}

			const lightSelected = await themeCtx.ui.select(
				'Map macOS "light" → pi theme:',
				buildOptions("light"),
			);
			if (!lightSelected) {
				themeCtx.ui.notify("Mapping update cancelled", "warning");
				return;
			}

			const darkTheme = darkSelected.replace(/ ← .*$/, "");
			const lightTheme = lightSelected.replace(/ ← .*$/, "");

			themeMap.dark = darkTheme;
			themeMap.light = lightTheme;
			saveThemeMap(themeMap);

			// Re-apply current macOS state using updated mapping
			lastState = null;
			applyTheme(readCurrentState(), themeCtx);

			themeCtx.ui.notify(`Updated mappings: dark → ${darkTheme}, light → ${lightTheme}`, "info");
		},
	});
}
