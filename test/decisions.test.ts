import { describe, expect, it, beforeEach, vi } from "vitest";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Context } from "@mariozechner/pi-ai";
import type {
	PermissionsState,
	PreflightConfig,
	ToolCallSummary,
	ToolCallsContext,
} from "../extensions/preflight/types.js";
import { resolveToolDecisions } from "../extensions/preflight/permissions/decisions.js";
import {
	compilePolicyOverrideRule,
	compilePolicyRule,
} from "../extensions/preflight/permissions/matching.js";
import { evaluatePolicyRule } from "../extensions/preflight/permissions/policy.js";

vi.mock("../extensions/preflight/permissions/policy.js", () => ({
	evaluatePolicyRule: vi.fn(),
}));

const logDebug = () => {};

const baseConfig: PreflightConfig = {
	contextMessages: 1,
	explainKey: "ctrl+e",
	model: "current",
	policyModel: "current",
	approvalMode: "all",
	debug: false,
};

const llmContext: Context = { messages: [] };

function buildEvent(toolCalls: ToolCallSummary[]): ToolCallsContext {
	return {
		toolCalls,
		llmContext,
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

describe("resolveToolDecisions", () => {
	const policyMock = vi.mocked(evaluatePolicyRule);

	beforeEach(() => {
		policyMock.mockReset();
	});

	it("respects destructive-only mode", async () => {
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "read", args: { path: "file.txt" } },
			{ id: "call-2", name: "write", args: { path: "file.txt", content: "hi" } },
		];
		const preflight = {
			"call-1": { summary: "Read file", destructive: false },
			"call-2": { summary: "Write file", destructive: true },
		};
		const config = { ...baseConfig, approvalMode: "destructive" };
		const permissions = buildPermissions();
		const ctx = { hasUI: false, cwd: "/workspace" } as ExtensionContext;

		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			preflight,
			ctx,
			config,
			permissions,
			logDebug,
		);

		expect(decisions["call-1"].decision).toBe("allow");
		expect(decisions["call-2"].decision).toBe("ask");
	});

	it("denies when policy blocks without UI", async () => {
		policyMock.mockResolvedValue({ status: "ok", decision: "deny", reason: "blocked" });
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "mytool", args: { action: "go" } },
		];
		const preflight = {
			"call-1": { summary: "Do thing", destructive: false },
		};
		const policyRule = compilePolicyRule(
			"MyTool(*)",
			"Must be approved",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);
		const permissions = buildPermissions({ policyRules: policyRule ? [policyRule] : [] });
		const ctx = { hasUI: false, cwd: "/workspace" } as ExtensionContext;

		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			preflight,
			ctx,
			{ ...baseConfig, approvalMode: "off" },
			permissions,
			logDebug,
		);

		expect(decisions["call-1"].decision).toBe("deny");
		expect(decisions["call-1"].reason).toContain("Blocked by policy rule");
	});

	it("skips policy evaluation when override matches", async () => {
		policyMock.mockResolvedValue({ status: "ok", decision: "deny", reason: "blocked" });
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "mytool", args: { action: "go" } },
		];
		const preflight = {
			"call-1": { summary: "Do thing", destructive: false },
		};
		const policyRule = compilePolicyRule(
			"MyTool(*)",
			"Must be approved",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);
		const overrideRule = compilePolicyOverrideRule(
			"MyTool(*)",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);
		const permissions = buildPermissions({
			policyRules: policyRule ? [policyRule] : [],
			policyOverrides: overrideRule ? [overrideRule] : [],
		});
		const ctx = { hasUI: false, cwd: "/workspace" } as ExtensionContext;

		const decisions = await resolveToolDecisions(
			buildEvent(toolCalls),
			preflight,
			ctx,
			{ ...baseConfig, approvalMode: "off" },
			permissions,
			logDebug,
		);

		expect(policyMock).not.toHaveBeenCalled();
		expect(decisions["call-1"].decision).toBe("allow");
	});
});
