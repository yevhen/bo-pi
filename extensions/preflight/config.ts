import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import type { KeyId } from "@mariozechner/pi-tui";
import { expandTilde } from "./utils/path.js";
import type { ApprovalMode, ModelRef, PreflightConfig, SessionConfigEntryData } from "./types.js";

export const SESSION_ENTRY_TYPE = "bo-pi-config";

export const DEFAULT_CONFIG: PreflightConfig = {
	contextMessages: 1,
	explainKey: "ctrl+e",
	model: "current",
	policyModel: "current",
	approvalMode: "all",
	debug: false,
};

export function loadPersistentConfig(): PreflightConfig {
	const filePath = getConfigFilePath();
	if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };

	try {
		const content = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		const config = parseConfig(parsed);
		return { ...DEFAULT_CONFIG, ...config };
	} catch (error) {
		return { ...DEFAULT_CONFIG };
	}
}

export function savePersistentConfig(config: PreflightConfig): void {
	const filePath = getConfigFilePath();
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

export function loadSessionOverrides(ctx: ExtensionContext): Partial<PreflightConfig> {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!isCustomEntry(entry)) continue;
		if (entry.customType !== SESSION_ENTRY_TYPE) continue;
		const data = entry.data as SessionConfigEntryData | undefined;
		if (!data || data.config === null) return {};
		return parseConfig(data.config);
	}
	return {};
}

export function parseConfig(value: unknown): Partial<PreflightConfig> {
	if (!value || typeof value !== "object") return {};

	const record = value as Record<string, unknown>;
	const config: Partial<PreflightConfig> = {};

	if (typeof record.enabled === "boolean" && record.enabled === false) {
		config.approvalMode = "off";
	}

	if (typeof record.contextMessages === "number" && Number.isFinite(record.contextMessages)) {
		const normalized = Math.floor(record.contextMessages);
		if (normalized < 0) {
			config.contextMessages = -1;
		} else if (normalized === 0) {
			config.contextMessages = 1;
		} else {
			config.contextMessages = normalized;
		}
	}

	const explainKey = parseExplainKey(record.explainKey);
	if (explainKey) {
		config.explainKey = explainKey;
	}

	if (record.model === "current") {
		config.model = "current";
	} else if (isModelRef(record.model)) {
		config.model = record.model;
	}

	if (record.policyModel === "current") {
		config.policyModel = "current";
	} else if (isModelRef(record.policyModel)) {
		config.policyModel = record.policyModel;
	}

	if (typeof record.approvalMode === "string") {
		const parsed = parseApprovalMode([record.approvalMode]);
		if (parsed) {
			config.approvalMode = parsed;
		}
	} else if (typeof record.approveDestructiveOnly === "boolean") {
		config.approvalMode = record.approveDestructiveOnly ? "destructive" : "all";
	}

	if (typeof record.debug === "boolean") {
		config.debug = record.debug;
	}

	return config;
}

export function parseExplainKey(value: unknown): KeyId | KeyId[] | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const keys = value.filter((item): item is KeyId => typeof item === "string");
		return keys.length > 0 ? keys : undefined;
	}
	return undefined;
}

export function parseModelRef(parts: string[]): PreflightConfig["model"] | undefined {
	if (parts.length === 0) return undefined;
	const joined = parts.join(" ").trim();
	if (!joined) return undefined;
	if (joined === "current") return "current";

	const [provider, id] = joined.split("/");
	if (!provider || !id) return undefined;
	return { provider, id };
}

export function parseApprovalMode(parts: string[]): ApprovalMode | undefined {
	const joined = parts.join(" ").trim().toLowerCase();
	if (!joined) return undefined;
	if (joined === "all" || joined === "all tools" || joined === "all-tools") return "all";
	if (
		joined === "destructive" ||
		joined === "destructive only" ||
		joined === "destructive-only"
	) {
		return "destructive";
	}
	if (joined === "off") return "off";
	return undefined;
}

export function parseContextValue(value: string): number | undefined {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return undefined;
	if (trimmed === "full") return -1;
	const numberValue = Number(trimmed);
	if (!Number.isFinite(numberValue)) return undefined;
	if (numberValue < 1) return undefined;
	return Math.floor(numberValue);
}

export function formatApprovalMode(mode: ApprovalMode): string {
	switch (mode) {
		case "off":
			return "off";
		case "destructive":
			return "destructive only";
		case "all":
		default:
			return "all tools";
	}
}

export function formatContextMessages(limit: number): string {
	if (limit < 0) return "full";
	return String(limit <= 0 ? 1 : limit);
}

export function formatContextLabel(limit: number): string {
	if (limit < 0) return "full";
	const safeLimit = limit <= 0 ? 1 : limit;
	return `last ${safeLimit}`;
}

export function formatModelSetting(
	modelSetting: PreflightConfig["model"],
	currentModel?: Model<unknown>,
): string {
	if (modelSetting === "current") {
		if (currentModel) {
			return `current (${currentModel.provider}/${currentModel.id})`;
		}
		return "current";
	}
	return `${modelSetting.provider}/${modelSetting.id}`;
}

function isModelRef(value: unknown): value is ModelRef {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.provider === "string" && typeof record.id === "string";
}

function isCustomEntry(entry: { type: string; customType?: string; data?: unknown }): entry is {
	type: "custom";
	customType: string;
	data?: unknown;
} {
	return entry.type === "custom" && typeof entry.customType === "string";
}

function getConfigFilePath(): string {
	return join(getAgentDir(), "extensions", "bo-pi", "preflight.json");
}

function getAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		return expandTilde(envDir);
	}
	return join(homedir(), ".pi", "agent");
}
