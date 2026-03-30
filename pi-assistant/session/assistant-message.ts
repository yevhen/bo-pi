import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export type ExtractionResult =
	| { ok: true; textBlocks: string[] }
	| { ok: false; reason: "not-found" }
	| { ok: false; reason: "empty" }
	| { ok: false; reason: "incomplete"; stopReason: string };

export function extractLastCompletedAssistantText(branch: SessionEntry[]): ExtractionResult {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") {
			continue;
		}

		const message = entry.message;
		if (message.role !== "assistant") {
			continue;
		}

		if (message.stopReason !== "stop") {
			return { ok: false, reason: "incomplete", stopReason: message.stopReason };
		}

		const textBlocks = message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.filter((block) => block.trim().length > 0);

		if (textBlocks.length > 0) {
			return { ok: true, textBlocks };
		}

		return { ok: false, reason: "empty" };
	}

	return { ok: false, reason: "not-found" };
}
