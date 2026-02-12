import { describe, expect, it } from "vitest";
import { parseConfig, parseContextValue } from "../extensions/preflight/config.js";

describe("config parsing", () => {
	it("normalizes context messages", () => {
		const zero = parseConfig({ contextMessages: 0 });
		expect(zero.contextMessages).toBe(1);

		const negative = parseConfig({ contextMessages: -5 });
		expect(negative.contextMessages).toBe(-1);
	});

	it("supports legacy flags", () => {
		const destructiveOnly = parseConfig({ approveDestructiveOnly: true });
		expect(destructiveOnly.approvalMode).toBe("destructive");

		const disabled = parseConfig({ enabled: false });
		expect(disabled.approvalMode).toBe("off");
	});

	it("parses context value", () => {
		expect(parseContextValue("full")).toBe(-1);
		expect(parseContextValue("3")).toBe(3);
		expect(parseContextValue("0")).toBeUndefined();
	});
});
