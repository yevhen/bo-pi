import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext, ToolPreflightMetadata } from "@mariozechner/pi-coding-agent";
import type { Context } from "@mariozechner/pi-ai";
import type { PreflightConfig, ToolCallsContext, ToolDecision } from "../extensions/preflight/types.js";
import { collectApprovals } from "../extensions/preflight/approvals/index.js";
import { requestApproval } from "../extensions/preflight/approvals/approval-ui.js";
import { persistPolicyRule } from "../extensions/preflight/permissions/persistence.js";
import { buildPreflightMetadata } from "../extensions/preflight/preflight.js";
import { resolveToolDecisions } from "../extensions/preflight/permissions/decisions.js";

vi.mock("../extensions/preflight/approvals/approval-ui.js", () => ({
	requestApproval: vi.fn(),
}));

vi.mock("../extensions/preflight/permissions/persistence.js", () => ({
	persistWorkspaceRule: vi.fn(),
	persistPolicyOverride: vi.fn(),
	persistPolicyRule: vi.fn(),
}));

vi.mock("../extensions/preflight/permissions/state.js", () => ({
	loadPermissionsState: vi.fn(() => ({
		rules: { allow: [], ask: [], deny: [] },
		policyRules: [],
		policyOverrides: [],
	})),
}));

vi.mock("../extensions/preflight/permissions/matching.js", () => ({
	getPolicyRulesForTool: vi.fn(() => ["test rule"]),
}));

vi.mock("../extensions/preflight/preflight.js", () => ({
	buildPreflightMetadata: vi.fn(),
}));

vi.mock("../extensions/preflight/permissions/decisions.js", () => ({
	resolveToolDecisions: vi.fn(),
}));

const logDebug = () => {};

const config: PreflightConfig = {
	contextMessages: 1,
	explainKey: "ctrl+e",
	ruleSuggestionKey: "ctrl+n",
	model: "current",
	policyModel: "current",
	approvalMode: "all",
	debug: false,
};

const llmContext: Context = { messages: [] };

function buildEvent(): ToolCallsContext {
	return {
		toolCalls: [{ id: "call-1", name: "bash", args: { command: "ls -la" } }],
		llmContext,
	};
}

function buildAskDecision(): Record<string, ToolDecision> {
	return {
		"call-1": {
			decision: "ask",
			source: "fallback",
		},
	};
}

function buildMetadata(): Record<string, ToolPreflightMetadata> {
	return {
		"call-1": {
			summary: "Run command",
			destructive: false,
		},
	};
}

function createCtx(): ExtensionContext {
	return {
		cwd: "/workspace",
		hasUI: true,
		ui: {},
	} as ExtensionContext;
}

describe("collectApprovals custom rule behavior", () => {
	const approvalMock = vi.mocked(requestApproval);
	const persistPolicyRuleMock = vi.mocked(persistPolicyRule);
	const preflightMock = vi.mocked(buildPreflightMetadata);
	const decisionsMock = vi.mocked(resolveToolDecisions);

	beforeEach(() => {
		approvalMock.mockReset();
		persistPolicyRuleMock.mockReset();
		preflightMock.mockReset();
		decisionsMock.mockReset();
	});

	it("does not auto-allow when custom rule evaluates to deny", async () => {
		approvalMock.mockResolvedValue({ action: "custom-rule", rule: "Never allow shell commands" });
		preflightMock.mockResolvedValue({
			status: "ok",
			metadata: buildMetadata(),
			policyDecisions: {
				"call-1": { decision: "deny", reason: "Rule denies this command" },
			},
		});
		decisionsMock.mockResolvedValue({
			"call-1": {
				decision: "deny",
				source: "policy",
				reason: "Blocked by custom rules: Rule denies this command",
				policy: {
					decision: "deny",
					reason: "Rule denies this command",
					rules: ["Never allow shell commands"],
				},
			},
		});

		const approvals = await collectApprovals(
			buildEvent(),
			buildMetadata(),
			buildAskDecision(),
			createCtx(),
			config,
			logDebug,
		);

		expect(persistPolicyRuleMock).toHaveBeenCalledOnce();
		expect(approvals?.["call-1"]).toEqual({
			allow: false,
			reason: "Blocked by custom rules: Rule denies this command",
		});
	});

	it("allows current call when custom rule evaluates to allow", async () => {
		approvalMock.mockResolvedValue({ action: "custom-rule", rule: "Allow list commands" });
		preflightMock.mockResolvedValue({
			status: "ok",
			metadata: buildMetadata(),
			policyDecisions: {
				"call-1": { decision: "allow", reason: "Rule allows list commands" },
			},
		});
		decisionsMock.mockResolvedValue({
			"call-1": {
				decision: "allow",
				source: "policy",
				policy: {
					decision: "allow",
					reason: "Rule allows list commands",
					rules: ["Allow list commands"],
				},
			},
		});

		const approvals = await collectApprovals(
			buildEvent(),
			buildMetadata(),
			buildAskDecision(),
			createCtx(),
			config,
			logDebug,
		);

		expect(approvals?.["call-1"]).toEqual({ allow: true });
	});

	it("re-opens approval when custom rule evaluates to ask", async () => {
		approvalMock
			.mockResolvedValueOnce({ action: "custom-rule", rule: "Ask before shell commands" })
			.mockResolvedValueOnce({ action: "allow" });
		preflightMock.mockResolvedValue({
			status: "ok",
			metadata: buildMetadata(),
			policyDecisions: {
				"call-1": { decision: "ask", reason: "Policy still requires confirmation" },
			},
		});
		decisionsMock.mockResolvedValue({
			"call-1": {
				decision: "ask",
				source: "policy",
				policy: {
					decision: "ask",
					reason: "Policy still requires confirmation",
					rules: ["Ask before shell commands"],
				},
			},
		});

		const approvals = await collectApprovals(
			buildEvent(),
			buildMetadata(),
			buildAskDecision(),
			createCtx(),
			config,
			logDebug,
		);

		expect(approvalMock).toHaveBeenCalledTimes(2);
		expect(approvals?.["call-1"]).toEqual({ allow: true });
	});
});
