import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { VISION_REORDER_PNG, VISION_REORDER_TEXT } from "@/lib/vision-fixtures";
import { getReview, parseSource } from "@/server/services/intake";
import { ingestInboxAttachment } from "@/server/services/inbox-attachment";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-vision-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  delete process.env.AI_VISION_MODEL;
  process.env.AI_CAPABILITIES = "text,structured-output";
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("C05 内置 fixture 演示，不是视觉识款", () => {
  it("公开 fixture PNG 按内置文本解析，并标明不是识款", async () => {
    const ingested = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: VISION_REORDER_PNG,
      filename: "10-vision-reorder.png",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    expect(parsed.calledLiveModel).toBe(false);
    expect(parsed.visionSkipped).toBeFalsy();
    expect(parsed.extraction?.styleCode.value).toBe("ST-26018");
    expect(ingested.source.rawText).toContain("不是视觉识款");
    expect(ingested.source.rawText).toContain(VISION_REORDER_TEXT.split("\n")[0]);
    const review = await getReview(IDS.orgDemo, ingested.source.id);
    expect(review.parsed?.recognized).not.toBe(false);
    expect(JSON.stringify(review.parsed)).not.toContain("视觉相似度");
  });

  it("普通 1x1 PNG 仍只保存、不识款、不建提案", async () => {
    const ingested = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: PNG_1X1,
      filename: "look.png",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    expect(parsed.visionSkipped).toBe(true);
    expect(parsed.extraction).toBeNull();
    expect(parsed.proposal).toBeNull();
  });
});
