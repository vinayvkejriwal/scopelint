import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VERDICTS, type ClassificationResult, type Verdict, type VerdictName } from "./types.js";

const LEDGER_PATH = join(".scopelint", "ledger.json");
const REPORT_PATH = "SCOPE_LEDGER.md";

export interface LedgerRun {
  date: string;
  pull_request: number | null;
  verdicts: Verdict[];
}

export interface LedgerTotals extends Record<VerdictName, number> {
  total: number;
  outOfScopePercent: number;
}

export async function appendLedgerRun(
  result: ClassificationResult,
  pullRequest: number | null = null,
): Promise<LedgerRun[]> {
  const ledger = await readLedger();
  ledger.push({
    date: new Date().toISOString().slice(0, 10),
    pull_request: pullRequest,
    verdicts: result.verdicts,
  });
  await writeLedger(ledger);
  await generateLedgerReport(ledger);
  return ledger;
}

export async function readLedger(): Promise<LedgerRun[]> {
  let raw: string;
  try {
    raw = await readFile(LEDGER_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  try {
    return validateLedger(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Unable to read ${LEDGER_PATH}: ${(error as Error).message}`);
  }
}

export async function regenerateLedgerReport(): Promise<LedgerTotals> {
  const ledger = await readLedger();
  return generateLedgerReport(ledger);
}

export function calculateLedgerTotals(ledger: LedgerRun[]): LedgerTotals {
  const totals = { in_scope: 0, out_of_scope: 0, gray_area: 0 } as Record<VerdictName, number>;
  for (const run of ledger) {
    for (const verdict of run.verdicts) {
      totals[verdict.verdict] += verdict.estimated_effort_hours;
    }
  }

  const total = Object.values(totals).reduce((sum, hours) => sum + hours, 0);
  return {
    ...totals,
    total,
    outOfScopePercent: total === 0 ? 0 : (totals.out_of_scope / total) * 100,
  };
}

export function renderLedgerReport(ledger: LedgerRun[]): string {
  const totals = calculateLedgerTotals(ledger);
  const outOfScopeItems = ledger.flatMap((run) =>
    run.verdicts
      .filter((verdict) => verdict.verdict === "out_of_scope")
      .map((verdict) => ({ run, verdict })),
  );
  const itemRows = outOfScopeItems.length
    ? outOfScopeItems
        .map(
          ({ run, verdict }) =>
            `| ${run.date} | ${pullRequestLabel(run.pull_request)} | ${escapeCell(verdict.area)} | ${escapeCell(verdict.matched_clause ?? "—")} | ${verdict.estimated_effort_hours} |`,
        )
        .join("\n")
    : "| — | — | No out-of-scope items recorded. | — | — |";

  return `# Scope ledger

## Cumulative totals

| Verdict | Estimated hours |
| --- | ---: |
| In scope | ${totals.in_scope} |
| Out of scope | ${totals.out_of_scope} |
| Gray area | ${totals.gray_area} |
| **Total** | **${totals.total}** |

**Out-of-scope effort:** ${totals.out_of_scope} of ${totals.total} estimated hours (${totals.outOfScopePercent.toFixed(1)}%).

## Out-of-scope items

| Date | Pull request | Area | Matched clause | Estimated hours |
| --- | --- | --- | --- | ---: |
${itemRows}
`;
}

async function writeLedger(ledger: LedgerRun[]): Promise<void> {
  await mkdir(dirname(LEDGER_PATH), { recursive: true });
  await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function generateLedgerReport(ledger: LedgerRun[]): Promise<LedgerTotals> {
  const totals = calculateLedgerTotals(ledger);
  await writeFile(REPORT_PATH, renderLedgerReport(ledger));
  return totals;
}

function validateLedger(value: unknown): LedgerRun[] {
  if (!Array.isArray(value)) throw new Error("ledger must be an array of run records");
  return value.map((run, index) => validateLedgerRun(run, index));
}

function validateLedgerRun(value: unknown, index: number): LedgerRun {
  if (typeof value !== "object" || value === null) {
    throw new Error(`ledger entry ${index} must be an object`);
  }
  const run = value as Partial<LedgerRun>;
  if (typeof run.date !== "string") throw new Error(`ledger entry ${index}.date must be a string`);
  if (!(run.pull_request === null || typeof run.pull_request === "number")) {
    throw new Error(`ledger entry ${index}.pull_request must be a number or null`);
  }
  if (!Array.isArray(run.verdicts)) throw new Error(`ledger entry ${index}.verdicts must be an array`);
  return { date: run.date, pull_request: run.pull_request, verdicts: run.verdicts as Verdict[] };
}

function pullRequestLabel(pullRequest: number | null): string {
  return pullRequest === null ? "Local run" : `#${pullRequest}`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
