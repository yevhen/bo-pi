import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { getClipboardCommand, copyRichTextToClipboard, copyTextToClipboard } from "../pi-assistant/clipboard/copy.js";
import { HELP_TEXT, copyAssistantText, parseAssistantCommand } from "../pi-assistant/commands/assistant.js";
import { renderAssistantHtml } from "../pi-assistant/render/html.js";
import { saveTextFile } from "../pi-assistant/file/save.js";
import { renderAssistantMarkdown } from "../pi-assistant/render/markdown.js";
import { renderAssistantPlain } from "../pi-assistant/render/plain.js";
import { extractLastCompletedAssistantText } from "../pi-assistant/session/assistant-message.js";

function usage() {
	return {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function assistantEntry(
	content: Array<
		| { type: "text"; text: string }
		| { type: "thinking"; thinking: string }
		| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
	>,
	stopReason: "stop" | "length" | "toolUse" | "error" | "aborted" = "stop",
): SessionEntry {
	return {
		type: "message",
		id: crypto.randomUUID().slice(0, 8),
		parentId: null,
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content,
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5.2",
			usage: usage(),
			stopReason,
			timestamp: Date.now(),
		},
	};
}

function userEntry(text: string): SessionEntry {
	return {
		type: "message",
		id: crypto.randomUUID().slice(0, 8),
		parentId: null,
		timestamp: new Date().toISOString(),
		message: {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		},
	};
}

describe("extractLastCompletedAssistantText", () => {
	it("returns the last assistant text blocks", () => {
		const result = extractLastCompletedAssistantText([
			userEntry("hello"),
			assistantEntry([
				{ type: "thinking", thinking: "hidden" },
				{ type: "text", text: "# Title" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
				{ type: "text", text: "Body" },
			]),
		]);

		expect(result).toEqual({ ok: true, textBlocks: ["# Title", "Body"] });
	});

	it("fails when the most recent assistant message is incomplete", () => {
		const result = extractLastCompletedAssistantText([
			assistantEntry([{ type: "text", text: "done" }]),
			assistantEntry([{ type: "text", text: "still streaming" }], "length"),
		]);

		expect(result).toEqual({ ok: false, reason: "incomplete", stopReason: "length" });
	});

	it("returns empty when the last completed assistant message has no text", () => {
		const result = extractLastCompletedAssistantText([
			userEntry("hello"),
			assistantEntry([{ type: "thinking", thinking: "hidden" }]),
		]);

		expect(result).toEqual({ ok: false, reason: "empty" });
	});
});

describe("assistant rendering", () => {
	it("renders markdown by joining text blocks", () => {
		expect(renderAssistantMarkdown(["# Title", "Body"])).toBe("# Title\nBody");
	});

	it("renders plain text by stripping basic markdown", () => {
		const plain = renderAssistantPlain([
			"# Title",
			"Some **bold** text and [a link](https://example.com).",
			"- one",
			"- two",
			"```ts\nconst x = 1;\n```",
		]);

		expect(plain).toBe("Title\n\nSome bold text and a link.\n\n- one\n- two\n\n```ts\nconst x = 1;\n```");
	});

	it("renders html for rich clipboard copy", () => {
		const html = renderAssistantHtml([
			"# Title",
			"Some **bold** text and [a link](https://example.com).",
			"- one",
			"- two",
			"```ts\nconst x = 1;\n```",
		]);

		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain('<a href="https://example.com">a link</a>');
		expect(html).toContain("<ul>");
		expect(html).toContain("<pre><code class=\"language-ts\">const x = 1;");
	});

	it("renders gfm tables and task lists for rich clipboard copy", () => {
		const html = renderAssistantHtml([
			"| A | B |",
			"| - | - |",
			"| 1 | 2 |",
			"",
			"- [x] done",
			"- [ ] todo",
		]);

		expect(html).toContain("<table>");
		expect(html).toContain("<th>A</th>");
		expect(html).toContain("<td>1</td>");
		expect(html).toContain('class="contains-task-list"');
		expect(html).toContain('type="checkbox" checked disabled');
		expect(html).toContain('type="checkbox" disabled');
	});

	it("renders gfm task lists as plain text", () => {
		const plain = renderAssistantPlain([
			"- [x] done",
			"- [ ] todo",
		]);

		expect(plain).toBe("- [x] done\n- [ ] todo");
	});
});

describe("assistant command parsing", () => {
	it("supports interactive and help forms", () => {
		expect(parseAssistantCommand("")).toEqual({ ok: true, value: { kind: "interactive" } });
		expect(parseAssistantCommand("help")).toEqual({ ok: true, value: { kind: "help" } });
		expect(parseAssistantCommand("-h")).toEqual({ ok: true, value: { kind: "help" } });
		expect(parseAssistantCommand("--help")).toEqual({ ok: true, value: { kind: "help" } });
		expect(HELP_TEXT).toContain("/assistant copy");
	});

	it("parses copy commands", () => {
		expect(parseAssistantCommand("copy")).toEqual({
			ok: true,
			value: { kind: "copy", format: "markdown" },
		});
		expect(parseAssistantCommand("copy plain")).toEqual({
			ok: true,
			value: { kind: "copy", format: "plain" },
		});
		expect(parseAssistantCommand("copy rich")).toEqual({
			ok: true,
			value: { kind: "copy", format: "rich" },
		});
	});

	it("parses save commands with flags", () => {
		expect(parseAssistantCommand("save")).toEqual({
			ok: true,
			value: { kind: "save", format: "markdown", append: false, path: undefined },
		});
		expect(parseAssistantCommand("save notes.md --append")).toEqual({
			ok: true,
			value: { kind: "save", format: "markdown", append: true, path: "notes.md" },
		});
		expect(parseAssistantCommand("save notes.txt --format plain --append")).toEqual({
			ok: true,
			value: { kind: "save", format: "plain", append: true, path: "notes.txt" },
		});
	});

	it("rejects invalid commands", () => {
		expect(parseAssistantCommand("copy html")).toEqual({ ok: false, error: "Invalid copy arguments." });
		expect(parseAssistantCommand("save notes.md --format html")).toEqual({ ok: false, error: "Invalid save format." });
		expect(parseAssistantCommand("wat")).toEqual({ ok: false, error: "Unknown assistant action." });
	});
});

describe("assistant copy behavior", () => {
	it("falls back from rich to plain text on non-macOS", () => {
		const copyText = vi.fn();
		const copyRich = vi.fn();

		const result = copyAssistantText(["# Title", "- [x] done"], "rich", {
			platform: "linux",
			copyText,
			copyRich,
		});

		expect(copyRich).not.toHaveBeenCalled();
		expect(copyText).toHaveBeenCalledWith("Title\n\n- [x] done", expect.objectContaining({ platform: "linux" }));
		expect(result).toEqual({
			actualFormat: "plain",
			message: "Rich clipboard is not supported on this platform; copied plain text instead",
		});
	});

	it("keeps rich copy on macOS", () => {
		const copyText = vi.fn();
		const copyRich = vi.fn();

		const result = copyAssistantText(["# Title", "**bold**"], "rich", {
			platform: "darwin",
			copyText,
			copyRich,
		});

		expect(copyText).not.toHaveBeenCalled();
		expect(copyRich).toHaveBeenCalled();
		expect(result).toEqual({
			actualFormat: "rich",
			message: "Copied last assistant message as rich text",
		});
	});
});

describe("saveTextFile", () => {
	it("overwrites files", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "pi-assistant-"));
		const file = path.join(dir, "assistant.md");
		await saveTextFile({ targetPath: file, text: "first", append: false });
		await saveTextFile({ targetPath: file, text: "second", append: false });
		expect(await readFile(file, "utf8")).toBe("second");
	});

	it("appends with separator for existing files", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "pi-assistant-"));
		const file = path.join(dir, "assistant.md");
		await saveTextFile({ targetPath: file, text: "first", append: false });
		await saveTextFile({ targetPath: file, text: "second", append: true, separator: "\n\n---\n\n" });
		expect(await readFile(file, "utf8")).toBe("first\n\n---\n\nsecond");
	});

	it("appends without separator for new files", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "pi-assistant-"));
		const file = path.join(dir, "assistant.txt");
		await saveTextFile({ targetPath: file, text: "first", append: true, separator: "\n\n" });
		expect(await readFile(file, "utf8")).toBe("first");
	});
});

describe("clipboard helpers", () => {
	it("selects clipboard commands by platform", () => {
		expect(getClipboardCommand("darwin", {})).toEqual({ command: "pbcopy", args: [] });
		expect(getClipboardCommand("win32", {})).toEqual({ command: "clip.exe", args: [] });
		expect(getClipboardCommand("linux", { WAYLAND_DISPLAY: "wayland-1" })).toEqual({
			command: "wl-copy",
			args: [],
		});
		expect(getClipboardCommand("linux", {})).toEqual({
			command: "xclip",
			args: ["-selection", "clipboard"],
		});
	});

	it("writes clipboard content via spawned command", () => {
		const spawnSyncImpl = vi.fn().mockReturnValue({ status: 0, stderr: "", error: undefined });
		copyTextToClipboard("hello", { platform: "darwin", env: {}, spawnSyncImpl });
		expect(spawnSyncImpl).toHaveBeenCalledWith("pbcopy", [], expect.objectContaining({ input: "hello" }));
	});

	it("throws when clipboard command fails", () => {
		const spawnSyncImpl = vi.fn().mockReturnValue({ status: 1, stderr: "boom", error: undefined });
		expect(() =>
			copyTextToClipboard("hello", { platform: "linux", env: {}, spawnSyncImpl }),
		).toThrow("boom");
	});

	it("writes rich clipboard content on macOS", () => {
		const spawnSyncImpl = vi.fn().mockReturnValue({ status: 0, stderr: "", error: undefined });
		copyRichTextToClipboard("hello", "<p>hello</p>", { platform: "darwin", spawnSyncImpl });
		expect(spawnSyncImpl).toHaveBeenCalledWith(
			"osascript",
			expect.arrayContaining(["-l", "JavaScript"]),
			expect.objectContaining({
				env: expect.objectContaining({
					PI_ASSISTANT_CLIPBOARD_PLAIN_B64: Buffer.from("hello", "utf8").toString("base64"),
					PI_ASSISTANT_CLIPBOARD_HTML_B64: Buffer.from("<p>hello</p>", "utf8").toString("base64"),
				}),
			}),
		);
	});

	it("rejects rich clipboard on non-macOS", () => {
		expect(() => copyRichTextToClipboard("hello", "<p>hello</p>", { platform: "linux" })).toThrow(
			"Rich clipboard is currently supported only on macOS",
		);
	});
});
