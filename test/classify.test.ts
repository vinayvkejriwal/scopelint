import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateClassification } from "../src/classify.js";

describe("validateClassification", () => {
  it("accepts a valid canned classifier response", async () => {
    const fixture = JSON.parse(
      await readFile("fixtures/responses/pr2-admin-dashboard.json", "utf8"),
    );

    expect(validateClassification(fixture)).toMatchObject({
      summary: { in_scope: 0, out_of_scope: 1, gray_area: 0 },
      verdicts: [{ verdict: "out_of_scope", matched_clause: "2.1" }],
    });
  });

  it("rejects an out-of-scope verdict without a change-order draft", () => {
    expect(() =>
      validateClassification({
        verdicts: [
          {
            area: "Admin analytics",
            verdict: "out_of_scope",
            matched_clause: "2.1",
            rationale: "The scope excludes it.",
            estimated_effort_hours: 4,
            change_order_draft: null,
          },
        ],
        summary: { in_scope: 0, out_of_scope: 1, gray_area: 0 },
      }),
    ).toThrow("change_order_draft is required");
  });
});
