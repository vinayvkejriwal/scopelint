#!/usr/bin/env node
import "dotenv/config";
import { access, copyFile, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { MODEL, classify } from "./classify.js";
import { postPullRequestComment } from "./comment.js";
import { getDiff } from "./diff.js";
import { appendLedgerRun, regenerateLedgerReport } from "./ledger.js";
import type { ClassificationResult, VerdictName } from "./types.js";

const program = new Command();

program
  .name("scopelint")
  .description("Lint code changes against a project's statement of work.")
  .version("0.1.0");

program
  .command("init")
  .description("Create scope.md from ScopeLint's contract template.")
  .action(async () => {
    const target = resolve("scope.md");
    try {
      await access(target, constants.F_OK);
      throw new Error("scope.md already exists; it was not changed.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await copyFile(new URL("../templates/scope-template.md", import.meta.url), target);
    console.log("Created scope.md from the ScopeLint template.");
  });

program
  .command("check")
  .description("Classify a code diff against a scope contract.")
  .option("--scope <path>", "path to the scope file", "scope.md")
  .option("--diff-file <path>", "read a unified diff from a file")
  .option("--base <ref>", "Git base reference for local diff mode", "origin/main")
  .option("--replay", "use the canned fixture response paired with the diff file")
  .option("--model <id>", "model identifier for live classification", MODEL)
  .option("--fail-on <verdict>", "exit 1 when this verdict occurs")
  .option("--update-ledger", "append verdicts to .scopelint/ledger.json and regenerate SCOPE_LEDGER.md")
  .action(async (options) => {
    const scopePath = resolve(options.scope);
    let scope: string;
    try {
      scope = await readFile(scopePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Scope file not found: ${options.scope}. Run \"scopelint init\" or pass --scope.`);
      }
      throw error;
    }

    const diff = await getDiff({ diffFile: options.diffFile, base: options.base });
    const result = await classify(scope, diff, {
      replay: options.replay || process.env.SCOPELINT_REPLAY === "1",
      diffFile: options.diffFile,
      model: options.model,
    });

    printResult(result);
    if (options.updateLedger) {
      if (process.env.GITHUB_ACTIONS === "true") {
        throw new Error("--update-ledger is a local workflow and cannot run in GitHub Actions.");
      }
      await appendLedgerRun(result);
      console.log("Scope ledger updated: .scopelint/ledger.json and SCOPE_LEDGER.md.");
    }
    if (process.env.GITHUB_ACTIONS === "true" && !options.diffFile) {
      const commentResult = await postPullRequestComment(result);
      console.log(`ScopeLint pull request comment ${commentResult}.`);
    }
    if (options.failOn) {
      validateFailOn(options.failOn);
      if (result.summary[options.failOn as VerdictName] > 0) process.exitCode = 1;
    }
  });

program
  .command("report")
  .description("Regenerate SCOPE_LEDGER.md from .scopelint/ledger.json.")
  .action(async () => {
    const totals = await regenerateLedgerReport();
    console.log("Cumulative ScopeLint totals:");
    console.log(`  In scope: ${totals.in_scope} hours`);
    console.log(`  Out of scope: ${totals.out_of_scope} hours`);
    console.log(`  Gray area: ${totals.gray_area} hours`);
    console.log(`  Out-of-scope effort: ${totals.outOfScopePercent.toFixed(1)}%`);
  });

void program.parseAsync().catch((error: Error) => {
  console.error(`ScopeLint error: ${error.message}`);
  process.exitCode = 1;
});

function validateFailOn(value: string): asserts value is VerdictName {
  if (!["out_of_scope", "gray_area"].includes(value)) {
    throw new Error('--fail-on must be "out_of_scope" or "gray_area".');
  }
}

function printResult(result: ClassificationResult): void {
  const rows = result.verdicts.map((entry) => [
    entry.area,
    entry.verdict.replaceAll("_", " ").toUpperCase(),
    entry.matched_clause ?? "—",
    String(entry.estimated_effort_hours),
  ]);
  const headers = ["AREA", "VERDICT", "CLAUSE", "EFFORT (HOURS)"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const format = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");

  console.log(format(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  rows.forEach((row) => console.log(format(row)));
  console.log(`\nSummary: ${result.summary.in_scope} in scope, ${result.summary.out_of_scope} out of scope, ${result.summary.gray_area} gray area.`);

  for (const entry of result.verdicts.filter((item) => item.verdict === "out_of_scope")) {
    console.log(`\nDraft change order: ${entry.area}\n${entry.change_order_draft}`);
  }
}
