import * as path from "node:path";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { copyRichTextToClipboard, copyTextToClipboard } from "../clipboard/copy.js";
import { renderAssistantHtml } from "../render/html.js";
import { saveTextFile } from "../file/save.js";
import { renderAssistantMarkdown } from "../render/markdown.js";
import { renderAssistantPlain } from "../render/plain.js";
import { extractLastCompletedAssistantText } from "../session/assistant-message.js";
import { notifyError, notifyInfo } from "../ui/notifications.js";

export type AssistantFormat = "markdown" | "plain";
export type AssistantCopyFormat = AssistantFormat | "rich";

type ParsedAssistantCommand =
	| { kind: "interactive" }
	| { kind: "help" }
	| { kind: "copy"; format: AssistantCopyFormat }
	| { kind: "save"; format: AssistantFormat; path?: string; append: boolean };

const HELP_TEXT = [
	"/assistant copy [markdown|plain|rich]",
	"/assistant save [path] [--append] [--format markdown|plain]",
	"",
	"Examples:",
	"  /assistant copy",
	"  /assistant copy plain",
	"  /assistant copy rich",
	"  /assistant save",
	"  /assistant save notes.md --append",
	"  /assistant save notes.txt --format plain",
].join("\n");

export function registerAssistantCommand(pi: ExtensionAPI): void {
	pi.registerCommand("assistant", {
		description: "Copy or save the last completed assistant response",
		getArgumentCompletions: getAssistantArgumentCompletions,
		handler: async (args, ctx) => {
			const parsed = parseAssistantCommand(args);
			if (!parsed.ok) {
				notifyError(ctx, `${parsed.error} Run /assistant help`);
				return;
			}

			const command =
				parsed.value.kind === "interactive"
					? await selectAssistantAction(ctx)
					: parsed.value;
			if (!command) return;
			if (command.kind === "help") {
				notifyInfo(ctx, HELP_TEXT);
				return;
			}

			await ctx.waitForIdle();
			const extracted = extractLastCompletedAssistantText(ctx.sessionManager.getBranch());
			if (!extracted.ok) {
				if (extracted.reason === "incomplete") {
					notifyError(ctx, `Last assistant message is incomplete (${extracted.stopReason})`);
					return;
				}
				notifyError(
					ctx,
					extracted.reason === "empty"
						? "Last completed assistant message has no text content"
						: "No completed assistant message found",
				);
				return;
			}

			if (command.kind === "copy") {
				try {
					const copyResult = copyAssistantText(extracted.textBlocks, command.format);
					notifyInfo(ctx, copyResult.message);
				} catch (error) {
					notifyError(ctx, error instanceof Error ? error.message : String(error));
				}
				return;
			}

			const text = renderAssistantText(extracted.textBlocks, command.format);

			const defaultPath = getDefaultPath(command.format);
			const rawPath = command.path ?? (await promptForPath(ctx, command, defaultPath));
			if (!rawPath) return;
			const targetPath = path.resolve(ctx.cwd, rawPath);
			await saveTextFile({
				targetPath,
				text,
				append: command.append,
				separator: getAppendSeparator(command.format),
			});
			notifyInfo(
				ctx,
				command.append
					? `Appended ${formatLabel(command.format)} to ${targetPath}`
					: `Saved ${formatLabel(command.format)} to ${targetPath}`,
			);
		},
	});
}

export function parseAssistantCommand(args: string):
	| { ok: true; value: ParsedAssistantCommand }
	| { ok: false; error: string } {
	const trimmed = args.trim();
	if (!trimmed) {
		return { ok: true, value: { kind: "interactive" } };
	}
	if (trimmed === "help" || trimmed === "-h" || trimmed === "--help") {
		return { ok: true, value: { kind: "help" } };
	}

	const parts = trimmed.split(/\s+/);
	const action = parts.shift()?.toLowerCase();
	if (action === "copy") {
		const format = parseCopyFormatToken(parts[0]);
		if (parts.length > 1 || (parts[0] && !format)) {
			return { ok: false, error: "Invalid copy arguments." };
		}
		return { ok: true, value: { kind: "copy", format: format ?? "markdown" } };
	}

	if (action === "save") {
		let targetPath: string | undefined;
		let format: AssistantFormat = "markdown";
		let append = false;

		for (let i = 0; i < parts.length; i += 1) {
			const part = parts[i]!;
			if (part === "--append") {
				append = true;
				continue;
			}
			if (part === "--format") {
				const next = parts[i + 1];
				const parsed = parseFormatToken(next);
				if (!parsed) {
					return { ok: false, error: "Invalid save format." };
				}
				format = parsed;
				i += 1;
				continue;
			}
			if (part.startsWith("--")) {
				return { ok: false, error: `Unknown flag ${part}.` };
			}
			if (targetPath) {
				return { ok: false, error: "Too many save arguments." };
			}
			targetPath = part;
		}

		return { ok: true, value: { kind: "save", path: targetPath, format, append } };
	}

	return { ok: false, error: "Unknown assistant action." };
}

function parseFormatToken(value?: string): AssistantFormat | undefined {
	if (!value) return undefined;
	if (value === "markdown" || value === "plain") return value;
	return undefined;
}

function parseCopyFormatToken(value?: string): AssistantCopyFormat | undefined {
	if (!value) return undefined;
	if (value === "rich") return value;
	return parseFormatToken(value);
}

function renderAssistantText(textBlocks: string[], format: AssistantFormat): string {
	return format === "plain" ? renderAssistantPlain(textBlocks) : renderAssistantMarkdown(textBlocks);
}

export function copyAssistantText(
	textBlocks: string[],
	format: AssistantCopyFormat,
	options: {
		platform?: NodeJS.Platform;
		copyText?: typeof copyTextToClipboard;
		copyRich?: typeof copyRichTextToClipboard;
	} = {},
): { actualFormat: AssistantCopyFormat | AssistantFormat; message: string } {
	const platform = options.platform ?? process.platform;
	const copyText = options.copyText ?? copyTextToClipboard;
	const copyRich = options.copyRich ?? copyRichTextToClipboard;

	if (format === "rich") {
		if (platform === "darwin") {
			copyRich(renderAssistantPlain(textBlocks), renderAssistantHtml(textBlocks), { platform });
			return {
				actualFormat: "rich",
				message: `Copied last assistant message as ${formatLabel("rich")}`,
			};
		}

		copyText(renderAssistantPlain(textBlocks), { platform, env: process.env });
		return {
			actualFormat: "plain",
			message: "Rich clipboard is not supported on this platform; copied plain text instead",
		};
	}

	copyText(renderAssistantText(textBlocks, format), { platform, env: process.env });
	return {
		actualFormat: format,
		message: `Copied last assistant message as ${formatLabel(format)}`,
	};
}

function getDefaultPath(format: AssistantFormat): string {
	return format === "plain" ? "assistant.txt" : "assistant.md";
}

function getAppendSeparator(format: AssistantFormat): string {
	return format === "plain" ? "\n\n" : "\n\n---\n\n";
}

function formatLabel(format: AssistantCopyFormat): string {
	if (format === "plain") return "plain text";
	if (format === "rich") return "rich text";
	return "markdown";
}

async function selectAssistantAction(ctx: {
	hasUI: boolean;
	ui: { select: (title: string, options: string[]) => Promise<string | undefined> };
}): Promise<ParsedAssistantCommand | undefined> {
	if (!ctx.hasUI) {
		return { kind: "help" };
	}
	const options = [
		"Copy markdown",
		"Copy plain text",
		"Copy rich text",
		"Save markdown",
		"Save plain text",
		"Append markdown to file",
		"Append plain text to file",
		"Help",
	];
	const selection = await ctx.ui.select("Assistant actions", options);
	if (!selection) return undefined;
	if (selection === "Copy markdown") return { kind: "copy", format: "markdown" };
	if (selection === "Copy plain text") return { kind: "copy", format: "plain" };
	if (selection === "Copy rich text") return { kind: "copy", format: "rich" };
	if (selection === "Save markdown") return { kind: "save", format: "markdown", append: false };
	if (selection === "Save plain text") return { kind: "save", format: "plain", append: false };
	if (selection === "Append markdown to file") return { kind: "save", format: "markdown", append: true };
	if (selection === "Append plain text to file") return { kind: "save", format: "plain", append: true };
	if (selection === "Help") return { kind: "help" };
	return undefined;
}

async function promptForPath(
	ctx: { ui: { input: (title: string, value?: string) => Promise<string | undefined> } },
	command: Extract<ParsedAssistantCommand, { kind: "save" }>,
	defaultPath: string,
): Promise<string | undefined> {
	return ctx.ui.input(command.append ? `Append ${formatLabel(command.format)}` : `Save ${formatLabel(command.format)}`, defaultPath);
}

function getAssistantArgumentCompletions(prefix: string): AutocompleteItem[] | null {
	const suggestions = [
		"help",
		"copy",
		"copy markdown",
		"copy plain",
		"copy rich",
		"save",
		"save assistant.md",
		"save assistant.md --append",
		"save assistant.txt --format plain",
	];
	const items = suggestions
		.filter((value) => value.startsWith(prefix))
		.map((value) => ({ value, label: value }));
	return items.length > 0 ? items : null;
}

export { HELP_TEXT };
