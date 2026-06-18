import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAssistantCommand } from "./commands/assistant.js";

export { parseAssistantCommand, HELP_TEXT } from "./commands/assistant.js";
export { extractLastCompletedAssistantText } from "./session/assistant-message.js";
export { renderAssistantMarkdown } from "./render/markdown.js";
export { renderAssistantPlain } from "./render/plain.js";
export { renderAssistantHtml } from "./render/html.js";

export default function (pi: ExtensionAPI) {
	registerAssistantCommand(pi);
}
