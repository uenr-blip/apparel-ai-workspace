import { getAiMode } from "@/lib/ai-config";
import { liveExtract } from "@/server/ai/live";
import { mockExtract } from "@/server/ai/mock";
import type { Extraction } from "@/server/ai/schema";
import { assertExtractionEvidence, assertInputLimit } from "@/server/ai/evidence";

export async function extractFromText(text: string): Promise<{
  extraction: Extraction;
  mode: "mock" | "live";
  calledLiveModel: boolean;
}> {
  assertInputLimit(text);
  const mode = getAiMode();
  if (mode === "live") {
    const extraction = await liveExtract(text);
    return { extraction, mode, calledLiveModel: true };
  }
  const extraction = mockExtract(text);
  assertExtractionEvidence(text, extraction);
  return { extraction, mode: "mock", calledLiveModel: false };
}
