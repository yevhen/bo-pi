import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

export interface SaveTextOptions {
	targetPath: string;
	text: string;
	append: boolean;
	separator?: string;
}

export async function saveTextFile(options: SaveTextOptions): Promise<void> {
	await mkdir(path.dirname(options.targetPath), { recursive: true });

	if (!options.append) {
		await writeFile(options.targetPath, options.text, "utf8");
		return;
	}

	let existing = "";
	try {
		existing = await readFile(options.targetPath, "utf8");
	} catch {
		// New file.
	}

	const next = existing.length > 0 ? `${existing}${options.separator ?? ""}${options.text}` : options.text;
	await writeFile(options.targetPath, next, "utf8");
}
