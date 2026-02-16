import { describe, expect, it } from "vitest";
import {
	normalizeRuleSuggestionLine,
	normalizeRuleSuggestions,
} from "../extensions/preflight/rule-suggestions.js";

describe("rule suggestion normalization", () => {
	it("capitalizes suggestion lines that start with lowercase", () => {
		const normalized = normalizeRuleSuggestionLine("allow only read-only commands");
		expect(normalized).toBe("Allow only read-only commands");
	});

	it("drops heading-only lines", () => {
		const normalized = normalizeRuleSuggestionLine(
			"Here are three policy rule suggestions for this type of operation:",
		);
		expect(normalized).toBeUndefined();
	});

	it("filters heading and keeps cleaned suggestions", () => {
		const normalized = normalizeRuleSuggestions(
			[
				"Here are three policy rule suggestions for this type of operation:",
				"1. allow list commands",
				"2. Ask before any write command",
				"3. block dangerous shell operations",
			].join("\n"),
			[],
		);

		expect(normalized).toEqual([
			"Allow list commands",
			"Ask before any write command",
			"Block dangerous shell operations",
		]);
	});
});
