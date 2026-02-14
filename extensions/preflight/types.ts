import type { ToolPreflightMetadata } from "@mariozechner/pi-coding-agent";
import type { Api, Context, Model } from "@mariozechner/pi-ai";
import type { KeyId } from "@mariozechner/pi-tui";

export interface ToolCallSummary {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ToolCallsContext {
	toolCalls: ToolCallSummary[];
	llmContext: Context;
}

export type DebugLogger = (message: string) => void;

export type ConfigScope = "session" | "persistent";

export type ModelRef = { provider: string; id: string };

export type ApprovalMode = "all" | "destructive" | "off";

export interface PreflightConfig {
	contextMessages: number;
	explainKey: KeyId | KeyId[];
	model: "current" | ModelRef;
	policyModel: "current" | ModelRef;
	approvalMode: ApprovalMode;
	debug: boolean;
}

export interface SessionConfigEntryData {
	config?: unknown;
}

export type PermissionDecision = "allow" | "ask" | "deny";

export type PermissionSource = "global" | "workspace";

export interface PermissionSettingsFile {
	version?: number;
	permissions?: Record<string, unknown>;
	preflight?: Record<string, unknown>;
}

export interface PermissionEntry {
	rule: string;
	reason?: string;
}

export interface PermissionRule {
	kind: PermissionDecision;
	raw: string;
	tool: string;
	specifier?: string;
	source: PermissionSource;
	settingsPath: string;
	settingsDir: string;
	argsMatch?: unknown;
	reason?: string;
}

export interface PolicyRule {
	raw: string;
	tool: string;
	specifier?: string;
	policy: string;
	source: PermissionSource;
	settingsPath: string;
	settingsDir: string;
	argsMatch?: unknown;
}

export interface PolicyOverrideRule {
	raw: string;
	tool: string;
	specifier?: string;
	source: PermissionSource;
	settingsPath: string;
	settingsDir: string;
	argsMatch?: unknown;
}

export interface PermissionRules {
	allow: PermissionRule[];
	ask: PermissionRule[];
	deny: PermissionRule[];
}

export interface PermissionsState {
	rules: PermissionRules;
	policyRules: PolicyRule[];
	policyOverrides: PolicyOverrideRule[];
}

export interface PolicyEvaluation {
	decision: PermissionDecision;
	reason?: string;
	rule: PolicyRule;
}

export interface ToolDecision {
	decision: PermissionDecision;
	reason?: string;
	rule?: PermissionRule;
	policy?: PolicyEvaluation;
}

export type PreflightAttempt =
	| { status: "ok"; metadata: Record<string, ToolPreflightMetadata> }
	| { status: "error"; reason: string };

export type ExplanationAttempt =
	| { status: "ok"; text: string }
	| { status: "error"; reason: string };

export type PolicyAttempt =
	| { status: "ok"; decision: PermissionDecision; reason: string }
	| { status: "error"; reason: string };

export type PreflightFailureDecision =
	| { action: "retry" }
	| { action: "allow" }
	| { action: "block"; reason: string };

export type ApprovalDecision = "allow" | "allow-persist" | "deny" | "deny-persist";

export interface ApprovalResult {
	decision: ApprovalDecision;
	reason?: string;
}

export type ModelWithKey = { model: Model<Api>; apiKey: string };
