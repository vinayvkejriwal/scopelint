import { getGitHubPullRequestContext, githubHeaders } from "./diff.js";
import type { ClassificationResult, Verdict, VerdictName } from "./types.js";

export const COMMENT_MARKER = "<!-- scopelint -->";

interface IssueComment {
  id: number;
  body: string | null;
}

export function renderVerdictComment(result: ClassificationResult): string {
  const rows = result.verdicts
    .map(
      (verdict) =>
        `| ${escapeTableCell(verdict.area)} | ${badge(verdict.verdict)} | ${escapeTableCell(verdict.matched_clause ?? "—")} | ${verdict.estimated_effort_hours} |`,
    )
    .join("\n");
  const table = [
    "| Area | Verdict | Matched clause | Estimated hours |",
    "| --- | --- | --- | ---: |",
    rows,
  ].join("\n");
  const changeOrders = result.verdicts
    .filter((verdict) => verdict.verdict === "out_of_scope")
    .map(renderChangeOrder)
    .join("\n\n");
  const grayAreas = result.verdicts
    .filter((verdict) => verdict.verdict === "gray_area")
    .map((verdict) => `- **Human call needed — ${verdict.area}:** ${verdict.rationale}`)
    .join("\n");

  return [
    COMMENT_MARKER,
    "## ScopeLint verdict",
    `**Summary:** ${result.summary.in_scope} in scope, ${result.summary.out_of_scope} out of scope, ${result.summary.gray_area} gray area.`,
    table,
    changeOrders,
    grayAreas,
    "Checked against scope.md by ScopeLint.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function postPullRequestComment(result: ClassificationResult): Promise<"created" | "updated"> {
  const context = await getGitHubPullRequestContext();
  const body = renderVerdictComment(result);
  const baseUrl = `https://api.github.com/repos/${context.repository}/issues`;
  const existingComment = await findScopeLintComment(
    `${baseUrl}/${context.number}/comments?per_page=100`,
    context.token,
  );

  if (existingComment) {
    await githubJson(`${baseUrl}/comments/${existingComment.id}`, context.token, "PATCH", { body });
    return "updated";
  }

  await githubJson(`${baseUrl}/${context.number}/comments`, context.token, "POST", { body });
  return "created";
}

async function findScopeLintComment(url: string, token: string): Promise<IssueComment | undefined> {
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: githubHeaders(token) });
    if (!response.ok) {
      throw new Error(
        `Unable to list pull request comments (${response.status} ${response.statusText}): ${await response.text()}`,
      );
    }

    const comments = (await response.json()) as IssueComment[];
    const matchingComment = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (matchingComment) return matchingComment;
    nextUrl = nextPageUrl(response.headers.get("link"));
  }

  return undefined;
}

async function githubJson(
  url: string,
  token: string,
  method: "POST" | "PATCH",
  payload: { body: string },
): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Unable to ${method === "POST" ? "create" : "update"} ScopeLint comment (${response.status} ${response.statusText}): ${await response.text()}`,
    );
  }
}

function renderChangeOrder(verdict: Verdict): string {
  return `<details>\n<summary>Draft change order: ${verdict.area}</summary>\n\n${verdict.change_order_draft}\n\n</details>`;
}

function badge(verdict: VerdictName): string {
  return verdict.replaceAll("_", " ").toUpperCase();
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function nextPageUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  const next = linkHeader
    .split(",")
    .find((link) => /;\s*rel="next"/.test(link));
  return next?.match(/<([^>]+)>/)?.[1];
}
