import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { DebugLogger, PreflightConfig } from "./types.js";
import { notify } from "./ui.js";

export function createDebugLogger(ctx: ExtensionContext, config: PreflightConfig): DebugLogger {
	if (!config.debug) {
		return () => {};
	}
	return (message) => {
		if (ctx.hasUI) {
			notify(ctx, message);
		} else {
			console.log(`[bo-pi] ${message}`);
		}
	};
}
