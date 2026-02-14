import { describe, expect, it } from "vitest";
import type { PermissionSettingsFile, ToolCallSummary } from "../extensions/preflight/types.js";
import {
	buildPolicyRules,
	compilePermissionRule,
	matchesPermissionRule,
} from "../extensions/preflight/permissions/matching.js";

const logDebug = () => {};

describe("permission matching", () => {
	it("matches bash wildcards", () => {
		const rule = compilePermissionRule(
			"Bash(ls:*)",
			"allow",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);
		const toolCall: ToolCallSummary = { id: "1", name: "bash", args: { command: "ls -la" } };
		expect(rule).toBeDefined();
		expect(matchesPermissionRule(rule!, toolCall, "/workspace")).toBe(true);
	});

	it("matches read path patterns", () => {
		const rule = compilePermissionRule(
			"Read(./src/*.ts)",
			"allow",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);
		const toolCall: ToolCallSummary = { id: "1", name: "read", args: { path: "src/index.ts" } };
		expect(rule).toBeDefined();
		expect(matchesPermissionRule(rule!, toolCall, "/workspace")).toBe(true);
	});

	it("matches absolute path patterns", () => {
		const rule = compilePermissionRule(
			"Read(//tmp/notes.txt)",
			"allow",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);
		const toolCall: ToolCallSummary = { id: "1", name: "read", args: { path: "/tmp/notes.txt" } };
		expect(rule).toBeDefined();
		expect(matchesPermissionRule(rule!, toolCall, "/workspace")).toBe(true);
	});

	it("matches args patterns for custom tools", () => {
		const rule = compilePermissionRule(
			"MyTool(args:{\"foo\":1,\"bar\":[\"a\",\"b\"]})",
			"allow",
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);
		const toolCall: ToolCallSummary = {
			id: "1",
			name: "mytool",
			args: { foo: 1, bar: ["a", "b"] },
		};
		expect(rule).toBeDefined();
		expect(matchesPermissionRule(rule!, toolCall, "/workspace")).toBe(true);
	});
});

describe("policy rule loading", () => {
	it("loads tool-scoped llmRules object", () => {
		const settings: PermissionSettingsFile = {
			preflight: {
				llmRules: {
					bash: ["Rule A", "Rule B"],
					read: ["Rule C"],
				},
			},
		};

		const rules = buildPolicyRules(
			settings,
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);

		expect(rules.map((rule) => ({ tool: rule.tool, policy: rule.policy }))).toEqual([
			{ tool: "bash", policy: "Rule A" },
			{ tool: "bash", policy: "Rule B" },
			{ tool: "read", policy: "Rule C" },
		]);
	});

	it("loads legacy [{pattern, policy}] format", () => {
		const settings: PermissionSettingsFile = {
			preflight: {
				llmRules: [
					{ pattern: "Bash(*)", policy: "Rule Bash" },
					{ pattern: "Read(./src/**)", policy: "Rule Read" },
				],
			},
		};

		const rules = buildPolicyRules(
			settings,
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);

		expect(rules.map((rule) => ({ tool: rule.tool, policy: rule.policy }))).toEqual([
			{ tool: "bash", policy: "Rule Bash" },
			{ tool: "read", policy: "Rule Read" },
		]);
	});

	it("loads legacy string[] as wildcard policies", () => {
		const settings: PermissionSettingsFile = {
			preflight: {
				llmRules: ["Ask before destructive changes"],
			},
		};

		const rules = buildPolicyRules(
			settings,
			"workspace",
			"/workspace/.pi/preflight/settings.local.json",
			logDebug,
		);

		expect(rules.map((rule) => ({ tool: rule.tool, policy: rule.policy }))).toEqual([
			{ tool: "*", policy: "Ask before destructive changes" },
		]);
	});
});
