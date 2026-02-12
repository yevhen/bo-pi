import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	SESSION_ENTRY_TYPE,
	formatApprovalMode,
	formatContextMessages,
	formatModelSetting,
	loadPersistentConfig,
	loadSessionOverrides,
	parseApprovalMode,
	parseContextValue,
	parseModelRef,
	savePersistentConfig,
} from "./config.js";
import { createDebugLogger } from "./logger.js";
import type { ConfigScope, PreflightConfig } from "./types.js";
import { notify } from "./ui.js";
import { buildPreflightMetadata } from "./preflight.js";
import { handlePreflightFailure } from "./approvals/failure.js";
import { collectApprovals, buildAllowAllApprovals, buildBlockAllApprovals } from "./approvals/index.js";
import { loadPermissionsState } from "./permissions/state.js";
import { resolveToolDecisions } from "./permissions/decisions.js";

let persistentConfig = loadPersistentConfig();
let sessionOverride: Partial<PreflightConfig> = {};

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		refreshConfigs(ctx);
	});

	pi.on("session_switch", (_event, ctx) => {
		refreshConfigs(ctx);
	});

	pi.registerCommand("preflight", {
		description: "Configure tool preflight approvals",
		handler: async (args, ctx) => {
			await handlePreflightCommand(args, ctx, pi);
		},
	});

	pi.on("tool_calls_batch", async (event, ctx) => {
		const activeConfig = getActiveConfig();
		const logDebug = createDebugLogger(ctx, activeConfig);
		const permissions = loadPermissionsState(ctx.cwd, logDebug);
		const hasRules =
			permissions.rules.allow.length > 0 ||
			permissions.rules.ask.length > 0 ||
			permissions.rules.deny.length > 0 ||
			permissions.policyRules.length > 0;
		if (activeConfig.approvalMode === "off" && !hasRules) {
			return undefined;
		}

		logDebug(`Preflight batch: ${event.toolCalls.length} tool call${event.toolCalls.length === 1 ? "" : "s"}.`);

		let preflightResult = await buildPreflightMetadata(event, ctx, activeConfig, logDebug);
		while (preflightResult.status === "error") {
			const decision = await handlePreflightFailure(event.toolCalls, preflightResult.reason, ctx, logDebug);
			if (decision.action === "retry") {
				preflightResult = await buildPreflightMetadata(event, ctx, activeConfig, logDebug);
				continue;
			}
			if (decision.action === "allow") {
				const approvals = buildAllowAllApprovals(event.toolCalls);
				return { approvals };
			}
			const approvals = buildBlockAllApprovals(event.toolCalls, decision.reason);
			return { approvals };
		}

		const preflight = preflightResult.metadata;
		const decisions = await resolveToolDecisions(event, preflight, ctx, activeConfig, permissions, logDebug);
		const approvals = await collectApprovals(
			event,
			preflight,
			decisions,
			ctx,
			activeConfig,
			logDebug,
		);
		if (approvals && Object.keys(approvals).length > 0) {
			logDebug(`Preflight approvals collected for ${Object.keys(approvals).length} tool call(s).`);
		}
		return { preflight, approvals };
	});
}

function refreshConfigs(ctx: ExtensionContext): void {
	persistentConfig = loadPersistentConfig();
	sessionOverride = loadSessionOverrides(ctx);
}

function getActiveConfig(): PreflightConfig {
	return { ...persistentConfig, ...sessionOverride };
}

function getConfigForScope(scope: ConfigScope): PreflightConfig {
	if (scope === "persistent") {
		return { ...persistentConfig };
	}
	return { ...persistentConfig, ...sessionOverride };
}

async function handlePreflightCommand(args: string, ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	const trimmed = args.trim();
	if (!trimmed) {
		if (!ctx.hasUI) return;
		await openConfigMenu(ctx, pi);
		return;
	}

	const parts = trimmed.split(/\s+/);
	const action = parts[0]?.toLowerCase();
	const scope = parseScope(parts);

	if (action === "status") {
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "on" || action === "off") {
		applyConfig({ approvalMode: action === "on" ? "all" : "off" }, scope, pi, ctx);
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "context") {
		const rawValue = parts.slice(1).join(" ");
		const parsed = parseContextValue(rawValue);
		if (parsed === undefined) {
			notify(ctx, "Invalid explain context value. Use 'full' or a positive number.");
			return;
		}
		applyConfig({ contextMessages: parsed }, scope, pi, ctx);
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "model") {
		const modelRef = parseModelRef(parts.slice(1));
		if (!modelRef) {
			notify(ctx, "Invalid model. Use 'current' or 'provider/model-id'.");
			return;
		}
		applyConfig({ model: modelRef }, scope, pi, ctx);
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "policy-model") {
		const modelRef = parseModelRef(parts.slice(1));
		if (!modelRef) {
			notify(ctx, "Invalid policy model. Use 'current' or 'provider/model-id'.");
			return;
		}
		applyConfig({ policyModel: modelRef }, scope, pi, ctx);
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "approvals" || action === "approval") {
		const mode = parseApprovalMode(parts.slice(1));
		if (!mode) {
			notify(ctx, "Invalid mode. Use 'all', 'destructive', or 'off'.");
			return;
		}
		applyConfig({ approvalMode: mode }, scope, pi, ctx);
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "destructive-only") {
		const setting = parts[1]?.toLowerCase();
		if (setting !== "on" && setting !== "off") {
			notify(ctx, "Invalid approval setting. Use 'on' or 'off'.");
			return;
		}
		applyConfig({ approvalMode: setting === "on" ? "destructive" : "all" }, scope, pi, ctx);
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "debug") {
		const setting = parts[1]?.toLowerCase();
		if (setting !== "on" && setting !== "off") {
			notify(ctx, "Invalid debug setting. Use 'on' or 'off'.");
			return;
		}
		applyConfig({ debug: setting === "on" }, scope, pi, ctx);
		showStatus(ctx, getActiveConfig());
		return;
	}

	if (action === "reset-session") {
		clearSessionOverrides(pi);
		showStatus(ctx, getActiveConfig());
		return;
	}

	notify(ctx, "Unknown command. Use /preflight for the interactive menu.");
}

async function openConfigMenu(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	if (!ctx.hasUI) return;

	while (true) {
		const options = [
			{
				key: "session",
				label: sessionOverrideExists()
					? "Session settings (overrides active)"
					: "Session settings",
			},
			{
				key: "persistent",
				label: "Default settings",
			},
			{
				key: "clear-session",
				label: sessionOverrideExists()
					? "Clear session overrides"
					: "Clear session overrides (none)",
			},
			{
				key: "status",
				label: "Show status",
			},
			{
				key: "exit",
				label: "Exit",
			},
		];

		const selection = await ctx.ui.select("Preflight settings", options.map((option) => option.label));
		if (!selection) return;

		const selected = options.find((option) => option.label === selection);
		if (!selected) return;

		switch (selected.key) {
			case "session":
				await openScopedConfigMenu(ctx, pi, "session");
				break;
			case "persistent":
				await openScopedConfigMenu(ctx, pi, "persistent");
				break;
			case "clear-session": {
				if (!sessionOverrideExists()) {
					notify(ctx, "No session overrides to clear.");
					break;
				}
				const confirm = await ctx.ui.confirm("Clear session overrides", "Reset session-only settings?");
				if (!confirm) break;
				clearSessionOverrides(pi);
				showStatus(ctx, getActiveConfig());
				break;
			}
			case "status":
				showStatus(ctx, getActiveConfig());
				break;
			case "exit":
				return;
			default:
				return;
		}
	}
}

async function openScopedConfigMenu(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	scope: ConfigScope,
): Promise<void> {
	if (!ctx.hasUI) return;

	const title = scope === "session" ? "Session settings" : "Default settings";

	while (true) {
		const scopedConfig = getConfigForScope(scope);
		const options = [
			{
				key: "mode",
				label: `Mode: ${formatApprovalMode(scopedConfig.approvalMode)}`,
			},
			{
				key: "context",
				label: `Explain context: ${formatContextMessages(scopedConfig.contextMessages)}`,
			},
			{
				key: "model",
				label: `Model: ${formatModelSetting(scopedConfig.model, ctx.model)}`,
			},
			{
				key: "policy-model",
				label: `Policy model: ${formatModelSetting(scopedConfig.policyModel, ctx.model)}`,
			},
			{
				key: "debug",
				label: `Debug: ${scopedConfig.debug ? "on" : "off"}`,
			},
			{
				key: "back",
				label: "Back",
			},
		];

		const selection = await ctx.ui.select(title, options.map((option) => option.label));
		if (!selection) return;

		const selected = options.find((option) => option.label === selection);
		if (!selected) return;

		switch (selected.key) {
			case "mode": {
				const mode = await chooseApprovalMode(ctx, scopedConfig.approvalMode);
				if (!mode) return;
				applyConfig({ approvalMode: mode }, scope, pi, ctx);
				showStatus(ctx, getActiveConfig());
				break;
			}
			case "context": {
				const selection = await ctx.ui.select("Explain context", ["Full context", "Last N messages"]);
				if (!selection) return;
				if (selection.startsWith("Full")) {
					applyConfig({ contextMessages: -1 }, scope, pi, ctx);
					showStatus(ctx, getActiveConfig());
					break;
				}

				const fallbackValue = scopedConfig.contextMessages > 0 ? String(scopedConfig.contextMessages) : "1";
				const input = await ctx.ui.input("Last N messages (1 or more)", fallbackValue);
				if (!input) return;
				const value = Number(input.trim());
				if (!Number.isFinite(value) || value < 1) {
					notify(ctx, "Invalid value. Use a number greater than 0.");
					continue;
				}
				applyConfig({ contextMessages: Math.floor(value) }, scope, pi, ctx);
				showStatus(ctx, getActiveConfig());
				break;
			}
			case "model": {
				const selectionModel = await chooseModel(ctx, scopedConfig.model, "Preflight model");
				if (!selectionModel) return;
				applyConfig({ model: selectionModel }, scope, pi, ctx);
				showStatus(ctx, getActiveConfig());
				break;
			}
			case "policy-model": {
				const selectionModel = await chooseModel(ctx, scopedConfig.policyModel, "Policy model");
				if (!selectionModel) return;
				applyConfig({ policyModel: selectionModel }, scope, pi, ctx);
				showStatus(ctx, getActiveConfig());
				break;
			}
			case "debug": {
				applyConfig({ debug: !scopedConfig.debug }, scope, pi, ctx);
				showStatus(ctx, getActiveConfig());
				break;
			}
			case "back":
				return;
			default:
				return;
		}
	}
}

function parseScope(args: string[]): ConfigScope {
	const lower = args.map((part) => part.toLowerCase());
	if (lower.includes("--persistent") || lower.includes("persistent") || lower.includes("--persist")) {
		return "persistent";
	}
	return "session";
}

async function chooseModel(
	ctx: ExtensionContext,
	currentModel: PreflightConfig["model"],
	title: string,
): Promise<PreflightConfig["model"] | undefined> {
	if (!ctx.hasUI) return currentModel;

	const mode = await ctx.ui.select(title, [
		`Use current model (${formatModelSetting("current", ctx.model)})`,
		"Pick from available models",
		"Enter provider/model",
	]);
	if (!mode) return undefined;

	if (mode.startsWith("Use current")) {
		return "current";
	}

	if (mode.startsWith("Pick")) {
		const models = ctx.modelRegistry.getAvailable();
		if (models.length === 0) {
			notify(ctx, "No available models with API keys configured.");
			return undefined;
		}
		const labels = models.map((model) => `${model.provider}/${model.id}`);
		const selected = await ctx.ui.select("Select model", labels);
		if (!selected) return undefined;
		const [provider, id] = selected.split("/");
		if (!provider || !id) return undefined;
		return { provider, id };
	}

	const input = await ctx.ui.input("Enter provider/model", formatModelSetting(currentModel, ctx.model));
	if (!input) return undefined;
	return parseModelRef([input]);
}

async function chooseApprovalMode(
	ctx: ExtensionContext,
	currentMode: PreflightConfig["approvalMode"],
): Promise<PreflightConfig["approvalMode"] | undefined> {
	if (!ctx.hasUI) return currentMode;

	const options = [
		{
			value: "all" as const,
			label: currentMode === "all" ? "All tools (current)" : "All tools",
		},
		{
			value: "destructive" as const,
			label: currentMode === "destructive" ? "Destructive only (current)" : "Destructive only",
		},
		{
			value: "off" as const,
			label: currentMode === "off" ? "Off (current)" : "Off",
		},
	];

	const selection = await ctx.ui.select("Preflight mode", options.map((option) => option.label));
	if (!selection) return undefined;

	return options.find((option) => option.label === selection)?.value;
}

function applyConfig(
	update: Partial<PreflightConfig>,
	scope: ConfigScope,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): void {
	if (scope === "persistent") {
		persistentConfig = { ...persistentConfig, ...update };
		savePersistentConfig(persistentConfig);
	} else {
		sessionOverride = { ...sessionOverride, ...update };
		pi.appendEntry(SESSION_ENTRY_TYPE, { config: sessionOverride });
	}
	notify(ctx, "Preflight settings updated.");
}

function clearSessionOverrides(pi: ExtensionAPI): void {
	sessionOverride = {};
	pi.appendEntry(SESSION_ENTRY_TYPE, { config: null });
}

function sessionOverrideExists(): boolean {
	return Object.keys(sessionOverride).length > 0;
}

function showStatus(ctx: ExtensionContext, config: PreflightConfig): void {
	const lines = [
		`Mode: ${formatApprovalMode(config.approvalMode)}`,
		`Explain context: ${formatContextMessages(config.contextMessages)}`,
		`Model: ${formatModelSetting(config.model, ctx.model)}`,
		`Policy model: ${formatModelSetting(config.policyModel, ctx.model)}`,
		`Debug: ${config.debug ? "on" : "off"}`,
		`Scope: ${sessionOverrideExists() ? "session override" : "persistent"}`,
	];

	notify(ctx, lines.join("\n"));
}
