import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ToolCallSummary } from "../extensions/preflight/types.js";
import {
	getWorkspacePermissionsPath,
	persistPolicyOverride,
	persistWorkspaceRule,
	readPermissionsFile,
} from "../extensions/preflight/permissions/persistence.js";

const logDebug = () => {};

function createCtx(cwd: string): ExtensionContext {
	return {
		cwd,
		hasUI: false,
		ui: {
			notify: () => {},
		},
	} as ExtensionContext;
}

describe("permission persistence", () => {
	it("writes workspace allow rules without duplicates", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "bo-pi-"));
		const cwd = join(baseDir, "repo");
		const ctx = createCtx(cwd);
		const toolCall: ToolCallSummary = { id: "1", name: "bash", args: { command: "ls -la" } };

		try {
			persistWorkspaceRule(toolCall, "allow-persist", ctx, logDebug);
			persistWorkspaceRule(toolCall, "allow-persist", ctx, logDebug);

			const settingsPath = getWorkspacePermissionsPath(cwd);
			const settings = readPermissionsFile(settingsPath, logDebug);
			expect(settings?.permissions?.allow).toEqual(["Bash(ls -la)"]);
		} finally {
			rmSync(baseDir, { recursive: true, force: true });
		}
	});

	it("writes policy overrides", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "bo-pi-"));
		const cwd = join(baseDir, "repo");
		const ctx = createCtx(cwd);
		const toolCall: ToolCallSummary = {
			id: "2",
			name: "read",
			args: { path: "/tmp/notes.txt" },
		};

		try {
			persistPolicyOverride(toolCall, ctx, logDebug);

			const settingsPath = getWorkspacePermissionsPath(cwd);
			const settings = readPermissionsFile(settingsPath, logDebug);
			expect(settings?.preflight?.policyOverrides).toEqual(["Read(//tmp/notes.txt)"]);
		} finally {
			rmSync(baseDir, { recursive: true, force: true });
		}
	});
});
