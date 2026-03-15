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
const RECONCILE_INTERVAL_MS = 5000;
const DEBUG_LOG_FILE = "macos-theme-sync.log";
const DEBUG_ENV_VARS = ["PI_MACOS_THEME_SYNC_DEBUG", "BO_PI_MACOS_THEME_SYNC_DEBUG"] as const;

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
		logDebug(`Watcher pid ${pid} is not alive.`);
		return false;
	}

	try {
		const command = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8" }).trim();
		const matches = command.includes("osascript") && command.includes("JavaScript");
		logDebug(`Watcher pid ${pid} command check: ${matches ? "ok" : "unexpected"}. Command: ${command}`);
		return matches;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logDebug(`Failed to inspect watcher pid ${pid}: ${errorMessage}`);
		return false;
	}
}

function getRunningWatcherPid(): number | null {
	try {
		const pidStr = fs.readFileSync(PID_FILE, "utf-8").trim();
		const pid = parseInt(pidStr, 10);
		if (!Number.isNaN(pid) && isExpectedWatcherProcess(pid)) {
			logDebug(`Using existing watcher pid ${pid}.`);
			return pid;
		}

		logDebug(`Removing stale watcher pid file: ${pidStr}`);
		// PID file points to stale/unexpected process → remove it
		try {
			fs.unlinkSync(PID_FILE);
		} catch {
			// Best effort
		}
	} catch {
		logDebug("No valid watcher pid file found.");
		// PID file doesn't exist or can't be read
	}
	return null;
}

function ensureWatcherRunning(): void {
	if (getRunningWatcherPid() !== null) {
		return; // Already running
	}

	logDebug("Starting shared macOS theme watcher.");
	const child = spawn("osascript", ["-l", "JavaScript", "-e", JXA_WATCHER], {
		detached: true,
		stdio: "ignore",
	});

	child.unref();

	if (child.pid) {
		try {
			fs.writeFileSync(PID_FILE, String(child.pid) + "\n", "utf-8");
			logDebug(`Started watcher pid ${child.pid}.`);
		} catch {
			logDebug(`Started watcher pid ${child.pid}, but failed to write pid file.`);
		}
	} else {
		logDebug("Spawned watcher process without a pid.");
	}
}

function readStateFile(): ThemeState | null {
	try {
		const content = fs.readFileSync(STATE_FILE, "utf-8").trim();
		if (content === "dark" || content === "light") {
			return content;
		}
		logDebug(`Ignored unexpected state file value: ${content}`);
	} catch {
		// Missing/unreadable is expected during startup.
	}
	return null;
}

function readSystemState(): ThemeState {
	try {
		execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", { encoding: "utf-8" });
		return "dark";
	} catch {
		return "light";
	}
}

function writeStateFile(state: ThemeState): void {
	try {
		fs.writeFileSync(STATE_FILE, `${state}\n`, "utf-8");
		logDebug(`Wrote reconciled state file value: ${state}`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logDebug(`Failed to write reconciled state file: ${errorMessage}`);
	}
}

function readCurrentState(): ThemeState {
	return readStateFile() ?? readSystemState();
}

// ── Theme Mapping ────────────────────────────────────────

function getAgentExtensionsDir(): string {
	const agentDir = process.env.PI_AGENT_DIR || path.join(process.env.HOME || "~", ".pi", "agent");
	return path.join(agentDir, "extensions");
}

function getThemeMapPath(): string {
	return path.join(getAgentExtensionsDir(), "macos-theme-map.json");
}

function getDebugLogPath(): string {
	return path.join(getAgentExtensionsDir(), DEBUG_LOG_FILE);
}

function isDebugEnabled(): boolean {
	return DEBUG_ENV_VARS.some((name) => {
		const value = process.env[name]?.trim().toLowerCase();
		return value === "1" || value === "true" || value === "yes" || value === "on";
	});
}

function logDebug(message: string): void {
	if (!isDebugEnabled()) {
		return;
	}
	const line = `[${new Date().toISOString()}] ${message}\n`;
	try {
		fs.mkdirSync(getAgentExtensionsDir(), { recursive: true });
		fs.appendFileSync(getDebugLogPath(), line, "utf-8");
	} catch {
		// Best effort
	}
}

function loadThemeMap(): Record<string, string> {
	try {
		const content = fs.readFileSync(getThemeMapPath(), "utf-8");
		const parsed = JSON.parse(content);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			logDebug(`Loaded theme map: ${JSON.stringify(parsed)}`);
			return parsed as Record<string, string>;
		}
		logDebug("Theme map file contained a non-object value; ignoring.");
	} catch {
		logDebug("No valid theme map file found; using defaults.");
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
	logDebug(`Saved theme map: ${JSON.stringify(map)}`);
}

// ── Extension ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let fileWatcher: fs.FSWatcher | null = null;
	let watchRetryTimer: ReturnType<typeof setTimeout> | null = null;
	let reconcileTimer: ReturnType<typeof setInterval> | null = null;
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
		if (state === lastState) {
			return;
		}
		lastState = state;
		const piTheme = resolvePiTheme(state, ctx);
		logDebug(`Applying macOS state ${state} -> pi theme ${piTheme}`);
		ctx.ui.setTheme(piTheme);
		updateStatus(ctx, state);
	}

	function stopWatchingStateFile(): void {
		if (fileWatcher) {
			logDebug("Stopping state file watcher.");
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

	function stopReconcileTimer(): void {
		if (reconcileTimer) {
			clearInterval(reconcileTimer);
			reconcileTimer = null;
		}
	}

	function reconcileState(ctx: ThemeContext): void {
		const systemState = readSystemState();
		const fileState = readStateFile();
		if (fileState !== systemState) {
			logDebug(
				`Reconciling stale theme state. system=${systemState} file=${fileState ?? "missing"}`,
			);
			writeStateFile(systemState);
		}
		applyTheme(systemState, ctx);
	}

	function startReconcileTimer(ctx: ThemeContext): void {
		stopReconcileTimer();
		logDebug(`Starting reconcile timer (${RECONCILE_INTERVAL_MS}ms).`);
		reconcileTimer = setInterval(() => {
			reconcileState(ctx);
		}, RECONCILE_INTERVAL_MS);
	}

	function scheduleWatchRetry(ctx: ThemeContext): void {
		clearRetryTimer();
		logDebug(`Scheduling state watcher retry in ${WATCH_RETRY_MS}ms.`);
		watchRetryTimer = setTimeout(() => {
			watchRetryTimer = null;
			ensureWatcherRunning();
			startStateWatcher(ctx);
		}, WATCH_RETRY_MS);
	}

	function startStateWatcher(ctx: ThemeContext): void {
		stopWatchingStateFile();

		try {
			logDebug(`Starting fs.watch on ${STATE_DIR} for ${STATE_FILE_NAME}.`);
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

			fileWatcher.on("error", (error) => {
				const errorMessage = error instanceof Error ? error.message : String(error);
				logDebug(`State watcher error: ${errorMessage}`);
				stopWatchingStateFile();
				scheduleWatchRetry(ctx);
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logDebug(`Failed to start state watcher: ${errorMessage}`);
			scheduleWatchRetry(ctx);
		}
	}

	// ── Lifecycle ────────────────────────────────────────

	pi.on("session_start", (_event, ctx) => {
		logDebug(`Session start. platform=${process.platform} ghosttyPort=${process.env.GHOSTTY_AGENT_PORT ?? "none"}`);
		// Only activate on macOS
		if (process.platform !== "darwin") {
			logDebug("Skipping macOS theme sync: non-darwin platform.");
			return;
		}

		// Skip if running inside Ghostty IDE (ghostty-ide-sync handles that)
		if (process.env.GHOSTTY_AGENT_PORT) {
			logDebug("Skipping macOS theme sync: Ghostty IDE sync is active.");
			return;
		}

		// Load theme mapping
		themeMap = loadThemeMap();

		// Ensure the shared watcher is running
		ensureWatcherRunning();

		const themeCtx = ctx as ThemeContext;

		// Apply initial theme from direct system state, not the potentially stale state file
		reconcileState(themeCtx);

		// Watch state file updates
		startStateWatcher(themeCtx);
		startReconcileTimer(themeCtx);
	});

	pi.on("session_shutdown", () => {
		logDebug("Session shutdown.");
		clearRetryTimer();
		stopReconcileTimer();
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

			logDebug(`Updating theme map via command: dark -> ${darkTheme}, light -> ${lightTheme}`);
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
