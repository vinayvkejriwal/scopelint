import { basename, extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { validateClassification } from "./classify.js";
import type { ClassificationResult } from "./types.js";

export async function loadReplayResponse(diffFile: string): Promise<ClassificationResult> {
  const diffName = basename(diffFile, extname(diffFile));
  const responsePath = join("fixtures", "responses", `${diffName}.json`);

  let raw: string;
  try {
    raw = await readFile(responsePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Replay response not found: ${responsePath}`);
    }
    throw error;
  }

  try {
    return validateClassification(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Invalid replay response at ${responsePath}: ${(error as Error).message}`);
  }
}
