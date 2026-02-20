import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Api, Context, Model } from "@mariozechner/pi-ai";
import type { PreflightConfig, ToolCallSummary, ToolCallsContext } from "../extensions/preflight/types.js";
import { buildRuleSuggestion } from "../extensions/preflight/rule-suggestions.js";
import { streamSimple } from "@mariozechner/pi-ai";

vi.mock("@mariozechner/pi-ai", async () => {
	const actual = await vi.importActual<typeof import("@mariozechner/pi-ai")>("@mariozechner/pi-ai");
	return {
		...actual,
		streamSimple: vi.fn(),
	};
});

const model = { provider: "openai", id: "gpt-4o-mini" } as Model<Api>;

const baseConfig: PreflightConfig = {
	contextMessages: 3,
	explainKey: "ctrl+e",
	ruleSuggestionKey: "ctrl+n",
	model: "current",
	policyModel: "current",
	approvalMode: "all",
	debug: false,
};

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
		messages: [
			{ role: "user", content: "Please inspect the whole project", timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "I will do that" }], timestamp: 2 },
		],
	};
	return { toolCalls, llmContext };
}

describe("buildRuleSuggestion", () => {
	it("uses tool-call-only context for suggestion generation", async () => {
		const streamMock = vi.mocked(streamSimple);
		streamMock.mockResolvedValue({
			async *[Symbol.asyncIterator]() {
				return;
			},
			result: async () => ({
				content: [
					{
						type: "text",
						text: [
							"Allow read-only listing commands",
							"Ask before commands that modify files",
							"Deny recursive delete commands",
						].join("\n"),
					},
				],
			}),
		} as unknown as Awaited<ReturnType<typeof streamSimple>>);

		const toolCall: ToolCallSummary = {
			id: "call-1",
			name: "bash",
			args: { command: "ls -la" },
		};
		const result = await buildRuleSuggestion(
			buildEvent([toolCall]),
			toolCall,
			{ summary: "List directory contents", destructive: false },
			createContext(),
			baseConfig,
			() => {},
			[],
		);

		expect(result.status).toBe("ok");
		expect(streamMock).toHaveBeenCalledTimes(1);
		const streamContext = streamMock.mock.calls[0]?.[1];
		expect(streamContext?.messages).toHaveLength(1);
		expect(streamContext?.messages[0]?.role).toBe("user");
	});
});
