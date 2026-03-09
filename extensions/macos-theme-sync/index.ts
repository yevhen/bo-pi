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
const PID_FILE = "/tmp/pi-macos-theme.pid";

// ── JXA watcher script (runs inside osascript) ──────────

const JXA_WATCHER = `
ObjC.import('Cocoa');
ObjC.import('Foundation');

var stateFile = "${STATE_FILE}";

function isDark() {
	var style = $.NSUserDefaults.alloc.initWithSuiteName('NSGlobalDomain')
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

function getRunningWatcherPid(): number | null {
	try {
		const pidStr = fs.readFileSync(PID_FILE, "utf-8").trim();
		const pid = parseInt(pidStr, 10);
		if (!Number.isNaN(pid) && isProcessAlive(pid)) {
			return pid;
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

function readCurrentState(): "dark" | "light" {
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
	let lastState: "dark" | "light" | null = null;
	let themeMap: Record<string, string> = {};

	function resolvePiTheme(macosState: "dark" | "light", ctx: any): string {
		const mapped = themeMap[macosState];
		if (mapped) {
			const available = ctx.ui.getAllThemes() as { name: string }[];
			if (available.some((t: { name: string }) => t.name === mapped)) {
				return mapped;
			}
		}
		return macosState; // "dark" and "light" are built-in pi themes
	}

	function applyTheme(state: "dark" | "light", ctx: any) {
		if (state === lastState) return;
		lastState = state;
		const piTheme = resolvePiTheme(state, ctx);
		ctx.ui.setTheme(piTheme);
		updateStatus(ctx, state);
	}

	function updateStatus(
		ctx: { ui: { setStatus: (id: string, text: string | undefined) => void; theme: any } },
		state: "dark" | "light",
	) {
		const theme = ctx.ui.theme;
		const icon = state === "dark" ? "🌙" : "☀️";
		const mapped = themeMap[state];
		const label = mapped
			? theme.fg("dim", ` ${icon} ${state} → ${mapped}`)
			: theme.fg("dim", ` ${icon} ${state}`);
		ctx.ui.setStatus("macos-theme", label);
	}

	// ── Lifecycle ────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Only activate on macOS
		if (process.platform !== "darwin") return;

		// Skip if running inside Ghostty IDE (ghostty-ide-sync handles that)
		if (process.env.GHOSTTY_AGENT_PORT) return;

		// Load theme mapping
		themeMap = loadThemeMap();

		// Ensure the shared watcher is running
		ensureWatcherRunning();

		// Wait briefly for watcher to write initial state
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Apply initial theme
		const initialState = readCurrentState();
		applyTheme(initialState, ctx);

		// Watch for changes via fs.watch
		try {
			fileWatcher = fs.watch(STATE_FILE, () => {
				const newState = readCurrentState();
				applyTheme(newState, ctx);
			});

			fileWatcher.on("error", () => {
				// File may not exist yet; retry after a short delay
				fileWatcher?.close();
				fileWatcher = null;
				setTimeout(() => {
					ensureWatcherRunning();
					try {
						fileWatcher = fs.watch(STATE_FILE, () => {
							const newState = readCurrentState();
							applyTheme(newState, ctx);
						});
					} catch {
						// Give up on fs.watch — will still have correct initial state
					}
				}, 1000);
			});
		} catch {
			// fs.watch failed — state file may not exist yet, that's ok
		}
	});

	pi.on("session_shutdown", () => {
		if (fileWatcher) {
			fileWatcher.close();
			fileWatcher = null;
		}
		// Don't kill the watcher — other sessions may still use it.
		// It's a detached 3 MB process, harmless until reboot.
	});

	// ── Commands ─────────────────────────────────────────

	pi.registerCommand("macos-theme-map", {
		description: "Map macOS dark/light mode to specific pi themes",
		async handler(_args, ctx) {
			if (process.platform !== "darwin") {
				ctx.ui.notify("This command only works on macOS", "warning");
				return;
			}

			const currentState = readCurrentState();
			const allThemes = ctx.ui.getAllThemes() as { name: string }[];
			const themeNames = allThemes.map((t: { name: string }) => t.name);

			const currentMapping = themeMap[currentState];
			const currentPiTheme = resolvePiTheme(currentState, ctx);

			const options = themeNames.map((name: string) => {
				if (name === currentMapping) return `${name} ← current mapping`;
				if (!currentMapping && name === currentPiTheme) return `${name} ← active (default)`;
				return name;
			});

			const selected = await ctx.ui.select(
				`macOS is in ${currentState} mode. Map "${currentState}" → pi theme:`,
				options,
			);

			if (!selected) return;

			const cleanName = selected.replace(/ ← .*$/, "");

			// If selected theme matches the default, remove the mapping
			if (cleanName === currentState) {
				delete themeMap[currentState];
			} else {
				themeMap[currentState] = cleanName;
			}

			saveThemeMap(themeMap);

			// Apply immediately
			ctx.ui.setTheme(cleanName);
			lastState = currentState;
			updateStatus(ctx, currentState);

			ctx.ui.notify(`Mapped macOS "${currentState}" → pi "${cleanName}"`, "info");
		},
	});
}
