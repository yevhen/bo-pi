import { describe, expect, it } from "vitest";
import type { ToolCallSummary } from "../extensions/preflight/types.js";
import { compilePermissionRule, matchesPermissionRule } from "../extensions/preflight/permissions/matching.js";

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
