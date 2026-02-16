import { describe, expect, it } from "vitest";
import {
	buildCustomRuleOptionLabel,
	canCycleRuleSuggestion,
	resolveCustomRule,
} from "../extensions/preflight/approvals/approval-ui.js";

describe("custom rule approval UI helpers", () => {
	it("enables Tab suggestion accept/next only when allowed", () => {
		expect(canCycleRuleSuggestion("idle", "", 1)).toBe(true);
		expect(canCycleRuleSuggestion("loading", "", 2)).toBe(false);
		expect(canCycleRuleSuggestion("idle", "typed", 2)).toBe(false);
		expect(canCycleRuleSuggestion("idle", "", 0)).toBe(false);
		expect(canCycleRuleSuggestion("idle", "Ask before bash", 2, true, true)).toBe(true);
	});

	it("shows muted suggestion by default", () => {
		const label = buildCustomRuleOptionLabel("", "Ask before running bash", "idle");
		expect(label).toContain("Ask before running bash");
		expect(label).toContain("\u001b[38;5;244m");
	});

	it("re-shows suggestion after custom input is cleared", () => {
		const label = buildCustomRuleOptionLabel("", "Ask before running bash", "idle", true);
		expect(label).toContain("Ask before running bash");
	});

	it("uses typed text over suggestion (typed override)", () => {
		const resolved = resolveCustomRule("Allow only ls", "Ask before running bash");
		expect(resolved).toBe("Allow only ls");
	});

	it("does not auto-accept suggestion on enter", () => {
		const resolved = resolveCustomRule("", "Ask before running bash");
		expect(resolved).toBeUndefined();
	});

	it("resolves suggestion only when explicitly accepted", () => {
		const resolved = resolveCustomRule("", "Ask before running bash", { acceptSuggestion: true });
		expect(resolved).toBe("Ask before running bash");
	});
});
