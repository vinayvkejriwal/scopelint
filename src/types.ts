export const VERDICTS = ["in_scope", "out_of_scope", "gray_area"] as const;

export type VerdictName = (typeof VERDICTS)[number];

export interface Verdict {
  area: string;
  verdict: VerdictName;
  matched_clause: string | null;
  rationale: string;
  estimated_effort_hours: number;
  change_order_draft: string | null;
}

export interface ClassificationResult {
  verdicts: Verdict[];
  summary: Record<VerdictName, number>;
}
