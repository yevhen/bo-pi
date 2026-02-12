import { describe, expect, it } from "vitest";
import { parsePolicyDecision, parsePolicyResponse } from "../extensions/preflight/permissions/policy.js";

describe("policy parsing", () => {
	it("parses decisions case-insensitively", () => {
		expect(parsePolicyDecision("ALLOW")).toBe("allow");
		expect(parsePolicyDecision("ask")).toBe("ask");
		expect(parsePolicyDecision("Deny")).toBe("deny");
	});

	it("parses JSON response", () => {
		const parsed = parsePolicyResponse(
			"```json\n{\"decision\":\"deny\",\"reason\":\"blocked\"}\n```",
		);
		expect(parsed).toEqual({ decision: "deny", reason: "blocked" });
	});

	it("rejects invalid responses", () => {
		const missingReason = parsePolicyResponse("{\"decision\":\"allow\"}");
		expect(missingReason).toBeUndefined();

		const invalidDecision = parsePolicyResponse("{\"decision\":\"maybe\",\"reason\":\"nope\"}");
		expect(invalidDecision).toBeUndefined();
	});
});
