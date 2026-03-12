import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export function notify(ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, "info");
	}
}
