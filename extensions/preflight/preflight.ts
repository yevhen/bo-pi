import type { ExtensionContext, ToolCallsBatchEvent, ToolPreflightMetadata } from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Context } from "@mariozechner/pi-ai";
import type { DebugLogger, PreflightAttempt, PreflightConfig, ToolCallSummary } from "./types.js";
import {
	createUserMessage,
	extractJsonPayload,
	extractText,
	limitContextMessages,
	resolveModelWithApiKey,
	stripCodeFence,
} from "./llm-utils.js";
import { capitalizeFirst, escapeRegExp } from "./utils/text.js";

export async function buildPreflightMetadata(
	event: ToolCallsBatchEvent,
	ctx: ExtensionContext,
	config: PreflightConfig,
	logDebug: DebugLogger,
): Promise<PreflightAttempt> {
	const modelWithKey = await resolveModelWithApiKey(ctx, config.model);
	if (!modelWithKey) {
		const reason = "No model or API key available for preflight.";
		logDebug(`Preflight failed: ${reason}`);
		return { status: "error", reason };
	}

	logDebug(`Preflight model: ${modelWithKey.model.provider}/${modelWithKey.model.id}.`);
	logDebug("Preflight context: tool-call only.");

	const instruction = buildPreflightPrompt(event.toolCalls);
	const trimmedContext = limitContextMessages(event.llmContext.messages, 0);
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

export function parsePreflightResponse(text: string): Record<string, ToolPreflightMetadata> | undefined {
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

export function normalizePreflight(
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
