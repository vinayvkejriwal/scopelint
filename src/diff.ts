import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DiffOptions {
  diffFile?: string;
  base: string;
}

export async function getDiff(options: DiffOptions): Promise<string> {
  if (options.diffFile) {
    try {
      return await readFile(options.diffFile, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new Error(`Diff file not found: ${options.diffFile}`);
      throw error;
    }
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    return getGitHubPullRequestDiff();
  }

  try {
    const { stdout: mergeBase } = await execFileAsync("git", ["merge-base", options.base, "HEAD"]);
    const { stdout: diff } = await execFileAsync("git", ["diff", mergeBase.trim(), "HEAD"]);
    return diff;
  } catch (error) {
    throw new Error(
      `Unable to obtain a Git diff against ${options.base}: ${(error as Error).message}`,
    );
  }
}

export interface PullRequestContext {
  number: number;
  repository: string;
  token: string;
}

export async function getGitHubPullRequestDiff(): Promise<string> {
  const context = await getGitHubPullRequestContext();
  const response = await fetch(
    `https://api.github.com/repos/${context.repository}/pulls/${context.number}`,
    {
      headers: githubHeaders(context.token, "application/vnd.github.v3.diff"),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Unable to fetch pull request diff (${response.status} ${response.statusText}): ${await response.text()}`,
    );
  }

  return response.text();
}

export async function getGitHubPullRequestContext(): Promise<PullRequestContext> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required in GitHub Actions mode.");
  if (!repository) throw new Error("GITHUB_REPOSITORY is required in GitHub Actions mode.");
  if (!token) throw new Error("GITHUB_TOKEN is required in GitHub Actions mode.");

  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(eventPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read the GitHub event payload: ${(error as Error).message}`);
  }

  const number = getPullRequestNumber(payload);
  if (!number) {
    throw new Error("The GitHub event payload does not contain a pull request number.");
  }

  return { number, repository, token };
}

export function githubHeaders(token: string, accept = "application/vnd.github+json"): HeadersInit {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": "ScopeLint",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function getPullRequestNumber(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const event = payload as { number?: unknown; pull_request?: { number?: unknown } };
  const number = event.number ?? event.pull_request?.number;
  return typeof number === "number" && Number.isInteger(number) ? number : undefined;
}
