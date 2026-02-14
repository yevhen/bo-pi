import type { ExtensionContext, ToolPreflightMetadata } from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Context } from "@mariozechner/pi-ai";
import { normalizePolicyResult } from "./permissions/policy.js";
import type {
	DebugLogger,
	PreflightAttempt,
	PreflightConfig,
	ToolCallSummary,
	ToolCallsContext,
	ToolPolicyDecision,
} from "./types.js";
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
	event: ToolCallsContext,
	policyRulesByToolCall: Record<string, string[]>,
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

	const instruction = buildPreflightPrompt(event.toolCalls, policyRulesByToolCall);
	const trimmedContext = limitContextMessages(event.llmContext.messages, 0);
	const preflightContext: Context = {
		...event.llmContext,
		messages: [...trimmedContext, createUserMessage(instruction)],
	};

	logDebug(`Preflight prompt:\n${instruction}`);
	logDebug(`Preflight context messages:\n${JSON.stringify(preflightContext.messages, null, 2)}`);
	logDebug(`Preflight policy rules by tool call:\n${JSON.stringify(policyRulesByToolCall, null, 2)}`);

	try {
		const response = await streamSimple(modelWithKey.model, preflightContext, { apiKey: modelWithKey.apiKey });
		for await (const _ of response) {
			// Drain stream to completion.
		}
		const result = await response.result();
		const text = extractText(result.content);
		logDebug(`Preflight raw response:\n${text ?? ""}`);
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
		logDebug(`Preflight parsed response:\n${JSON.stringify(parsed, null, 2)}`);
		const normalized = normalizePreflight(parsed, event.toolCalls, policyRulesByToolCall);
		if (!normalized) {
			const reason = "Preflight response did not include valid intrinsic metadata for all tool calls.";
			logDebug(`Preflight failed: ${reason}`);
			return { status: "error", reason };
		}
		logDebug(`Preflight normalized metadata:\n${JSON.stringify(normalized.metadata, null, 2)}`);
		logDebug(`Preflight normalized policy:\n${JSON.stringify(normalized.policyDecisions, null, 2)}`);
		logDebug(`Preflight parsed ${Object.keys(normalized.metadata).length} tool call(s).`);
		return { status: "ok", metadata: normalized.metadata, policyDecisions: normalized.policyDecisions };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const reason = message ? `Preflight request failed: ${message}` : "Preflight request failed.";
		logDebug(`Preflight failed: ${reason}`);
		return { status: "error", reason };
	}
}

function buildPreflightPrompt(
	toolCalls: ToolCallSummary[],
	policyRulesByToolCall: Record<string, string[]>,
): string {
	const payload = toolCalls.map((toolCall) => ({
		toolCallId: toolCall.id,
		name: toolCall.name,
		args: toolCall.args,
		policyRules: policyRulesByToolCall[toolCall.id] ?? [],
	}));

	return [
		"You are a tool preflight assistant.",
		"Return JSON only.",
		"Return an object mapping toolCallId to this exact shape:",
		"{ intrinsic: { summary: string, destructive: boolean, scope?: string[] }, policy: { decision: \"allow\"|\"ask\"|\"deny\"|\"none\", reason: string } }",
		"Rules:",
		"- intrinsic is always required for every tool call.",
		"- policy.decision must be allow|ask|deny when policy rules apply.",
		"- policy.decision must be none when policyRules are empty or no rule is applicable.",
		"- Summaries should be short, human-friendly action phrases.",
		"- Do not mention tool names or raw arguments in the summary.",
		"- destructive = true only if the call changes data or system state.",
		"- No markdown, no extra text.",
		"Tool calls:",
		JSON.stringify(payload, null, 2),
	].join("\n");
}

export function parsePreflightResponse(text: string): Record<string, unknown> | undefined {
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
			return parsed as Record<string, unknown>;
		}
	} catch (error) {
		return undefined;
	}

	return undefined;
}

function arrayToPreflight(items: unknown[]): Record<string, unknown> | undefined {
	const result: Record<string, unknown> = {};
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const record = item as {
			id?: string;
			toolCallId?: string;
			intrinsic?: unknown;
			policy?: unknown;
			summary?: string;
			destructive?: boolean;
			scope?: string[];
			decision?: unknown;
			reason?: unknown;
		};
		const id = record.toolCallId ?? record.id;
		if (!id || typeof id !== "string") continue;
		if (record.intrinsic && record.policy) {
			result[id] = {
				intrinsic: record.intrinsic,
				policy: record.policy,
			};
			continue;
		}
		if (typeof record.summary === "string" && typeof record.destructive === "boolean") {
			result[id] = {
				intrinsic: {
					summary: record.summary,
					destructive: record.destructive,
					scope: Array.isArray(record.scope)
						? record.scope.filter((item) => typeof item === "string")
						: undefined,
				},
				policy: {
					decision: record.decision ?? "none",
					reason: record.reason,
				},
			};
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

export function normalizePreflight(
	parsed: Record<string, unknown> | undefined,
	toolCalls: ToolCallSummary[],
	policyRulesByToolCall: Record<string, string[]>,
):
	| {
			metadata: Record<string, ToolPreflightMetadata>;
			policyDecisions: Record<string, ToolPolicyDecision>;
	  }
	| undefined {
	if (!parsed) return undefined;
	const metadata: Record<string, ToolPreflightMetadata> = {};
	const policyDecisions: Record<string, ToolPolicyDecision> = {};

	for (const toolCall of toolCalls) {
		const entry = parsed[toolCall.id];
		if (!entry || typeof entry !== "object") {
			return undefined;
		}
		const record = entry as { intrinsic?: unknown; policy?: unknown; summary?: unknown; destructive?: unknown };
		const intrinsicSource =
			record.intrinsic && typeof record.intrinsic === "object"
				? (record.intrinsic as Record<string, unknown>)
				: (record as Record<string, unknown>);
		const intrinsic = normalizeIntrinsic(intrinsicSource, toolCall);
		if (!intrinsic) {
			return undefined;
		}
		metadata[toolCall.id] = intrinsic;

		const hasPolicyRules = (policyRulesByToolCall[toolCall.id] ?? []).length > 0;
		policyDecisions[toolCall.id] = normalizePolicy(record.policy, hasPolicyRules);
	}

	return { metadata, policyDecisions };
}

function normalizeIntrinsic(
	value: Record<string, unknown>,
	toolCall: ToolCallSummary,
): ToolPreflightMetadata | undefined {
	if (typeof value.summary !== "string" || typeof value.destructive !== "boolean") {
		return undefined;
	}

	const summary = sanitizeSummary(value.summary, toolCall) ?? value.summary.trim();
	if (!summary) return undefined;

	const scope = Array.isArray(value.scope) ? value.scope.filter((item): item is string => typeof item === "string") : undefined;

	return {
		summary,
		destructive: value.destructive,
		scope,
	};
}

function normalizePolicy(value: unknown, hasPolicyRules: boolean): ToolPolicyDecision {
	if (value && typeof value === "object") {
		const record = value as { decision?: unknown; reason?: unknown };
		const normalized = normalizePolicyResult(record.decision, record.reason);
		if (normalized) {
			return normalized;
		}
	}

	if (hasPolicyRules) {
		return {
			decision: "none",
			reason: "Policy response missing or invalid; fallback applied.",
		};
	}

	return {
		decision: "none",
		reason: "No applicable policy rules.",
	};
}

function sanitizeSummary(summary: string | undefined, toolCall: ToolCallSummary): string | undefined {
	if (!summary) return undefined;
	let cleaned = summary.trim();
	if (!cleaned) return undefined;

	const patterns = [new RegExp(`^(run|use|execute)\\s+${escapeRegExp(toolCall.name)}\\b\\s+to\\s+`, "i")];

	for (const pattern of patterns) {
		const updated = cleaned.replace(pattern, "").trim();
		if (updated && updated !== cleaned) {
			cleaned = updated;
			break;
		}
	}

	return cleaned ? capitalizeFirst(cleaned) : undefined;
}
