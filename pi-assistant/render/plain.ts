import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import stripMarkdown from "strip-markdown";
import remarkStringify from "remark-stringify";

const plainProcessor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(stripMarkdown, {
		keep: ["code", "inlineCode", "list", "listItem"],
	})
	.use(remarkStringify, {
		bullet: "-",
		fences: true,
		listItemIndent: "one",
		resourceLink: false,
	});

export function renderAssistantPlain(textBlocks: string[]): string {
	return String(plainProcessor.processSync(textBlocks.join("\n"))).trim();
}
