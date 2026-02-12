import type { ExtensionContext, ToolCallsBatchEvent, ToolPreflightMetadata } from "@mariozechner/pi-coding-agent";
import type { DebugLogger, PreflightConfig, ToolCallSummary, ToolDecision } from "../types.js";
import { persistPolicyOverride, persistWorkspaceRule } from "../permissions/persistence.js";
import { requestApproval } from "./approval-ui.js";

export async function collectApprovals(
	event: ToolCallsBatchEvent,
	preflight: Record<string, ToolPreflightMetadata>,
	decisions: Record<string, ToolDecision>,
	ctx: ExtensionContext,
	config: PreflightConfig,
	logDebug: DebugLogger,
): Promise<Record<string, { allow: boolean; reason?: string }> | undefined> {
	const approvals: Record<string, { allow: boolean; reason?: string }> = {};
	let approvalTargets = 0;

	for (const toolCall of event.toolCalls) {
		const decision = decisions[toolCall.id];
		if (!decision) continue;

		if (decision.decision === "deny") {
			approvals[toolCall.id] = {
				allow: false,
				reason: decision.reason ?? "Blocked by policy",
			};
			continue;
		}

		if (decision.decision === "allow") {
			continue;
		}

		if (!ctx.hasUI) {
			approvals[toolCall.id] = {
				allow: false,
				reason: "Approval required but no UI available.",
			};
			continue;
		}

		approvalTargets += 1;
	}

	if (approvalTargets === 0) {
		if (Object.keys(approvals).length === 0) {
			logDebug("No tool calls require approval.");
			return undefined;
		}
		return approvals;
	}

	logDebug(`Requesting approvals for ${approvalTargets} tool call(s).`);

	for (const toolCall of event.toolCalls) {
		const decision = decisions[toolCall.id];
		if (!decision || decision.decision !== "ask") continue;
		if (!ctx.hasUI) continue;

		const metadata = preflight[toolCall.id];
		const approvalDecision = await requestApproval(
			event,
			toolCall,
			metadata,
			decision,
			ctx,
			config,
			logDebug,
		);
		if (approvalDecision === "allow-persist" || approvalDecision === "deny-persist") {
			persistWorkspaceRule(toolCall, approvalDecision, ctx, logDebug);
		}
		if (approvalDecision === "allow-persist" && decision.policy?.decision === "deny") {
			persistPolicyOverride(toolCall, ctx, logDebug);
		}

		const allowed = approvalDecision === "allow" || approvalDecision === "allow-persist";
		approvals[toolCall.id] = allowed
			? { allow: true }
			: { allow: false, reason: "Blocked by user" };
	}

	return Object.keys(approvals).length > 0 ? approvals : undefined;
}

export function buildAllowAllApprovals(
	toolCalls: ToolCallSummary[],
): Record<string, { allow: boolean; reason?: string }> {
	const approvals: Record<string, { allow: boolean; reason?: string }> = {};
	for (const toolCall of toolCalls) {
		approvals[toolCall.id] = { allow: true };
	}
	return approvals;
}

export function buildBlockAllApprovals(
	toolCalls: ToolCallSummary[],
	reason: string,
): Record<string, { allow: boolean; reason?: string }> {
	const approvals: Record<string, { allow: boolean; reason?: string }> = {};
	for (const toolCall of toolCalls) {
		approvals[toolCall.id] = { allow: false, reason };
	}
	return approvals;
}
