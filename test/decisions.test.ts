import { describe, expect, it } from "vitest";
import type { ExtensionContext, ToolPreflightMetadata } from "@mariozechner/pi-coding-agent";
import type { Context } from "@mariozechner/pi-ai";
import type {
	PermissionsState,
	PolicyRule,
	PreflightConfig,
	ToolCallSummary,
	ToolCallsContext,
	ToolPolicyDecision,
} from "../extensions/preflight/types.js";
import { resolveToolDecisions } from "../extensions/preflight/permissions/decisions.js";
import { compilePermissionRule } from "../extensions/preflight/permissions/matching.js";

const logLines: string[] = [];
const logDebug = (message: string): void => {
	logLines.push(message);
};

const baseConfig: PreflightConfig = {
	contextMessages: 1,
	explainKey: "ctrl+e",
	ruleSuggestionKey: "ctrl+n",
	model: "current",
	policyModel: "current",
	approvalMode: "all",
	debug: true,
};

const llmContext: Context = { messages: [] };

function buildEvent(toolCalls: ToolCallSummary[]): ToolCallsContext {
	return {
		toolCalls,
		llmContext,
	};
}

function buildPolicyRule(tool: string, policy: string): PolicyRule {
	return {
		tool,
		policy,
		source: "workspace",
		settingsPath: "/workspace/.pi/preflight/settings.local.json",
		settingsDir: "/workspace/.pi/preflight",
	};
}

function buildPermissions(overrides: Partial<PermissionsState> = {}): PermissionsState {
	return {
		rules: { allow: [], ask: [], deny: [] },
		policyRules: [],
		policyOverrides: [],
		...overrides,
	};
}

function buildPolicy(decision: ToolPolicyDecision["decision"], reason: string): ToolPolicyDecision {
	return { decision, reason };
}

function buildPreflight(toolCalls: ToolCallSummary[]): Record<string, ToolPreflightMetadata> {
	const result: Record<string, ToolPreflightMetadata> = {};
	for (const toolCall of toolCalls) {
		result[toolCall.id] = { summary: `Handle ${toolCall.name}`, destructive: true };
	}
	return result;
}

function buildCtx(hasUI: boolean = false): ExtensionContext {
	return { cwd: "/workspace", hasUI } as ExtensionContext;
}

describe("resolveToolDecisions", () => {
	it("keeps deterministic deny over policy allow", async () => {
		const denyRule = compilePermissionRule(
			"Bash(*)",
			"deny",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			() => {},
		);
		const toolCalls: ToolCallSummary[] = [{ id: "call-1", name: "bash", args: { command: "ls" } }];
		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			buildPreflight(toolCalls),
			{ "call-1": buildPolicy("allow", "policy allow") },
			buildCtx(),
			baseConfig,
			buildPermissions({ rules: { allow: [], ask: [], deny: denyRule ? [denyRule] : [] } }),
			() => {},
		);

		expect(decisions["call-1"].decision).toBe("deny");
		expect(decisions["call-1"].source).toBe("deterministic");
	});

	it("applies policy only to matching tool", async () => {
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "bash", args: { command: "echo hi" } },
			{ id: "call-2", name: "read", args: { path: "README.md" } },
		];
		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			buildPreflight(toolCalls),
			{
				"call-1": buildPolicy("deny", "Rule blocks shell writes"),
				"call-2": buildPolicy("deny", "Should be ignored for read"),
			},
			buildCtx(),
			{ ...baseConfig, approvalMode: "off" },
			buildPermissions({
				policyRules: [buildPolicyRule("bash", "Only allow read-only bash")],
			}),
			() => {},
		);

		expect(decisions["call-1"].decision).toBe("deny");
		expect(decisions["call-1"].source).toBe("policy");
		expect(decisions["call-2"].decision).toBe("allow");
		expect(decisions["call-2"].source).toBe("fallback");
	});

	it("asks for confirmation when policy denies and UI is available", async () => {
		const toolCalls: ToolCallSummary[] = [{ id: "call-1", name: "bash", args: { command: "git clone repo" } }];
		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			buildPreflight(toolCalls),
			{ "call-1": buildPolicy("deny", "Only read-only bash commands are allowed") },
			buildCtx(true),
			{ ...baseConfig, approvalMode: "all" },
			buildPermissions({
				policyRules: [buildPolicyRule("bash", "Allow read-only bash commands")],
			}),
			() => {},
		);

		expect(decisions["call-1"]).toMatchObject({
			decision: "ask",
			source: "policy",
			policy: {
				decision: "deny",
				reason: "Only read-only bash commands are allowed",
			},
		});
	});

	it("keeps policy deny when approvals are off", async () => {
		const toolCalls: ToolCallSummary[] = [{ id: "call-1", name: "bash", args: { command: "git clone repo" } }];
		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			buildPreflight(toolCalls),
			{ "call-1": buildPolicy("deny", "Only read-only bash commands are allowed") },
			buildCtx(true),
			{ ...baseConfig, approvalMode: "off" },
			buildPermissions({
				policyRules: [buildPolicyRule("bash", "Allow read-only bash commands")],
			}),
			() => {},
		);

		expect(decisions["call-1"]).toMatchObject({
			decision: "deny",
			source: "policy",
			reason: "Blocked by custom rules: Only read-only bash commands are allowed",
			policy: {
				decision: "deny",
			},
		});
	});

	it("falls back by approval mode when policy is none", async () => {
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "write", args: { path: "a.txt", content: "x" } },
			{ id: "call-2", name: "read", args: { path: "a.txt" } },
		];
		const preflight: Record<string, ToolPreflightMetadata> = {
			"call-1": { summary: "Write file", destructive: true },
			"call-2": { summary: "Read file", destructive: false },
		};
		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			preflight,
			{
				"call-1": buildPolicy("none", "No applicable policy rules."),
				"call-2": buildPolicy("none", "No applicable policy rules."),
			},
			buildCtx(),
			{ ...baseConfig, approvalMode: "destructive" },
			buildPermissions(),
			() => {},
		);

		expect(decisions["call-1"]).toMatchObject({ decision: "ask", source: "fallback" });
		expect(decisions["call-2"]).toMatchObject({ decision: "allow", source: "fallback" });
	});

	it("logs final decision source", async () => {
		logLines.length = 0;
		const toolCalls: ToolCallSummary[] = [{ id: "call-1", name: "bash", args: { command: "ls" } }];
		await resolveToolDecisions(
			buildEvent(toolCalls),
			buildPreflight(toolCalls),
			{ "call-1": buildPolicy("none", "No policy") },
			buildCtx(),
			{ ...baseConfig, approvalMode: "off" },
			buildPermissions(),
			logDebug,
		);

		expect(logLines.some((line) => line.includes("source: fallback"))).toBe(true);
	});
});
