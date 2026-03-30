import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export function notifyInfo(ctx: ExtensionContext, message: string): void {
	ctx.ui.notify(message, "info");
}

export function notifyError(ctx: ExtensionContext, message: string): void {
	ctx.ui.notify(message, "error");
}
