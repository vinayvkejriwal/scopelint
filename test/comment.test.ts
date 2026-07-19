import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMENT_MARKER, postPullRequestComment, renderVerdictComment } from "../src/comment.js";
import type { ClassificationResult } from "../src/types.js";

const result: ClassificationResult = {
  verdicts: [
    {
      area: "Admin analytics endpoint",
      verdict: "out_of_scope",
      matched_clause: "2.1",
      rationale: "The scope excludes reporting dashboards.",
      estimated_effort_hours: 8,
      change_order_draft: "Please approve a change order for this work.",
    },
  ],
  summary: { in_scope: 0, out_of_scope: 1, gray_area: 0 },
};

describe("pull request comments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("updates the existing marked comment instead of creating another", async () => {
    const eventDirectory = await mkdtemp(join(tmpdir(), "scopelint-comment-test-"));
    const eventPath = join(eventDirectory, "event.json");
    await writeFile(eventPath, JSON.stringify({ number: 42 }));
    vi.stubEnv("GITHUB_EVENT_PATH", eventPath);
    vi.stubEnv("GITHUB_REPOSITORY", "acme/loyalty-api");
    vi.stubEnv("GITHUB_TOKEN", "test-token");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 7, body: `old ${COMMENT_MARKER}` }])))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postPullRequestComment(result)).resolves.toBe("updated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.github.com/repos/acme/loyalty-api/issues/comments/7",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH" });
    expect(renderVerdictComment(result)).toContain(COMMENT_MARKER);
  });
});
