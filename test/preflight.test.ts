import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Api, Context, Model } from "@mariozechner/pi-ai";
import type { PreflightConfig, ToolCallSummary, ToolCallsContext } from "../extensions/preflight/types.js";
import {
	buildPreflightMetadata,
	normalizePreflight,
	parsePreflightResponse,
} from "../extensions/preflight/preflight.js";
import { streamSimple } from "@mariozechner/pi-ai";

vi.mock("@mariozechner/pi-ai", async () => {
	const actual = await vi.importActual<typeof import("@mariozechner/pi-ai")>("@mariozechner/pi-ai");
	return {
		...actual,
		streamSimple: vi.fn(),
	};
});

const baseConfig: PreflightConfig = {
	contextMessages: 1,
	explainKey: "ctrl+e",
	ruleSuggestionKey: "ctrl+n",
	model: "current",
	policyModel: "current",
	approvalMode: "all",
	debug: true,
};

const model = { provider: "openai", id: "gpt-4o-mini" } as Model<Api>;

function createContext(): ExtensionContext {
	return {
		cwd: "/workspace",
		hasUI: false,
		model,
		modelRegistry: {
			find: vi.fn(),
			getApiKey: vi.fn().mockResolvedValue("test-key"),
		},
	} as unknown as ExtensionContext;
}

function buildEvent(toolCalls: ToolCallSummary[]): ToolCallsContext {
	const llmContext: Context = {
		systemPrompt: "system",
		messages: [],
	};
	return { toolCalls, llmContext };
}

describe("preflight parsing", () => {
	it("parses JSON response with intrinsic and policy", () => {
		const parsed = parsePreflightResponse(
			"```json\n{\"call-1\":{\"intrinsic\":{\"summary\":\"List files\",\"destructive\":false},\"policy\":{\"decision\":\"ask\",\"reason\":\"Needs confirmation\"}}}\n```",
		);
		expect(parsed?.["call-1"]).toBeDefined();
	});

	it("requires intrinsic metadata for every tool call", () => {
		const toolCalls: ToolCallSummary[] = [
			{ id: "call-1", name: "bash", args: { command: "ls" } },
			{ id: "call-2", name: "write", args: { path: "note.txt", content: "hi" } },
		];
		const parsed = parsePreflightResponse(
			"{\"call-1\":{\"intrinsic\":{\"summary\":\"List files\",\"destructive\":false},\"policy\":{\"decision\":\"none\",\"reason\":\"No rules\"}}}",
		);
		expect(normalizePreflight(parsed, toolCalls, { "call-1": [], "call-2": [] })).toBeUndefined();
	});

	it("sanitizes summaries and falls back policy to none on invalid policy payload", () => {
		const toolCalls: ToolCallSummary[] = [{ id: "call-1", name: "bash", args: { command: "ls" } }];
		const parsed = parsePreflightResponse(
			"{\"call-1\":{\"intrinsic\":{\"summary\":\"Run bash to list files\",\"destructive\":false},\"policy\":{\"decision\":\"maybe\",\"reason\":\"oops\"}}}",
		);
		const normalized = normalizePreflight(parsed, toolCalls, { "call-1": ["ask before running bash"] });
		expect(normalized?.metadata["call-1"].summary).toBe("List files");
		expect(normalized?.policyDecisions["call-1"]).toEqual({
			decision: "none",
			reason: "Policy response missing or invalid; fallback applied.",
		});
	});
});

describe("buildPreflightMetadata", () => {
	it("uses one LLM call for intrinsic+policy and logs prompt/raw response", async () => {
		const streamMock = vi.mocked(streamSimple);
		streamMock.mockResolvedValue({
			async *[Symbol.asyncIterator]() {
				return;
			},
			result: async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							"call-1": {
								intrinsic: { summary: "List directory", destructive: false },
								policy: { decision: "ask", reason: "Needs confirmation" },
							},
						}),
					},
				],
			}),
		} as unknown as Awaited<ReturnType<typeof streamSimple>>);

		const logs: string[] = [];
		const toolCalls: ToolCallSummary[] = [{ id: "call-1", name: "bash", args: { command: "ls" } }];
		const result = await buildPreflightMetadata(
			buildEvent(toolCalls),
			{ "call-1": ["Ask before shell commands"] },
			createContext(),
			baseConfig,
			(message) => logs.push(message),
		);

		expect(streamMock).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.metadata["call-1"].summary).toBe("List directory");
			expect(result.policyDecisions["call-1"]).toEqual({
				decision: "ask",
				reason: "Needs confirmation",
			});
		}
		expect(logs.some((line) => line.includes("Preflight prompt"))).toBe(true);
		expect(logs.some((line) => line.includes("Preflight raw response"))).toBe(true);
	});
});
