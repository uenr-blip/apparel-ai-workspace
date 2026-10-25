import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { buildTextPdf } from "@/lib/pdf-text";
import { buildXlsx } from "@/lib/xlsx-lite";
import { getReview, parseSource } from "@/server/services/intake";
import { ingestInboxAttachment, InboxAttachmentError } from "@/server/services/inbox-attachment";
import { resetDatabase } from "./helpers";

const CSV = readFileSync("fixtures/07-reorder.csv");
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SCAN_PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-tabular-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("C01 表格与文字 PDF 提取", () => {
  it("CSV 提取 ST-26018 并定位到单元格，不编造 BOM", async () => {
    const ingested = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: CSV,
      filename: "07-reorder.csv",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    expect(parsed.visionSkipped).toBeFalsy();
    expect(parsed.extraction?.styleCode.value).toBe("ST-26018");
    expect(parsed.extraction?.styleCode.start).not.toBeNull();
    expect(parsed.extraction?.materials ?? []).toEqual([]);

    const source = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: ingested.source.id } });
    expect(source.mimeType).toBe("text/csv");
    expect(source.rawText).toContain("Sheet1!A2");
    expect(source.rawText).toContain("ST-26018");
    expect(source.parseStatus).toBe("needs_review");

    const fragments = await prisma.sourceFragment.findMany({ where: { sourceDocumentId: source.id } });
    expect(fragments.some((row) => row.text.includes("Sheet1!A2"))).toBe(true);
    expect(fragments.some((row) => row.text.includes("ST-26018"))).toBe(true);

    const review = await getReview(IDS.orgDemo, source.id);
    expect(review.fileHref).toBe(`/api/inbox/${source.id}/file`);
    const styleFragment = review.source.fragments.find((row) => row.text.includes("Sheet1!A2"));
    expect(styleFragment).toBeTruthy();
    expect(review.source.rawText.slice(styleFragment!.startOffset, styleFragment!.endOffset)).toContain("ST-26018");
  });

  it("XLSX 与文字 PDF 同样可定位；扫描 PDF 仍不识款", async () => {
    const xlsx = buildXlsx([
      ["款号", "颜色", "数量"],
      ["ST-26018", "海军蓝", "600"],
      ["ST-26018", "灰色", "400"],
    ]);
    const xlsxIngested = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: xlsx,
      filename: "08-reorder.xlsx",
    });
    const xlsxParsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: xlsxIngested.source.id,
    });
    expect(xlsxParsed.extraction?.styleCode.value).toBe("ST-26018");
    expect(xlsxIngested.source.rawText).toContain("Sheet1!A2");
    expect(xlsxIngested.source.mimeType).toContain("spreadsheetml");

    const pdf = buildTextPdf([
      "Please repeat ST-26018, same confirmed style as last time.",
      "Navy 600 pcs, Grey 400 pcs, total 1000 pcs.",
      "Customer PO not yet provided.",
    ]);
    const pdfIngested = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: pdf,
      filename: "09-reorder.pdf",
    });
    const pdfParsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: pdfIngested.source.id,
    });
    expect(pdfParsed.extraction?.styleCode.value).toBe("ST-26018");
    expect(pdfIngested.source.rawText).toContain("第1页");
    expect(pdfParsed.visionSkipped).toBeFalsy();

    const scan = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      bytes: SCAN_PDF,
      filename: "scan.pdf",
    });
    const scanParsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      sourceId: scan.source.id,
    });
    expect(scanParsed.visionSkipped).toBe(true);
    expect(scanParsed.extraction).toBeNull();
  });

  it("普通 PNG 仍拒绝当表格；GIF 拒绝", async () => {
    const png = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: PNG_1X1,
      filename: "look.png",
    });
    expect(png.source.parseStatus).toBe("queued");
    await expect(
      ingestInboxAttachment({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        bytes: Buffer.from("GIF89a"),
        filename: "x.gif",
      }),
    ).rejects.toThrow(InboxAttachmentError);
  });
});
