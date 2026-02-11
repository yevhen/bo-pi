import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { AssistantMessage, Context, Message, TextContent } from "@mariozechner/pi-ai";

interface ToolPreflightMetadata {
	summary: string;
	destructive: boolean;
	confidence?: "low" | "medium" | "high";
	scope?: string[];
}

interface ToolCallSummary {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

interface ToolCallsBatchEvent {
	type: "tool_calls_batch";
	toolCalls: ToolCallSummary[];
	assistantMessage: AssistantMessage;
	llmContext: Context;
}

interface ToolCallsBatchResult {
	preflight?: Record<string, ToolPreflightMetadata>;
	approvals?: Record<string, { allow: boolean; reason?: string }>;
}

type ToolCallsBatchHandler = (event: ToolCallsBatchEvent, ctx: ExtensionContext) =>
	| ToolCallsBatchResult
	| undefined
	| Promise<ToolCallsBatchResult | undefined>;

type PreflightExtensionAPI = ExtensionAPI & {
	on(event: "tool_calls_batch", handler: ToolCallsBatchHandler): void;
};

const MAX_ARGS_CHARS = 1200;

export default function (pi: ExtensionAPI) {
	const preflightApi = pi as PreflightExtensionAPI;

	preflightApi.on("tool_calls_batch", async (event, ctx) => {
		const preflight = await buildPreflightMetadata(event, ctx);
		const approvals = ctx.hasUI ? await collectApprovals(event.toolCalls, preflight, ctx) : undefined;
		return { preflight, approvals };
	});
}

async function buildPreflightMetadata(
	event: ToolCallsBatchEvent,
	ctx: ExtensionContext,
): Promise<Record<string, ToolPreflightMetadata>> {
	const fallback = buildFallbackMetadata(event.toolCalls);

	const model = ctx.model;
	if (!model) {
		return fallback;
	}

	const apiKey = await ctx.modelRegistry.getApiKey(model);
	if (!apiKey) {
		return fallback;
	}

	const instruction = buildPreflightPrompt(event.toolCalls);
	const preflightContext: Context = {
		...event.llmContext,
		messages: [...event.llmContext.messages, event.assistantMessage, createUserMessage(instruction)],
	};

	try {
		const response = await streamSimple(model, preflightContext, { apiKey });
		for await (const _ of response) {
			// Drain stream to completion.
		}
		const result = await response.result();
		const text = extractText(result.content);
		const parsed = parsePreflightResponse(text);
		return normalizePreflight(parsed, event.toolCalls, fallback);
	} catch (error) {
		return fallback;
	}
}

function buildFallbackMetadata(toolCalls: ToolCallSummary[]): Record<string, ToolPreflightMetadata> {
	const entries: Record<string, ToolPreflightMetadata> = {};

	for (const toolCall of toolCalls) {
		entries[toolCall.id] = {
			summary: `Run ${toolCall.name}`,
			destructive: isLikelyDestructive(toolCall.name),
			confidence: "low",
		};
	}

	return entries;
}

function buildPreflightPrompt(toolCalls: ToolCallSummary[]): string {
	return [
		"You are a tool preflight assistant.",
		"For each tool call, return JSON mapping toolCallId to:",
		"{ summary: string, destructive: boolean, confidence?: low|medium|high, scope?: string[] }.",
		"Use concise summaries suitable for a confirmation dialog.",
		"destructive = true if the call writes data, edits files, runs commands, or mutates external state.",
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
			confidence?: "low" | "medium" | "high";
			scope?: string[];
		};
		const id = record.toolCallId ?? record.id;
		if (!id || typeof id !== "string") continue;
		if (typeof record.summary !== "string" || typeof record.destructive !== "boolean") continue;
		result[id] = {
			summary: record.summary,
			destructive: record.destructive,
			confidence: record.confidence,
			scope: Array.isArray(record.scope) ? record.scope.filter((item) => typeof item === "string") : undefined,
		};
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function normalizePreflight(
	parsed: Record<string, ToolPreflightMetadata> | undefined,
	toolCalls: ToolCallSummary[],
	fallback: Record<string, ToolPreflightMetadata>,
): Record<string, ToolPreflightMetadata> {
	if (!parsed) return fallback;

	const result: Record<string, ToolPreflightMetadata> = {};
	for (const toolCall of toolCalls) {
		const entry = parsed[toolCall.id];
		if (entry && typeof entry.summary === "string" && typeof entry.destructive === "boolean") {
			result[toolCall.id] = {
				summary: entry.summary,
				destructive: entry.destructive,
				confidence: entry.confidence,
				scope: Array.isArray(entry.scope) ? entry.scope.filter((item) => typeof item === "string") : undefined,
			};
		} else {
			result[toolCall.id] = fallback[toolCall.id];
		}
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
): Promise<Record<string, { allow: boolean; reason?: string }> | undefined> {
	if (!ctx.hasUI) return undefined;

	const approvals: Record<string, { allow: boolean; reason?: string }> = {};

	for (const toolCall of toolCalls) {
		const metadata = preflight[toolCall.id];
		const summary = metadata?.summary ?? `Run ${toolCall.name}`;
		const destructive = metadata?.destructive ?? isLikelyDestructive(toolCall.name);
		const argsPreview = formatArgsPreview(toolCall.args);
		const scope = metadata?.scope?.length ? `\nScope: ${metadata.scope.join(", ")}` : "";
		const warning = destructive ? "Destructive: yes" : "Destructive: no";
		const message = `${summary}\n\n${warning}${scope}\n\nArgs:\n${argsPreview}`;
		const title = destructive ? `Approve destructive ${toolCall.name}?` : `Approve ${toolCall.name}?`;
		const allow = await ctx.ui.confirm(title, message);
		approvals[toolCall.id] = allow
			? { allow: true }
			: { allow: false, reason: "Blocked by user" };
	}

	return approvals;
}

function formatArgsPreview(args: Record<string, unknown>): string {
	const formatted = safeJsonStringify(args, 2);
	if (formatted.length <= MAX_ARGS_CHARS) return formatted;
	return `${formatted.slice(0, MAX_ARGS_CHARS)}\n...`;
}

function safeJsonStringify(value: unknown, indent = 0): string {
	try {
		return JSON.stringify(value, null, indent);
	} catch (error) {
		return String(value);
	}
}

function isLikelyDestructive(toolName: string): boolean {
	switch (toolName) {
		case "write":
		case "edit":
		case "bash":
			return true;
		default:
			return false;
	}
}
