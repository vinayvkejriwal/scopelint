import OpenAI from "openai";
import { loadReplayResponse } from "./replay.js";
import { VERDICTS, type ClassificationResult, type Verdict, type VerdictName } from "./types.js";

export const MODEL = "gpt-5.6-terra";
export const MAX_DIFF_CHARACTERS = 60_000;

export const CLASSIFIER_SYSTEM_PROMPT = `You are ScopeLint, a contract compliance reviewer for software consulting projects. You receive a statement of work in markdown with numbered clauses, and a unified code diff from a pull request.

Group the changed code into functional areas, not individual lines. For each area return a verdict:
- in_scope: a deliverable clause plainly covers it.
- out_of_scope: no clause covers it, or an exclusion clause applies.
- gray_area: reasonable people could disagree, or the diff lacks context to decide.

Rules:
- Cite the clause number for every in_scope verdict and for every exclusion match. Never invent clauses.
- Prefer gray_area over guessing.
- Routine housekeeping counts as in_scope under the clause it supports: formatting, dependency updates, small refactors required by in-scope work, and tests for in-scope features.
- Estimate effort in whole hours, rough is fine.
- For every out_of_scope area, write change_order_draft: 90 to 120 words, professional and neutral, addressed to a client contact. Describe the observed work, state why it sits outside the current agreement citing the clause, and invite approval of a change order with an effort estimate.

Output only JSON matching the provided schema. No prose outside the JSON.`;

export interface ClassifyOptions {
  replay: boolean;
  diffFile?: string;
  model?: string;
}

export async function classify(
  scope: string,
  diff: string,
  options: ClassifyOptions,
): Promise<ClassificationResult> {
  if (options.replay) {
    if (!options.diffFile) {
      throw new Error("Replay mode requires --diff-file so ScopeLint can select a canned response.");
    }
    return loadReplayResponse(options.diffFile);
  }

  return classifyWithOpenAI(scope, diff, options.model ?? MODEL);
}

export async function classifyWithOpenAI(
  scope: string,
  diff: string,
  model = MODEL,
): Promise<ClassificationResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for live classification. Re-run with --replay to use fixtures.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input = buildClassifierInput(scope, prepareDiffForClassification(diff));
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.responses.create({
        model,
        instructions:
          attempt === 0
            ? CLASSIFIER_SYSTEM_PROMPT
            : `${CLASSIFIER_SYSTEM_PROMPT}\n\nYour previous response could not be parsed or validated. Return only valid JSON matching the provided schema.`,
        input,
        text: {
          format: {
            type: "json_schema",
            name: "scope_lint_classification",
            strict: true,
            schema: CLASSIFICATION_SCHEMA,
          },
        },
      });

      if (!response.output_text) {
        throw new Error("The model returned no text output.");
      }

      return validateClassification(JSON.parse(response.output_text));
    } catch (error) {
      lastError = toError(error);
    }
  }

  throw new Error(`Unable to produce a valid ScopeLint classification after two attempts: ${lastError?.message}`);
}

export function buildClassifierInput(scope: string, diff: string): string {
  return `Statement of work:\n---\n${scope}\n---\n\nUnified diff:\n---\n${diff}\n---`;
}

export function prepareDiffForClassification(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARACTERS) return diff;

  const files = splitDiffByFile(diff);
  if (files.length === 0) {
    const notice = "\n\n[Diff truncated after 60,000 characters; no file-level hunks could be identified.]";
    return `${diff.slice(0, MAX_DIFF_CHARACTERS - notice.length)}${notice}`;
  }

  const selected = new Set<number>();
  const rankedFiles = files
    .map((file, index) => ({ index, changedLines: file.added + file.removed, length: file.content.length }))
    .sort((left, right) => right.changedLines - left.changedLines || right.length - left.length);

  for (const candidate of rankedFiles) {
    const candidateSelection = new Set(selected).add(candidate.index);
    if (renderGuardedDiff(files, candidateSelection).length <= MAX_DIFF_CHARACTERS) {
      selected.add(candidate.index);
    }
  }

  return renderGuardedDiff(files, selected);
}

interface DiffFile {
  content: string;
  path: string;
  added: number;
  removed: number;
}

function splitDiffByFile(diff: string): DiffFile[] {
  const sections = diff.split(/(?=^diff --git )/m).filter((section) => section.startsWith("diff --git "));
  return sections.map((content) => {
    const header = content.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = header?.[2] ?? "unknown file";
    const lines = content.split("\n");
    const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    return { content, path, added, removed };
  });
}

function renderGuardedDiff(files: DiffFile[], selected: Set<number>): string {
  const fullHunks = files
    .filter((_, index) => selected.has(index))
    .map((file) => file.content.trimEnd())
    .join("\n");
  const summaries = files
    .filter((_, index) => !selected.has(index))
    .map((file) => `- ${file.path}: ${file.added} lines added, ${file.removed} lines removed`)
    .join("\n");
  const summaryBlock = summaries
    ? `[Files summarized because the original diff exceeds ${MAX_DIFF_CHARACTERS.toLocaleString()} characters]\n${summaries}`
    : "";

  return [fullHunks, summaryBlock].filter(Boolean).join("\n\n");
}

const CLASSIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts", "summary"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "area",
          "verdict",
          "matched_clause",
          "rationale",
          "estimated_effort_hours",
          "change_order_draft",
        ],
        properties: {
          area: { type: "string" },
          verdict: { type: "string", enum: [...VERDICTS] },
          matched_clause: { type: ["string", "null"] },
          rationale: { type: "string" },
          estimated_effort_hours: { type: "integer", minimum: 0 },
          change_order_draft: { type: ["string", "null"] },
        },
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: [...VERDICTS],
      properties: {
        in_scope: { type: "integer", minimum: 0 },
        out_of_scope: { type: "integer", minimum: 0 },
        gray_area: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

export function validateClassification(value: unknown): ClassificationResult {
  if (!isRecord(value) || !Array.isArray(value.verdicts) || !isRecord(value.summary)) {
    throw new Error("expected an object with verdicts and summary");
  }

  const verdicts = value.verdicts.map((verdict, index) => validateVerdict(verdict, index));
  const summary = {} as Record<VerdictName, number>;

  for (const name of VERDICTS) {
    const count = value.summary[name];
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new Error(`summary.${name} must be a non-negative integer`);
    }
    summary[name] = count as number;
  }

  for (const name of VERDICTS) {
    const actual = verdicts.filter((entry) => entry.verdict === name).length;
    if (summary[name] !== actual) {
      throw new Error(`summary.${name} is ${summary[name]}, but verdicts contain ${actual}`);
    }
  }

  return { verdicts, summary };
}

function validateVerdict(value: unknown, index: number): Verdict {
  if (!isRecord(value)) {
    throw new Error(`verdicts[${index}] must be an object`);
  }

  if (!isNonEmptyString(value.area)) throw new Error(`verdicts[${index}].area must be a string`);
  if (!VERDICTS.includes(value.verdict as VerdictName)) {
    throw new Error(`verdicts[${index}].verdict is invalid`);
  }
  if (!(value.matched_clause === null || isNonEmptyString(value.matched_clause))) {
    throw new Error(`verdicts[${index}].matched_clause must be a string or null`);
  }
  if (!isNonEmptyString(value.rationale)) {
    throw new Error(`verdicts[${index}].rationale must be a string`);
  }
  if (!Number.isInteger(value.estimated_effort_hours) || (value.estimated_effort_hours as number) < 0) {
    throw new Error(`verdicts[${index}].estimated_effort_hours must be a non-negative integer`);
  }
  if (!(value.change_order_draft === null || isNonEmptyString(value.change_order_draft))) {
    throw new Error(`verdicts[${index}].change_order_draft must be a string or null`);
  }

  const verdict = value.verdict as VerdictName;
  if (verdict === "out_of_scope" && value.change_order_draft === null) {
    throw new Error(`verdicts[${index}].change_order_draft is required for out_of_scope`);
  }

  return {
    area: value.area,
    verdict,
    matched_clause: value.matched_clause,
    rationale: value.rationale,
    estimated_effort_hours: value.estimated_effort_hours as number,
    change_order_draft: value.change_order_draft,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
