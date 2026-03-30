import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { extractLastCompletedAssistantMarkdown } from "../session/assistant-message.js";
import { notifyError, notifyInfo } from "../ui/notifications.js";

const DEFAULT_OUTPUT_FILE = "assistant.md";

export function registerAssistantMdCommand(pi: ExtensionAPI): void {
	pi.registerCommand("assistant-md", {
		description: "Save the last completed assistant response to a markdown file",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const result = extractLastCompletedAssistantMarkdown(ctx.sessionManager.getBranch());
			if (!result.ok) {
				if (result.reason === "incomplete") {
					notifyError(ctx, `Last assistant message is incomplete (${result.stopReason})`);
					return;
				}

				notifyError(ctx, "No completed assistant message found");
				return;
			}

			const rawTarget = args.trim() || DEFAULT_OUTPUT_FILE;
			const targetPath = path.resolve(ctx.cwd, rawTarget);
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, result.text, "utf8");

			notifyInfo(ctx, `Saved last assistant response to ${targetPath}`);
		},
	});
}
