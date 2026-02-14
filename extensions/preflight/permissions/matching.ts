import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ignore from "ignore";
import type {
	DebugLogger,
	PermissionDecision,
	PermissionEntry,
	PermissionRule,
	PermissionRules,
	PermissionSettingsFile,
	PermissionSource,
	PolicyOverrideRule,
	PolicyRule,
	ToolCallSummary,
} from "../types.js";
import { deepEqual } from "../utils/json.js";
import { toPosixPath } from "../utils/path.js";

export const PATH_TOOLS = new Set(["read", "edit", "write"]);

export function buildPermissionRules(
	settings: PermissionSettingsFile | undefined,
	source: PermissionSource,
	settingsPath: string,
	logDebug: DebugLogger,
): PermissionRules {
	const permissions = settings?.permissions;
	const allow = extractPermissionEntries(permissions?.allow);
	const ask = extractPermissionEntries(permissions?.ask);
	const deny = extractPermissionEntries(permissions?.deny);

	return {
		allow: allow
			.map((entry) =>
				compilePermissionRule(entry.rule, "allow", source, settingsPath, logDebug, entry.reason),
			)
			.filter((rule): rule is PermissionRule => Boolean(rule)),
		ask: ask
			.map((entry) =>
				compilePermissionRule(entry.rule, "ask", source, settingsPath, logDebug, entry.reason),
			)
			.filter((rule): rule is PermissionRule => Boolean(rule)),
		deny: deny
			.map((entry) =>
				compilePermissionRule(entry.rule, "deny", source, settingsPath, logDebug, entry.reason),
			)
			.filter((rule): rule is PermissionRule => Boolean(rule)),
	};
}

export function buildPolicyRules(
	settings: PermissionSettingsFile | undefined,
	source: PermissionSource,
	settingsPath: string,
	logDebug: DebugLogger,
): PolicyRule[] {
	const preflight = settings?.preflight;
	if (!preflight || typeof preflight !== "object") return [];
	const llmRules = (preflight as Record<string, unknown>).llmRules;
	if (!Array.isArray(llmRules)) return [];

	const rules: PolicyRule[] = [];
	for (const item of llmRules) {
		if (!item || typeof item !== "object") continue;
		const record = item as { pattern?: unknown; policy?: unknown };
		if (typeof record.pattern !== "string" || typeof record.policy !== "string") continue;
		const compiled = compilePolicyRule(record.pattern, record.policy, source, settingsPath, logDebug);
		if (compiled) rules.push(compiled);
	}

	return rules;
}

export function buildPolicyOverrides(
	settings: PermissionSettingsFile | undefined,
	source: PermissionSource,
	settingsPath: string,
	logDebug: DebugLogger,
): PolicyOverrideRule[] {
	const preflight = settings?.preflight;
	if (!preflight || typeof preflight !== "object") return [];
	const overrides = extractPermissionList((preflight as Record<string, unknown>).policyOverrides);

	return overrides
		.map((rule) => compilePolicyOverrideRule(rule, source, settingsPath, logDebug))
		.filter((rule): rule is PolicyOverrideRule => Boolean(rule));
}

export function extractPermissionEntries(value: unknown): PermissionEntry[] {
	if (!Array.isArray(value)) return [];
	const entries: PermissionEntry[] = [];

	for (const item of value) {
		if (typeof item === "string") {
			const rule = item.trim();
			if (rule) {
				entries.push({ rule });
			}
			continue;
		}
		if (!item || typeof item !== "object") continue;
		const record = item as { rule?: unknown; reason?: unknown };
		if (typeof record.rule !== "string") continue;
		const rule = record.rule.trim();
		if (!rule) continue;
		const reason = typeof record.reason === "string" ? record.reason.trim() : undefined;
		entries.push({ rule, reason: reason || undefined });
	}

	return entries;
}

export function extractPermissionList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export function compilePermissionRule(
	raw: string,
	kind: PermissionDecision,
	source: PermissionSource,
	settingsPath: string,
	logDebug: DebugLogger,
	reason?: string,
): PermissionRule | undefined {
	const parsed = parseToolPattern(raw);
	if (!parsed) {
		logDebug(`Ignored invalid rule: ${raw}`);
		return undefined;
	}
	const tool = normalizeToolName(parsed.tool);
	const specifier = normalizeSpecifier(parsed.specifier);
	const argsMatch = parseArgsMatch(tool, specifier, logDebug);
	if (specifier && !isKnownTool(tool) && argsMatch === undefined) {
		logDebug(`Ignored rule with unsupported args: ${raw}`);
		return undefined;
	}
	const trimmedReason = reason?.trim();
	return {
		kind,
		raw,
		tool,
		specifier,
		source,
		settingsPath,
		settingsDir: dirname(settingsPath),
		argsMatch,
		reason: trimmedReason || undefined,
	};
}

export function compilePolicyRule(
	pattern: string,
	policy: string,
	source: PermissionSource,
	settingsPath: string,
	logDebug: DebugLogger,
): PolicyRule | undefined {
	const parsed = parseToolPattern(pattern);
	if (!parsed) {
		logDebug(`Ignored invalid policy rule: ${pattern}`);
		return undefined;
	}
	const tool = normalizeToolName(parsed.tool);
	const specifier = normalizeSpecifier(parsed.specifier);
	const trimmedPolicy = policy.trim();
	if (!trimmedPolicy) {
		logDebug(`Ignored policy rule with empty policy: ${pattern}`);
		return undefined;
	}
	const argsMatch = parseArgsMatch(tool, specifier, logDebug);
	if (specifier && !isKnownTool(tool) && argsMatch === undefined) {
		logDebug(`Ignored policy rule with unsupported args: ${pattern}`);
		return undefined;
	}
	return {
		raw: pattern,
		tool,
		specifier,
		policy: trimmedPolicy,
		source,
		settingsPath,
		settingsDir: dirname(settingsPath),
		argsMatch,
	};
}

export function compilePolicyOverrideRule(
	pattern: string,
	source: PermissionSource,
	settingsPath: string,
	logDebug: DebugLogger,
): PolicyOverrideRule | undefined {
	const parsed = parseToolPattern(pattern);
	if (!parsed) {
		logDebug(`Ignored invalid policy override: ${pattern}`);
		return undefined;
	}
	const tool = normalizeToolName(parsed.tool);
	const specifier = normalizeSpecifier(parsed.specifier);
	const argsMatch = parseArgsMatch(tool, specifier, logDebug);
	if (specifier && !isKnownTool(tool) && argsMatch === undefined) {
		logDebug(`Ignored policy override with unsupported args: ${pattern}`);
		return undefined;
	}
	return {
		raw: pattern,
		tool,
		specifier,
		source,
		settingsPath,
		settingsDir: dirname(settingsPath),
		argsMatch,
	};
}

export function parseToolPattern(value: string): { tool: string; specifier?: string } | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const openIndex = trimmed.indexOf("(");
	if (openIndex === -1 || !trimmed.endsWith(")")) {
		return { tool: trimmed };
	}
	const tool = trimmed.slice(0, openIndex).trim();
	if (!tool) return undefined;
	const specifier = trimmed.slice(openIndex + 1, -1);
	return { tool, specifier };
}

export function normalizeSpecifier(specifier?: string): string | undefined {
	if (!specifier) return undefined;
	const trimmed = specifier.trim();
	if (!trimmed || trimmed === "*") return undefined;
	return trimmed;
}

export function parseArgsMatch(
	tool: string,
	specifier: string | undefined,
	logDebug: DebugLogger,
): unknown | undefined {
	if (!specifier) return undefined;
	if (isKnownTool(tool)) return undefined;
	const trimmed = specifier.trim();
	const candidate = trimmed.startsWith("args:") ? trimmed.slice(5).trim() : trimmed;
	if (!candidate) return undefined;
	if (!candidate.startsWith("{") && !candidate.startsWith("[")) return undefined;
	try {
		return JSON.parse(candidate) as unknown;
	} catch (error) {
		logDebug(`Failed to parse args matcher for ${tool}: ${candidate}`);
		return undefined;
	}
}

export function isKnownTool(tool: string): boolean {
	return tool === "bash" || PATH_TOOLS.has(tool);
}

export function normalizeToolName(name: string): string {
	return name.trim().toLowerCase();
}

export function formatRuleLabel(rule: { raw: string; source: PermissionSource }): string {
	return `${rule.raw} (${rule.source})`;
}

export function matchesPermissionRule(
	rule: PermissionRule,
	toolCall: ToolCallSummary,
	cwd: string,
): boolean {
	return matchesToolRule(rule, toolCall, cwd);
}

export function matchesPolicyRule(rule: PolicyRule, toolCall: ToolCallSummary, cwd: string): boolean {
	return matchesToolRule(rule, toolCall, cwd);
}

export function matchesPolicyOverride(
	rule: PolicyOverrideRule,
	toolCall: ToolCallSummary,
	cwd: string,
): boolean {
	return matchesToolRule(rule, toolCall, cwd);
}

export function getBashCommand(args: Record<string, unknown>): string | undefined {
	return getStringArg(args, "command") ?? getStringArg(args, "cmd");
}

export function getToolPath(args: Record<string, unknown>): string | undefined {
	return getStringArg(args, "path");
}

export function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : undefined;
}

function matchesToolRule(
	rule: { tool: string; specifier?: string; argsMatch?: unknown; settingsDir: string },
	toolCall: ToolCallSummary,
	cwd: string,
): boolean {
	const toolName = normalizeToolName(toolCall.name);
	if (toolName !== rule.tool) return false;
	if (!rule.specifier) return true;

	if (rule.tool === "bash") {
		const command = getBashCommand(toolCall.args);
		return command ? matchBashPattern(rule.specifier, command) : false;
	}

	if (PATH_TOOLS.has(rule.tool)) {
		const pathValue = getToolPath(toolCall.args);
		return pathValue ? matchPathPattern(rule.specifier, pathValue, rule.settingsDir, cwd) : false;
	}

	return matchArgs(rule, toolCall.args);
}

function matchBashPattern(pattern: string, command: string): boolean {
	const normalized = normalizeBashPattern(pattern);
	const regex = wildcardToRegExp(normalized);
	return regex.test(command);
}

function normalizeBashPattern(pattern: string): string {
	const trimmed = pattern.trim();
	if (trimmed.endsWith(":*")) {
		return `${trimmed.slice(0, -2)} *`;
	}
	return trimmed;
}

function wildcardToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

function matchPathPattern(
	pattern: string,
	targetPath: string,
	settingsDir: string,
	cwd: string,
): boolean {
	const normalized = normalizePathPattern(pattern, settingsDir, cwd);
	if (!normalized) return false;
	const { pattern: normalizedPattern, baseDir } = normalized;
	const absoluteTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(cwd, targetPath);
	const relativePath = relative(baseDir, absoluteTarget);
	if (relativePath.startsWith("..") && baseDir !== "/") {
		return false;
	}
	const matchPath = toPosixPath(relativePath);
	const ig = ignore();
	ig.add(normalizedPattern);
	return ig.ignores(matchPath);
}

function normalizePathPattern(
	pattern: string,
	settingsDir: string,
	cwd: string,
): { pattern: string; baseDir: string } | undefined {
	const trimmed = pattern.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("//")) {
		return { pattern: toPosixPath(`/${trimmed.slice(2)}`), baseDir: "/" };
	}
	if (trimmed.startsWith("~/")) {
		const absolute = resolve(homedir(), trimmed.slice(2));
		return { pattern: toPosixPath(absolute), baseDir: "/" };
	}
	if (trimmed.startsWith("/")) {
		return { pattern: toPosixPath(trimmed), baseDir: settingsDir };
	}
	if (trimmed.startsWith("./")) {
		return { pattern: toPosixPath(trimmed.slice(2)), baseDir: cwd };
	}
	return { pattern: toPosixPath(trimmed), baseDir: cwd };
}

function matchArgs(rule: { specifier?: string; argsMatch?: unknown }, args: Record<string, unknown>): boolean {
	if (!rule.specifier) return true;
	if (rule.argsMatch === undefined) return false;
	return deepEqual(rule.argsMatch, args);
}
