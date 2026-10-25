import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { ingestText, parseSource } from "@/server/services/intake";
import { resetDatabase } from "./helpers";

const text = readFileSync("fixtures/04-untrusted-instructions.txt", "utf8");

describe("不可信附件指令", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("夹带越权文字不能变成批准或密钥读取", async () => {
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text,
      origin: "fixtures/04-untrusted-instructions.txt",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    expect(parsed.extraction.jailbreakAttempt).toBe(true);
    expect(JSON.stringify(parsed.extraction)).not.toMatch(/sk-|AI_API_KEY|SESSION_SECRET/);
    expect(parsed.extraction.notes.join("")).toContain("不会读取密钥");
    const payload = parsed.proposal ? JSON.parse(parsed.proposal.payloadJson) : null;
    expect(payload?.productionReadiness).not.toBe("ready_for_production");
  });
});
