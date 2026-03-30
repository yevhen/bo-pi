import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const htmlProcessor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype)
	.use(rehypeStringify);

export function renderAssistantHtml(textBlocks: string[]): string {
	return String(htmlProcessor.processSync(textBlocks.join("\n"))).trim();
}
