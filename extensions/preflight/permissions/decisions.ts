import type { ExtensionContext, ToolPreflightMetadata } from "@mariozechner/pi-coding-agent";
import type {
	DebugLogger,
	PermissionRule,
	PermissionsState,
	PolicyEvaluation,
	PolicyOverrideRule,
	PolicyRule,
	PreflightConfig,
	ToolCallSummary,
	ToolCallsContext,
	ToolDecision,
} from "../types.js";
import { evaluatePolicyRule } from "./policy.js";
import {
	formatRuleLabel,
	matchesPermissionRule,
	matchesPolicyOverride,
	matchesPolicyRule,
} from "./matching.js";

export async function resolveToolDecisions(
	event: ToolCallsContext,
	preflight: Record<string, ToolPreflightMetadata>,
	ctx: ExtensionContext,
	config: PreflightConfig,
	permissions: PermissionsState,
	logDebug: DebugLogger,
): Promise<Record<string, ToolDecision>> {
	const decisions: Record<string, ToolDecision> = {};

	for (const toolCall of event.toolCalls) {
		const metadata = preflight[toolCall.id];
		const baseDecision = resolveBaseDecision(toolCall, metadata, ctx.cwd, config, permissions, logDebug);
		let decision = baseDecision.decision;
		let reason = baseDecision.reason;
		let policyEvaluation: PolicyEvaluation | undefined;

		if (decision !== "deny") {
			const overrideRule = findMatchingPolicyOverride(toolCall, permissions.policyOverrides, ctx.cwd);
			if (overrideRule) {
				logDebug(`Policy override matched: ${formatRuleLabel(overrideRule)}.`);
			} else {
				const policyRule = findMatchingPolicyRule(toolCall, permissions.policyRules, ctx.cwd);
				if (policyRule) {
					logDebug(`Policy rule matched: ${formatRuleLabel(policyRule)}.`);
					const policyAttempt = await evaluatePolicyRule(
						event,
						toolCall,
						policyRule,
						ctx,
						config,
						logDebug,
					);
					if (policyAttempt.status === "ok") {
						policyEvaluation = {
							decision: policyAttempt.decision,
							reason: policyAttempt.reason,
							rule: policyRule,
						};
						const policyDenied = policyAttempt.decision === "deny";
						let nextDecision = applyPolicyDecision(decision, policyAttempt.decision);
						if (policyDenied && ctx.hasUI) {
							nextDecision = "ask";
						}
						if (nextDecision !== decision) {
							logDebug(
								`Policy decision for ${toolCall.name} changed from ${decision} to ${nextDecision}.`,
							);
						}
						decision = nextDecision;
						if (decision === "deny" && !reason) {
							reason = buildPolicyDenyReason(policyRule, policyAttempt.reason);
						}
					} else {
						logDebug(`Policy evaluation failed: ${policyAttempt.reason}`);
						if (decision === "allow") {
							decision = "ask";
						}
					}
				}
			}
		}

		decisions[toolCall.id] = {
			decision,
			reason,
			rule: baseDecision.rule,
			policy: policyEvaluation,
		};
	}

	return decisions;
}

function resolveBaseDecision(
	toolCall: ToolCallSummary,
	metadata: ToolPreflightMetadata | undefined,
	cwd: string,
	config: PreflightConfig,
	permissions: PermissionsState,
	logDebug: DebugLogger,
): { decision: "allow" | "ask" | "deny"; rule?: PermissionRule; reason?: string } {
	const denyRule = findMatchingRule(toolCall, permissions.rules.deny, cwd);
	if (denyRule) {
		logDebug(`Permission rule matched (deny): ${formatRuleLabel(denyRule)}.`);
		return {
			decision: "deny",
			rule: denyRule,
			reason: buildPermissionDenyReason(denyRule),
		};
	}

	const askRule = findMatchingRule(toolCall, permissions.rules.ask, cwd);
	if (askRule) {
		logDebug(`Permission rule matched (ask): ${formatRuleLabel(askRule)}.`);
		return { decision: "ask", rule: askRule };
	}

	const allowRule = findMatchingRule(toolCall, permissions.rules.allow, cwd);
	if (allowRule) {
		logDebug(`Permission rule matched (allow): ${formatRuleLabel(allowRule)}.`);
		return { decision: "allow", rule: allowRule };
	}

	return { decision: buildDefaultDecision(metadata, config.approvalMode) };
}

function buildDefaultDecision(
	metadata: ToolPreflightMetadata | undefined,
	mode: PreflightConfig["approvalMode"],
): "allow" | "ask" | "deny" {
	if (mode === "off") return "allow";
	if (mode === "all") return "ask";
	if (mode === "destructive") {
		const destructive = metadata?.destructive ?? true;
		return destructive ? "ask" : "allow";
	}
	return "ask";
}

function applyPolicyDecision(
	baseDecision: "allow" | "ask" | "deny",
	policyDecision: "allow" | "ask" | "deny",
): "allow" | "ask" | "deny" {
	if (baseDecision === "deny") return "deny";
	if (baseDecision === "ask") {
		return policyDecision === "deny" ? "deny" : "ask";
	}
	return policyDecision;
}

function buildPermissionDenyReason(rule: { raw: string; reason?: string }): string {
	if (rule.reason) {
		return `Blocked by rule ${rule.raw}: ${rule.reason}`;
	}
	return `Blocked by rule ${rule.raw}.`;
}

function buildPolicyDenyReason(rule: { raw: string }, reason: string): string {
	return `Blocked by policy rule ${rule.raw}: ${reason}`;
}

function findMatchingRule(
	toolCall: ToolCallSummary,
	rules: PermissionRule[],
	cwd: string,
): PermissionRule | undefined {
	for (const rule of rules) {
		if (!rule) continue;
		if (matchesPermissionRule(rule, toolCall, cwd)) {
			return rule;
		}
	}
	return undefined;
}

function findMatchingPolicyRule(
	toolCall: ToolCallSummary,
	rules: PolicyRule[],
	cwd: string,
): PolicyRule | undefined {
	for (const rule of rules) {
		if (matchesPolicyRule(rule, toolCall, cwd)) {
			return rule;
		}
	}
	return undefined;
}

function findMatchingPolicyOverride(
	toolCall: ToolCallSummary,
	rules: PolicyOverrideRule[],
	cwd: string,
): PolicyOverrideRule | undefined {
	for (const rule of rules) {
		if (matchesPolicyOverride(rule, toolCall, cwd)) {
			return rule;
		}
	}
	return undefined;
}
