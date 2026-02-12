import type {
	ExtensionContext,
	ToolCallsBatchEvent,
	ToolPreflightMetadata,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder, keyHint, rawKeyHint } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Spacer,
	Text,
	getEditorKeybindings,
	matchesKey,
	type KeyId,
	type TUI,
} from "@mariozechner/pi-tui";
import { buildToolCallExplanation } from "../explain.js";
import { isScopeOutsideWorkspace } from "../utils/path.js";
import type { ApprovalDecision, DebugLogger, PreflightConfig, ToolCallSummary, ToolDecision } from "../types.js";

const ANSI_RESET = "\u001b[0m";
const ANSI_ACTION = "\u001b[38;5;110m";
const ANSI_DESTRUCTIVE = "\u001b[1;38;5;203m";
const ANSI_SCOPE_WARNING = "\u001b[38;5;222m";
const ANSI_MUTED = "\u001b[38;5;244m";

export async function requestApproval(
	event: ToolCallsBatchEvent,
	toolCall: ToolCallSummary,
	metadata: ToolPreflightMetadata | undefined,
	decision: ToolDecision | undefined,
	ctx: ExtensionContext,
	config: PreflightConfig,
	logDebug: DebugLogger,
): Promise<ApprovalDecision> {
	const summary = metadata?.summary ?? "Review requested action";
	const destructive = metadata?.destructive ?? true;
	const scopeDetails = buildScopeDetails(metadata, ctx.cwd);
	const scopeLine = scopeDetails ? formatScopeLine(scopeDetails.text, scopeDetails.warn) : undefined;
	const policyLine = buildPolicyLine(decision?.policy);
	const middleLine = combineApprovalLines([policyLine, scopeLine]);
	const titleLine = formatTitleLine("Agent wants to:");
	const fallbackMessage = buildApprovalMessage(summary, destructive, middleLine);
	const policyDenied = Boolean(decision?.policy && decision.policy.decision === "deny");
	const options = [
		{ label: policyDenied ? "Allow once" : "Yes", decision: "allow" as const },
		{ label: "Always (this workspace)", decision: "allow-persist" as const },
		{ label: policyDenied ? "Keep blocked" : "No", decision: "deny" as const },
		{ label: "Never (this workspace)", decision: "deny-persist" as const },
	];

	try {
		const selection = await ctx.ui.custom<ApprovalDecision | undefined>((tui, theme, _keybindings, done) => {
			let explanation: string | undefined;
			let status: "idle" | "loading" | "error" = "idle";
			let statusMessage: string | undefined;
			let explainController: AbortController | undefined;

			const explainKeys = normalizeKeyIds(config.explainKey);
			const hasExplain = explainKeys.length > 0;

			const resolveMiddleLine = (): string | undefined => {
				if (status === "loading") return formatMutedLine("Fetching explanation...");
				if (status === "error" && statusMessage) return formatWarningLine(statusMessage);
				if (explanation) return formatExplainLine(explanation);
				return middleLine;
			};

			const selector = new ApprovalSelectorComponent({
				title: buildApprovalTitle(titleLine, summary, destructive, middleLine),
				options: options.map((option) => option.label),
				theme,
				tui,
				explainKeys,
				onSelect: (option) => {
					const selected = options.find((entry) => entry.label === option);
					done(selected?.decision ?? "deny");
				},
				onCancel: () => done("deny"),
				onExplain: hasExplain ? () => startExplain() : undefined,
			});

			const updateTitle = (): void => {
				const middleLine = resolveMiddleLine();
				selector.setTitle(buildApprovalTitle(titleLine, summary, destructive, middleLine));
			};

			const fetchExplanation = async (signal: AbortSignal): Promise<void> => {
				const result = await buildToolCallExplanation(
					event,
					toolCall,
					metadata,
					ctx,
					config,
					logDebug,
					signal,
				);
				if (signal.aborted) return;

				if (result.status === "ok") {
					explanation = result.text;
					status = "idle";
					statusMessage = undefined;
				} else {
					status = "error";
					statusMessage = result.reason;
				}

				updateTitle();
				tui.requestRender();
			};

			const startExplain = (): void => {
				if (!hasExplain || status === "loading") return;
				status = "loading";
				statusMessage = undefined;
				explanation = undefined;
				updateTitle();
				tui.requestRender();

				explainController?.abort();
				explainController = new AbortController();
				void fetchExplanation(explainController.signal);
			};

			updateTitle();

			return selector;
		});

		return selection ?? "deny";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logDebug(`Approval dialog failed: ${message}`);
		const allow = await ctx.ui.confirm(titleLine, fallbackMessage);
		return allow ? "allow" : "deny";
	}
}

class ApprovalSelectorComponent extends Container {
	private options: string[];
	private selectedIndex = 0;
	private listContainer: Container;
	private titleText: Text;
	private hintText: Text;
	private theme: ExtensionContext["ui"]["theme"];
	private tui: TUI;
	private explainKeys: KeyId[];
	private onSelect: (option: string) => void;
	private onCancel: () => void;
	private onExplain?: () => void;
	private title: string;

	constructor(options: {
		title: string;
		options: string[];
		theme: ExtensionContext["ui"]["theme"];
		tui: TUI;
		explainKeys: KeyId[];
		onSelect: (option: string) => void;
		onCancel: () => void;
		onExplain?: () => void;
	}) {
		super();
		this.options = options.options;
		this.theme = options.theme;
		this.tui = options.tui;
		this.explainKeys = options.explainKeys;
		this.onSelect = options.onSelect;
		this.onCancel = options.onCancel;
		this.onExplain = options.onExplain;
		this.title = options.title;

		this.addChild(new DynamicBorder((s: string) => this.theme.fg("border", s)));
		this.addChild(new Spacer(1));

		this.titleText = new Text("", 1, 0);
		this.addChild(this.titleText);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		this.hintText = new Text("", 1, 0);
		this.addChild(this.hintText);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((s: string) => this.theme.fg("border", s)));

		this.updateTitle();
		this.updateList();
		this.updateHints();
	}

	setTitle(title: string): void {
		this.title = title;
		this.updateTitle();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateTitle();
		this.updateList();
		this.updateHints();
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "selectUp") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
			this.tui.requestRender();
			return;
		}
		if (kb.matches(keyData, "selectDown") || keyData === "j") {
			this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
			this.updateList();
			this.tui.requestRender();
			return;
		}
		if (kb.matches(keyData, "selectConfirm") || keyData === "\n") {
			const selected = this.options[this.selectedIndex];
			if (selected) this.onSelect(selected);
			return;
		}
		if (kb.matches(keyData, "selectCancel")) {
			this.onCancel();
			return;
		}
		if (this.explainKeys.length > 0 && matchesKeyList(keyData, this.explainKeys)) {
			this.onExplain?.();
		}
	}

	private updateTitle(): void {
		this.titleText.setText(this.theme.fg("accent", this.title));
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.options.length; i++) {
			const option = this.options[i] ?? "";
			const isSelected = i === this.selectedIndex;
			const text = isSelected
				? this.theme.fg("accent", "→ ") + this.theme.fg("accent", option)
				: `  ${this.theme.fg("text", option)}`;
			this.listContainer.addChild(new Text(text, 1, 0));
		}
	}

	private updateHints(): void {
		const explainHint =
			this.explainKeys.length > 0
				? `  ${rawKeyHint(formatKeyList(this.explainKeys), "explain")}`
				: "";
		const hintLine =
			rawKeyHint("↑↓", "navigate") +
			"  " +
			keyHint("selectConfirm", "select") +
			"  " +
			keyHint("selectCancel", "cancel") +
			explainHint;
		this.hintText.setText(hintLine);
	}
}

function buildApprovalTitle(
	titleLine: string,
	summary: string,
	destructive: boolean,
	middleLine?: string,
): string {
	return `${titleLine}\n${buildApprovalMessage(summary, destructive, middleLine)}`;
}

function buildApprovalMessage(summary: string, destructive: boolean, middleLine?: string): string {
	const lines = [formatActionLine(summary, destructive)];
	if (middleLine) {
		lines.push("", middleLine);
	}
	return lines.join("\n");
}

function buildScopeDetails(
	metadata: ToolPreflightMetadata | undefined,
	cwd: string,
): { text: string; warn: boolean } | undefined {
	if (!metadata?.scope?.length) return undefined;
	const text = `Scope: ${metadata.scope.join(", ")}`;
	const warn = isScopeOutsideWorkspace(metadata.scope, cwd);
	return { text, warn };
}

function buildPolicyLine(policy: ToolDecision["policy"] | undefined): string | undefined {
	if (!policy || policy.decision !== "deny") return undefined;
	const reason = policy.reason ? `: ${policy.reason}` : "";
	return formatWarningLine(`Policy blocked by ${policy.rule.raw}${reason}`);
}

function combineApprovalLines(lines: Array<string | undefined>): string | undefined {
	const filtered = lines.filter((line): line is string => Boolean(line));
	return filtered.length > 0 ? filtered.join("\n") : undefined;
}

function normalizeKeyIds(keys: KeyId | KeyId[]): KeyId[] {
	return Array.isArray(keys) ? keys : [keys];
}

function matchesKeyList(data: string, keys: KeyId[]): boolean {
	for (const key of keys) {
		if (matchesKey(data, key)) return true;
	}
	return false;
}

function formatKeyList(keys: KeyId[]): string {
	return keys.join("/");
}

function formatMutedLine(text: string): string {
	return `${ANSI_MUTED}${text}${ANSI_RESET}`;
}

function formatTitleLine(text: string): string {
	return `${ANSI_MUTED}${text}${ANSI_RESET}`;
}

function formatActionLine(text: string, destructive: boolean): string {
	const color = destructive ? ANSI_DESTRUCTIVE : ANSI_ACTION;
	return `${color}${text}${ANSI_RESET}`;
}

function formatScopeLine(text: string, warn: boolean): string {
	const color = warn ? ANSI_SCOPE_WARNING : ANSI_MUTED;
	return `${color}${text}${ANSI_RESET}`;
}

function formatExplainLine(text: string): string {
	const lines = text.split("\n");
	return lines.map((line) => formatExplainLineSegment(line)).join("\n");
}

function formatExplainLineSegment(line: string): string {
	const match = line.match(/^(low|med|high)\s+risk:\s*/i);
	if (!match) {
		return `${ANSI_RESET}${line}`;
	}
	const prefix = match[0];
	const rest = line.slice(prefix.length);
	return `${ANSI_RESET}${ANSI_SCOPE_WARNING}${prefix}${ANSI_RESET}${rest}`;
}

function formatWarningLine(text: string): string {
	return `${ANSI_SCOPE_WARNING}${text}${ANSI_RESET}`;
}
