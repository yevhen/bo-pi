import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
	ApprovalDecision,
	DebugLogger,
	PermissionDecision,
	PermissionEntry,
	PermissionSettingsFile,
	ToolCallSummary,
} from "../types.js";
import { notify } from "../ui.js";
import { stableStringify } from "../utils/json.js";
import { toPosixPath } from "../utils/path.js";
import {
	PATH_TOOLS,
	extractPermissionEntries,
	extractPermissionList,
	getBashCommand,
	getToolPath,
	normalizeToolName,
} from "./matching.js";

const WORKSPACE_PERMISSIONS_PATH = join(".pi", "preflight", "settings.local.json");
const GLOBAL_PERMISSIONS_PATH = join(".pi", "preflight", "settings.json");

export function persistWorkspaceRule(
	toolCall: ToolCallSummary,
	decision: ApprovalDecision,
	ctx: ExtensionContext,
	logDebug: DebugLogger,
	reason?: string,
): void {
	const ruleKind: PermissionDecision = decision === "allow-persist" ? "allow" : "deny";
	const rule = buildRuleForToolCall(toolCall, ctx.cwd);
	if (!rule) {
		notify(ctx, "Could not save rule for this tool call.");
		logDebug(`Failed to build rule for ${toolCall.name}.`);
		return;
	}

	const filePath = getWorkspacePermissionsPath(ctx.cwd);
	const saved = addRuleToPermissionsFile(
		filePath,
		ruleKind,
		rule,
		ctx,
		logDebug,
		decision === "deny-persist" ? reason : undefined,
	);
	if (saved) {
		logDebug(`Saved ${ruleKind} rule to ${filePath}: ${rule}`);
	}
}

export function persistPolicyOverride(
	toolCall: ToolCallSummary,
	ctx: ExtensionContext,
	logDebug: DebugLogger,
): void {
	const rule = buildRuleForToolCall(toolCall, ctx.cwd);
	if (!rule) {
		notify(ctx, "Could not save policy override for this tool call.");
		logDebug(`Failed to build policy override for ${toolCall.name}.`);
		return;
	}

	const filePath = getWorkspacePermissionsPath(ctx.cwd);
	const saved = addPolicyOverrideToPermissionsFile(filePath, rule, ctx, logDebug);
	if (saved) {
		logDebug(`Saved policy override to ${filePath}: ${rule}`);
	}
}

function addRuleToPermissionsFile(
	filePath: string,
	kind: PermissionDecision,
	rule: string,
	ctx: ExtensionContext,
	logDebug: DebugLogger,
	reason?: string,
): boolean {
	const existing = readPermissionsFile(filePath, logDebug) ?? {};
	const normalized = normalizePermissionsRecord(existing.permissions);

	const list = kind === "deny" ? normalized.deny : kind === "ask" ? normalized.ask : normalized.allow;
	if (list.some((entry) => entry.rule === rule)) {
		notify(ctx, `Rule already exists: ${rule}`);
		return false;
	}

	const trimmedReason = reason?.trim();
	list.unshift({ rule, reason: trimmedReason || undefined });
	const nextPermissions = {
		...normalized.record,
		allow: formatPermissionEntries(normalized.allow),
		ask: formatPermissionEntries(normalized.ask),
		deny: formatPermissionEntries(normalized.deny),
	};
	const nextConfig: PermissionSettingsFile = {
		...existing,
		version: typeof existing.version === "number" ? existing.version : 1,
		permissions: nextPermissions,
	};

	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`);
	if (ctx.hasUI) {
		ctx.ui.notify(`Saved ${kind} rule: ${rule}`, "info");
	}
	return true;
}

function addPolicyOverrideToPermissionsFile(
	filePath: string,
	rule: string,
	ctx: ExtensionContext,
	logDebug: DebugLogger,
): boolean {
	const existing = readPermissionsFile(filePath, logDebug) ?? {};
	const preflight = normalizePreflightRecord(existing.preflight);
	const overrides = extractPermissionList(preflight.policyOverrides);

	if (overrides.includes(rule)) {
		notify(ctx, `Policy override already exists: ${rule}`);
		return false;
	}

	overrides.unshift(rule);
	const nextPreflight = {
		...preflight.record,
		policyOverrides: overrides,
	};
	const nextConfig: PermissionSettingsFile = {
		...existing,
		version: typeof existing.version === "number" ? existing.version : 1,
		preflight: nextPreflight,
	};

	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`);
	if (ctx.hasUI) {
		ctx.ui.notify(`Saved policy override: ${rule}`, "info");
	}
	return true;
}

function normalizePermissionsRecord(value: Record<string, unknown> | undefined): {
	record: Record<string, unknown>;
	allow: PermissionEntry[];
	ask: PermissionEntry[];
	deny: PermissionEntry[];
} {
	const record = value && typeof value === "object" ? { ...value } : {};
	const allow = extractPermissionEntries(record.allow);
	const ask = extractPermissionEntries(record.ask);
	const deny = extractPermissionEntries(record.deny);
	return { record, allow, ask, deny };
}

function formatPermissionEntries(
	entries: PermissionEntry[],
): Array<string | { rule: string; reason: string }> {
	return entries.map((entry) => {
		if (entry.reason) {
			return { rule: entry.rule, reason: entry.reason };
		}
		return entry.rule;
	});
}

function normalizePreflightRecord(value: Record<string, unknown> | undefined): {
	record: Record<string, unknown>;
	policyOverrides: string[];
} {
	const record = value && typeof value === "object" ? { ...value } : {};
	const policyOverrides = extractPermissionList(record.policyOverrides);
	return { record, policyOverrides };
}

function buildRuleForToolCall(toolCall: ToolCallSummary, cwd: string): string | undefined {
	const toolName = formatRuleToolName(toolCall.name);
	const toolKey = normalizeToolName(toolCall.name);

	if (toolKey === "bash") {
		const command = getBashCommand(toolCall.args);
		return command ? `${toolName}(${command})` : undefined;
	}

	if (PATH_TOOLS.has(toolKey)) {
		const pathValue = getToolPath(toolCall.args);
		if (!pathValue) return undefined;
		return `${toolName}(${formatPathRule(pathValue)})`;
	}

	const argsString = stableStringify(toolCall.args);
	if (!argsString) return undefined;
	return `${toolName}(args:${argsString})`;
}

function formatRuleToolName(name: string): string {
	const normalized = normalizeToolName(name);
	if (normalized === "bash") return "Bash";
	if (normalized === "read") return "Read";
	if (normalized === "edit") return "Edit";
	if (normalized === "write") return "Write";
	return name;
}

function formatPathRule(pathValue: string): string {
	const trimmed = pathValue.trim();
	if (!trimmed) return trimmed;
	if (trimmed.startsWith("~/")) {
		return toPosixPath(trimmed);
	}
	if (isAbsolute(trimmed)) {
		const absolute = resolve(trimmed);
		return `//${toPosixPath(absolute).replace(/^\/+/, "")}`;
	}
	return toPosixPath(trimmed);
}

export function readPermissionsFile(
	filePath: string,
	logDebug: DebugLogger,
): PermissionSettingsFile | undefined {
	if (!existsSync(filePath)) return undefined;
	try {
		const content = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		if (!parsed || typeof parsed !== "object") return undefined;
		return parsed as PermissionSettingsFile;
	} catch (error) {
		logDebug(`Failed to read permissions file ${filePath}.`);
		return undefined;
	}
}

export function getWorkspacePermissionsPath(cwd: string): string {
	return join(cwd, WORKSPACE_PERMISSIONS_PATH);
}

export function getGlobalPermissionsPath(): string {
	return join(homedir(), GLOBAL_PERMISSIONS_PATH);
}
