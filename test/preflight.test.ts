import { describe, expect, it } from "vitest";
import type { ToolCallSummary } from "../extensions/preflight/types.js";
import { normalizePreflight, parsePreflightResponse } from "../extensions/preflight/preflight.js";

describe("preflight parsing", () => {
	it("parses JSON response", () => {
		const parsed = parsePreflightResponse(
			"```json\n{\"call-1\":{\"summary\":\"List files\",\"destructive\":false}}\n```",
		);
		expect(parsed?.["call-1"]).toEqual({ summary: "List files", destructive: false, scope: undefined });
	});

	it("requires metadata for every tool call", () => {
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "bash", args: { command: "ls" } },
			{ id: "call-2", name: "write", args: { path: "note.txt", content: "hi" } },
		];
		const parsed = parsePreflightResponse(
			"{\"call-1\":{\"summary\":\"List files\",\"destructive\":false}}",
		);
		expect(normalizePreflight(parsed, toolCalls)).toBeUndefined();
	});

	it("sanitizes summaries", () => {
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "bash", args: { command: "ls" } },
		];
		const parsed = parsePreflightResponse(
			"{\"call-1\":{\"summary\":\"Run bash to list files\",\"destructive\":false}}",
		);
		const normalized = normalizePreflight(parsed, toolCalls);
		expect(normalized?.["call-1"].summary).toBe("List files");
	});
});
