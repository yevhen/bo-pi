import { spawnSync } from "node:child_process";

export interface ClipboardCommand {
	command: string;
	args: string[];
}

export function getClipboardCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ClipboardCommand | undefined {
	if (platform === "darwin") {
		return { command: "pbcopy", args: [] };
	}
	if (platform === "win32") {
		return { command: "clip.exe", args: [] };
	}
	if (platform === "linux") {
		if (env.WAYLAND_DISPLAY) {
			return { command: "wl-copy", args: [] };
		}
		return { command: "xclip", args: ["-selection", "clipboard"] };
	}
	return undefined;
}

export function copyTextToClipboard(
	text: string,
	options: {
		platform?: NodeJS.Platform;
		env?: NodeJS.ProcessEnv;
		spawnSyncImpl?: typeof spawnSync;
	} = {},
): void {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const command = getClipboardCommand(platform, env);
	if (!command) {
		throw new Error("Clipboard not available on this platform");
	}

	runClipboardCommand(command.command, command.args, text, options.spawnSyncImpl ?? spawnSync);
}

export function copyRichTextToClipboard(
	plainText: string,
	html: string,
	options: {
		platform?: NodeJS.Platform;
		spawnSyncImpl?: typeof spawnSync;
	} = {},
): void {
	const platform = options.platform ?? process.platform;
	if (platform !== "darwin") {
		throw new Error("Rich clipboard is currently supported only on macOS");
	}

	const runner = options.spawnSyncImpl ?? spawnSync;
	const script = [
		"ObjC.import('AppKit');",
		"ObjC.import('Foundation');",
		"const env = $.NSProcessInfo.processInfo.environment;",
		"const plain = $.NSString.alloc.initWithDataEncoding($.NSData.alloc.initWithBase64EncodedStringOptions(env.objectForKey('PI_ASSISTANT_CLIPBOARD_PLAIN_B64'), 0), $.NSUTF8StringEncoding);",
		"const html = $.NSString.alloc.initWithDataEncoding($.NSData.alloc.initWithBase64EncodedStringOptions(env.objectForKey('PI_ASSISTANT_CLIPBOARD_HTML_B64'), 0), $.NSUTF8StringEncoding);",
		"const pasteboard = $.NSPasteboard.generalPasteboard;",
		"pasteboard.clearContents;",
		"pasteboard.setStringForType(plain, $.NSPasteboardTypeString);",
		"const htmlData = html.dataUsingEncoding($.NSUTF8StringEncoding);",
		"pasteboard.setDataForType(htmlData, $.NSPasteboardTypeHTML);",
	].join("\n");

	const env = {
		...process.env,
		PI_ASSISTANT_CLIPBOARD_PLAIN_B64: Buffer.from(plainText, "utf8").toString("base64"),
		PI_ASSISTANT_CLIPBOARD_HTML_B64: Buffer.from(html, "utf8").toString("base64"),
	};
	const result = runner("osascript", ["-l", "JavaScript", "-e", script], {
		encoding: "utf8",
		stdio: ["ignore", "ignore", "pipe"],
		env,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
		throw new Error(stderr || "Rich clipboard command failed");
	}
}

function runClipboardCommand(
	command: string,
	args: string[],
	text: string,
	runner: typeof spawnSync,
): void {
	const result = runner(command, args, {
		input: text,
		encoding: "utf8",
		stdio: ["pipe", "ignore", "pipe"],
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
		throw new Error(stderr || `Clipboard command failed: ${command}`);
	}
}
