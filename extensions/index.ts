import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallsBatchEvent,
	ToolPreflightMetadata,
} from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { AssistantMessage, Context, Message, Model, TextContent } from "@mariozechner/pi-ai";

type ToolCallSummary = ToolCallsBatchEvent["toolCalls"][number];

type DebugLogger = (message: string) => void;

type ConfigScope = "session" | "persistent";

type ModelRef = { provider: string; id: string };

type ApprovalMode = "all" | "destructive" | "off";

interface PreflightConfig {
	contextMessages: number;
	model: "current" | ModelRef;
	approvalMode: ApprovalMode;
	debug: boolean;
}

interface SessionConfigEntryData {
	config?: unknown;
}

type PreflightAttempt =
	| { status: "ok"; metadata: Record<string, ToolPreflightMetadata> }
	| { status: "error"; reason: string };

type PreflightFailureDecision =
	| { action: "retry" }
	| { action: "allow" }
	| { action: "block"; reason: string };

const SESSION_ENTRY_TYPE = "bo-pi-config";
const ANSI_RESET = "\u001b[0m";
const ANSI_ACTION = "\u001b[38;5;110m";
const ANSI_DESTRUCTIVE = "\u001b[1;38;5;203m";
const ANSI_SCOPE_WARNING = "\u001b[38;5;222m";
const ANSI_MUTED = "\u001b[38;5;244m";
const DEFAULT_CONFIG: PreflightConfig = {
	contextMessages: 12,
	model: "current",
	approvalMode: "all",
	debug: false,
};

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
		if (activeConfig.approvalMode === "off") {
			return undefined;
		}

		const logDebug = createDebugLogger(ctx, activeConfig);
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
		const approvals = ctx.hasUI
			? await collectApprovals(event.toolCalls, preflight, ctx, activeConfig, logDebug)
			: undefined;
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
		const value = Number(parts[1]);
		if (!Number.isFinite(value) || value < 0) {
			notify(ctx, "Invalid context value. Use a non-negative number.");
			return;
		}
		applyConfig({ contextMessages: Math.floor(value) }, scope, pi, ctx);
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
				label: `Context messages: ${formatContextMessages(scopedConfig.contextMessages)}`,
			},
			{
				key: "model",
				label: `Model: ${formatModelSetting(scopedConfig.model, ctx.model)}`,
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
				const input = await ctx.ui.input(
					"Context messages (0 = full context)",
					String(scopedConfig.contextMessages),
				);
				if (!input) return;
				const value = Number(input.trim());
				if (!Number.isFinite(value) || value < 0) {
					notify(ctx, "Invalid context value. Use a non-negative number.");
					continue;
				}
				applyConfig({ contextMessages: Math.floor(value) }, scope, pi, ctx);
				showStatus(ctx, getActiveConfig());
				break;
			}
			case "model": {
				const selectionModel = await chooseModel(ctx, scopedConfig.model);
				if (!selectionModel) return;
				applyConfig({ model: selectionModel }, scope, pi, ctx);
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
): Promise<PreflightConfig["model"] | undefined> {
	if (!ctx.hasUI) return currentModel;

	const mode = await ctx.ui.select("Preflight model", [
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
	currentMode: ApprovalMode,
): Promise<ApprovalMode | undefined> {
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

function parseModelRef(parts: string[]): PreflightConfig["model"] | undefined {
	if (parts.length === 0) return undefined;
	const joined = parts.join(" ").trim();
	if (!joined) return undefined;
	if (joined === "current") return "current";

	const [provider, id] = joined.split("/");
	if (!provider || !id) return undefined;
	return { provider, id };
}

function parseApprovalMode(parts: string[]): ApprovalMode | undefined {
	const joined = parts.join(" ").trim().toLowerCase();
	if (!joined) return undefined;
	if (joined === "all" || joined === "all tools" || joined === "all-tools") return "all";
	if (
		joined === "destructive" ||
		joined === "destructive only" ||
		joined === "destructive-only"
	) {
		return "destructive";
	}
	if (joined === "off") return "off";
	return undefined;
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
		`Context messages: ${formatContextMessages(config.contextMessages)}`,
		`Model: ${formatModelSetting(config.model, ctx.model)}`,
		`Debug: ${config.debug ? "on" : "off"}`,
		`Scope: ${sessionOverrideExists() ? "session override" : "persistent"}`,
	];

	notify(ctx, lines.join("\n"));
}

function notify(ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, "info");
	}
}

function createDebugLogger(ctx: ExtensionContext, config: PreflightConfig): DebugLogger {
	if (!config.debug) {
		return () => {};
	}
	return (message) => {
		if (ctx.hasUI) {
			ctx.ui.notify(message, "info");
		} else {
			console.log(`[bo-pi] ${message}`);
		}
	};
}

async function buildPreflightMetadata(
	event: ToolCallsBatchEvent,
	ctx: ExtensionContext,
	config: PreflightConfig,
	logDebug: DebugLogger,
): Promise<PreflightAttempt> {
	const modelWithKey = await resolveModelWithApiKey(ctx, config);
	if (!modelWithKey) {
		const reason = "No model or API key available for preflight.";
		logDebug(`Preflight failed: ${reason}`);
		return { status: "error", reason };
	}

	const contextLabel = config.contextMessages <= 0 ? "full" : `last ${config.contextMessages}`;
	logDebug(`Preflight model: ${modelWithKey.model.provider}/${modelWithKey.model.id}.`);
	logDebug(`Preflight context: ${contextLabel} messages.`);

	const instruction = buildPreflightPrompt(event.toolCalls);
	const trimmedContext = limitContextMessages(event.llmContext.messages, config.contextMessages);
	const preflightContext: Context = {
		...event.llmContext,
		messages: [...trimmedContext, event.assistantMessage, createUserMessage(instruction)],
	};

	try {
		const response = await streamSimple(modelWithKey.model, preflightContext, { apiKey: modelWithKey.apiKey });
		for await (const _ of response) {
			// Drain stream to completion.
		}
		const result = await response.result();
		const text = extractText(result.content);
		if (!text) {
			const reason = "Preflight response was empty.";
			logDebug(`Preflight failed: ${reason}`);
			return { status: "error", reason };
		}
		const parsed = parsePreflightResponse(text);
		if (!parsed) {
			const reason = "Preflight response was not valid JSON.";
			logDebug(`Preflight failed: ${reason}`);
			return { status: "error", reason };
		}
		const normalized = normalizePreflight(parsed, event.toolCalls);
		if (!normalized) {
			const reason = "Preflight response did not include all tool calls.";
			logDebug(`Preflight failed: ${reason}`);
			return { status: "error", reason };
		}
		logDebug(`Preflight parsed ${Object.keys(normalized).length} tool call(s).`);
		return { status: "ok", metadata: normalized };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const reason = message ? `Preflight request failed: ${message}` : "Preflight request failed.";
		logDebug(`Preflight failed: ${reason}`);
		return { status: "error", reason };
	}
}

async function resolveModelWithApiKey(
	ctx: ExtensionContext,
	config: PreflightConfig,
): Promise<{ model: Model<any>; apiKey: string } | undefined> {
	const candidates: Model<any>[] = [];
	if (config.model === "current") {
		if (ctx.model) candidates.push(ctx.model);
	} else {
		const explicit = ctx.modelRegistry.find(config.model.provider, config.model.id);
		if (explicit) candidates.push(explicit);
		if (ctx.model && ctx.model !== explicit) candidates.push(ctx.model);
	}

	for (const model of candidates) {
		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (apiKey) return { model, apiKey };
	}

	return undefined;
}

function limitContextMessages(messages: Message[], limit: number): Message[] {
	if (!Number.isFinite(limit) || limit <= 0) return messages;
	if (messages.length <= limit) return messages;
	return messages.slice(-limit);
}

function buildPreflightPrompt(toolCalls: ToolCallSummary[]): string {
	return [
		"You are a tool preflight assistant.",
		"For each tool call, return JSON mapping toolCallId to:",
		"{ summary: string, destructive: boolean, scope?: string[] }.",
		"Summaries should be short, human-friendly action phrases.",
		"Return an entry for every tool call id.",
		"Do not mention tool names or raw arguments in the summary.",
		"destructive = true only if the call changes data or system state.",
		"Respond with JSON only (no markdown, no extra text).",
		"Tool calls:",
		JSON.stringify(toolCalls, null, 2),
	].join("\n");
}

function createUserMessage(text: string): Message {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

function extractText(content: AssistantMessage["content"]): string {
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function parsePreflightResponse(text: string): Record<string, ToolPreflightMetadata> | undefined {
	if (!text) return undefined;

	const cleaned = stripCodeFence(text.trim());
	const jsonText = extractJsonPayload(cleaned);
	if (!jsonText) return undefined;

	try {
		const parsed = JSON.parse(jsonText) as unknown;
		if (Array.isArray(parsed)) {
			return arrayToPreflight(parsed);
		}
		if (parsed && typeof parsed === "object") {
			return parsed as Record<string, ToolPreflightMetadata>;
		}
	} catch (error) {
		return undefined;
	}

	return undefined;
}

function arrayToPreflight(items: unknown[]): Record<string, ToolPreflightMetadata> | undefined {
	const result: Record<string, ToolPreflightMetadata> = {};
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const record = item as {
			id?: string;
			toolCallId?: string;
			summary?: string;
			destructive?: boolean;
			scope?: string[];
		};
		const id = record.toolCallId ?? record.id;
		if (!id || typeof id !== "string") continue;
		if (typeof record.summary !== "string" || typeof record.destructive !== "boolean") continue;
		result[id] = {
			summary: record.summary,
			destructive: record.destructive,
			scope: Array.isArray(record.scope) ? record.scope.filter((item) => typeof item === "string") : undefined,
		};
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function normalizePreflight(
	parsed: Record<string, ToolPreflightMetadata> | undefined,
	toolCalls: ToolCallSummary[],
): Record<string, ToolPreflightMetadata> | undefined {
	if (!parsed) return undefined;
	const result: Record<string, ToolPreflightMetadata> = {};
	for (const toolCall of toolCalls) {
		const entry = parsed[toolCall.id];
		if (!entry || typeof entry.summary !== "string" || typeof entry.destructive !== "boolean") {
			return undefined;
		}
		const summary = sanitizeSummary(entry.summary, toolCall) ?? entry.summary.trim();
		if (!summary) return undefined;

		result[toolCall.id] = {
			summary,
			destructive: entry.destructive,
			scope: Array.isArray(entry.scope) ? entry.scope.filter((item) => typeof item === "string") : undefined,
		};
	}

	return result;
}

function stripCodeFence(text: string): string {
	if (!text.startsWith("```")) return text;
	const firstNewline = text.indexOf("\n");
	if (firstNewline === -1) return text;
	const withoutFence = text.slice(firstNewline + 1);
	const closingFenceIndex = withoutFence.lastIndexOf("```");
	if (closingFenceIndex === -1) return withoutFence.trim();
	return withoutFence.slice(0, closingFenceIndex).trim();
}

function extractJsonPayload(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return trimmed;
	}
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		return trimmed.slice(firstBrace, lastBrace + 1);
	}
	const firstBracket = trimmed.indexOf("[");
	const lastBracket = trimmed.lastIndexOf("]");
	if (firstBracket !== -1 && lastBracket > firstBracket) {
		return trimmed.slice(firstBracket, lastBracket + 1);
	}
	return undefined;
}

async function collectApprovals(
	toolCalls: ToolCallSummary[],
	preflight: Record<string, ToolPreflightMetadata>,
	ctx: ExtensionContext,
	config: PreflightConfig,
	logDebug: DebugLogger,
): Promise<Record<string, { allow: boolean; reason?: string }> | undefined> {
	if (!ctx.hasUI) return undefined;

	if (config.approvalMode === "off") {
		logDebug("Mode off; skipping approvals.");
		return undefined;
	}

	const approvalTargets = toolCalls.filter((toolCall) => {
		if (config.approvalMode === "all") return true;
		if (config.approvalMode === "destructive") {
			const metadata = preflight[toolCall.id];
			return metadata?.destructive ?? false;
		}
		return false;
	});

	if (config.approvalMode === "destructive" && approvalTargets.length !== toolCalls.length) {
		logDebug(`Auto-approved ${toolCalls.length - approvalTargets.length} non-destructive tool call(s).`);
	}

	if (approvalTargets.length === 0) {
		logDebug("No tool calls require approval.");
		return undefined;
	}

	logDebug(`Requesting approvals for ${approvalTargets.length} tool call(s).`);

	const approvals: Record<string, { allow: boolean; reason?: string }> = {};

	for (const toolCall of approvalTargets) {
		const metadata = preflight[toolCall.id];
		const summary = metadata?.summary ?? "Review requested action";
		const destructive = metadata?.destructive ?? true;
		const scopeText = metadata?.scope?.length ? `Scope: ${metadata.scope.join(", ")}` : undefined;
		const scopeWarn = scopeText ? isScopeOutsideWorkspace(metadata?.scope ?? [], ctx.cwd) : false;
		const scopeLine = scopeText ? formatScopeLine(scopeText, scopeWarn) : undefined;
		const detailLines = [scopeLine].filter(Boolean);
		const details = detailLines.length > 0 ? `\n\n${detailLines.join("\n")}` : "";
		const message = `${formatActionLine(summary, destructive)}${details}`;
		const title = formatTitleLine("Agent wants to:");
		const allow = await ctx.ui.confirm(title, message);
		approvals[toolCall.id] = allow
			? { allow: true }
			: { allow: false, reason: "Blocked by user" };
	}

	return approvals;
}

function buildAllowAllApprovals(
	toolCalls: ToolCallSummary[],
): Record<string, { allow: boolean; reason?: string }> {
	const approvals: Record<string, { allow: boolean; reason?: string }> = {};
	for (const toolCall of toolCalls) {
		approvals[toolCall.id] = { allow: true };
	}
	return approvals;
}

function buildBlockAllApprovals(
	toolCalls: ToolCallSummary[],
	reason: string,
): Record<string, { allow: boolean; reason?: string }> {
	const approvals: Record<string, { allow: boolean; reason?: string }> = {};
	for (const toolCall of toolCalls) {
		approvals[toolCall.id] = { allow: false, reason };
	}
	return approvals;
}

async function handlePreflightFailure(
	toolCalls: ToolCallSummary[],
	reason: string,
	ctx: ExtensionContext,
	logDebug: DebugLogger,
): Promise<PreflightFailureDecision> {
	const toolList = formatToolCallList(toolCalls);
	const failureSummary = `Preflight failed: ${reason}`;
	const message = toolList ? `${failureSummary}\nTool calls: ${toolList}` : failureSummary;

	if (!ctx.hasUI) {
		console.warn(`[bo-pi] ${message}`);
		logDebug(message);
		return { action: "block", reason: failureSummary };
	}

	ctx.ui.notify(message, "warning");
	const selection = await ctx.ui.select("Preflight failed", [
		"Retry preflight",
		"Allow tool call(s) without preflight",
		"Block tool call(s)",
	]);

	if (!selection) {
		return { action: "block", reason: `${failureSummary} (no response from user).` };
	}
	if (selection.startsWith("Retry")) {
		return { action: "retry" };
	}
	if (selection.startsWith("Allow")) {
		return { action: "allow" };
	}
	return { action: "block", reason: `${failureSummary} (blocked by user).` };
}

function formatToolCallList(toolCalls: ToolCallSummary[]): string {
	return toolCalls.map((toolCall) => toolCall.name).join(", ");
}

function sanitizeSummary(summary: string | undefined, toolCall: ToolCallSummary): string | undefined {
	if (!summary) return undefined;
	let cleaned = summary.trim();
	if (!cleaned) return undefined;

	const patterns = [
		new RegExp(`^(run|use|execute)\\s+${escapeRegExp(toolCall.name)}\\b\\s+to\\s+`, "i"),
	];

	for (const pattern of patterns) {
		const updated = cleaned.replace(pattern, "").trim();
		if (updated && updated !== cleaned) {
			cleaned = updated;
			break;
		}
	}

	return cleaned ? capitalizeFirst(cleaned) : undefined;
}

function formatTitleLine(text: string): string {
	return `${ANSI_MUTED}${text}${ANSI_RESET}`;
}

function formatActionLine(text: string, destructive: boolean): string {
	const color = destructive ? ANSI_DESTRUCTIVE : ANSI_ACTION;
	return `${color}${text}${ANSI_RESET}`;
}

function formatScopeLine(text: string, warn: boolean): string {
	const color = warn ? ANSI_SCOPE_WARNING : ANSI_MUTED;
	return `${color}${text}${ANSI_RESET}`;
}

function isScopeOutsideWorkspace(scopes: string[], cwd: string): boolean {
	const basePath = resolve(cwd);
	for (const scope of scopes) {
		const resolvedScope = resolveScope(scope, cwd);
		if (!resolvedScope) continue;
		if (!isPathWithin(resolvedScope, basePath)) {
			return true;
		}
	}
	return false;
}

function resolveScope(scope: string, cwd: string): string | undefined {
	if (!scope) return undefined;
	const expanded = expandTilde(scope);
	const resolved = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
	return resolved;
}

function isPathWithin(targetPath: string, basePath: string): boolean {
	const normalizedTarget = resolve(targetPath);
	const normalizedBase = resolve(basePath);
	if (normalizedTarget === normalizedBase) return true;
	return normalizedTarget.startsWith(`${normalizedBase}${sep}`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalizeFirst(value: string): string {
	return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function formatApprovalMode(mode: ApprovalMode): string {
	switch (mode) {
		case "off":
			return "off";
		case "destructive":
			return "destructive only";
		case "all":
		default:
			return "all tools";
	}
}

function formatContextMessages(limit: number): string {
	if (limit <= 0) return "full";
	return String(limit);
}

function formatModelSetting(modelSetting: PreflightConfig["model"], currentModel?: Model<any>): string {
	if (modelSetting === "current") {
		if (currentModel) {
			return `current (${currentModel.provider}/${currentModel.id})`;
		}
		return "current";
	}
	return `${modelSetting.provider}/${modelSetting.id}`;
}

function loadPersistentConfig(): PreflightConfig {
	const filePath = getConfigFilePath();
	if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };

	try {
		const content = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		const config = parseConfig(parsed);
		return { ...DEFAULT_CONFIG, ...config };
	} catch (error) {
		return { ...DEFAULT_CONFIG };
	}
}

function savePersistentConfig(config: PreflightConfig): void {
	const filePath = getConfigFilePath();
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

function loadSessionOverrides(ctx: ExtensionContext): Partial<PreflightConfig> {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!isCustomEntry(entry)) continue;
		if (entry.customType !== SESSION_ENTRY_TYPE) continue;
		const data = entry.data as SessionConfigEntryData | undefined;
		if (!data || data.config === null) return {};
		return parseConfig(data.config);
	}
	return {};
}

function parseConfig(value: unknown): Partial<PreflightConfig> {
	if (!value || typeof value !== "object") return {};

	const record = value as Record<string, unknown>;
	const config: Partial<PreflightConfig> = {};

	if (typeof record.enabled === "boolean" && record.enabled === false) {
		config.approvalMode = "off";
	}

	if (typeof record.contextMessages === "number" && Number.isFinite(record.contextMessages)) {
		config.contextMessages = Math.max(0, Math.floor(record.contextMessages));
	}

	if (record.model === "current") {
		config.model = "current";
	} else if (isModelRef(record.model)) {
		config.model = record.model;
	}

	if (typeof record.approvalMode === "string") {
		const parsed = parseApprovalMode([record.approvalMode]);
		if (parsed) {
			config.approvalMode = parsed;
		}
	} else if (typeof record.approveDestructiveOnly === "boolean") {
		config.approvalMode = record.approveDestructiveOnly ? "destructive" : "all";
	}

	if (typeof record.debug === "boolean") {
		config.debug = record.debug;
	}

	return config;
}

function isModelRef(value: unknown): value is ModelRef {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.provider === "string" && typeof record.id === "string";
}

function isCustomEntry(entry: { type: string; customType?: string; data?: unknown }): entry is {
	type: "custom";
	customType: string;
	data?: unknown;
} {
	return entry.type === "custom" && typeof entry.customType === "string";
}

function getConfigFilePath(): string {
	return join(getAgentDir(), "extensions", "bo-pi.json");
}

function getAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		return expandTilde(envDir);
	}
	return join(homedir(), ".pi", "agent");
}

function expandTilde(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) {
		return join(homedir(), value.slice(2));
	}
	return value;
}
