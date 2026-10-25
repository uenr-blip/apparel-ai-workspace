import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getReview, parseSource } from "@/server/services/intake";
import { ingestInboxAttachment, InboxAttachmentError, readInboxAttachment } from "@/server/services/inbox-attachment";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG_STUB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PDF_STUB = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const GIF_STUB = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-inbox-att-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  delete process.env.AI_VISION_MODEL;
  process.env.AI_CAPABILITIES = "text,structured-output";
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("C05 收件箱图片附件", () => {
  it("未配置视觉时保存 PNG，不识款、不编 BOM、不建提案", async () => {
    const ingested = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: PNG_1X1,
      filename: "ST-26018-bom.png",
      declaredMime: "image/png",
    });
    expect(ingested.alreadyExisted).toBe(false);
    expect(ingested.recognized).toBe(false);
    expect(ingested.extractedBom).toBe(false);

    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    expect(parsed.proposal).toBeNull();
    expect(parsed.extraction).toBeNull();
    expect(parsed.visionSkipped).toBe(true);
    expect(parsed.calledLiveModel).toBe(false);

    const source = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: ingested.source.id } });
    expect(source.parseStatus).toBe("saved_without_vision");
    expect(source.mimeType).toBe("image/png");
    expect(source.filename).toBe("ST-26018-bom.png");
    expect(source.rawText).toContain("未进行语义识别");
    expect(source.rawText).toContain("未提取 BOM");
    expect(source.storagePath).toBeTruthy();
    expect(readFileSync(path.join(uploadRoot, source.storagePath!)).equals(PNG_1X1)).toBe(true);

    const proposals = await prisma.actionProposal.count({ where: { sourceDocumentId: source.id } });
    expect(proposals).toBe(0);

    const review = await getReview(IDS.orgDemo, source.id);
    expect(review.proposal).toBeNull();
    expect(review.parsed?.recognized).toBe(false);
    expect(review.parsed?.extractedBom).toBe(false);
    expect(review.fileHref).toBe(`/api/inbox/${source.id}/file`);
  });

  it("JPEG 与扫描 PDF 同样只保存；GIF、空文件、超大文件拒绝", async () => {
    const jpeg = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: JPEG_STUB,
      filename: "look.jpg",
    });
    expect(jpeg.source.mimeType).toBe("image/jpeg");

    const pdf = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      bytes: PDF_STUB,
      filename: "scan.pdf",
    });
    const parsedPdf = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      sourceId: pdf.source.id,
    });
    expect(pdf.source.mimeType).toBe("application/pdf");
    expect(parsedPdf.proposal).toBeNull();
    expect(parsedPdf.visionSkipped).toBe(true);
    expect(parsedPdf.extraction).toBeNull();

    await expect(
      ingestInboxAttachment({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        bytes: GIF_STUB,
        filename: "x.gif",
      }),
    ).rejects.toThrow(InboxAttachmentError);

    await expect(
      ingestInboxAttachment({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        bytes: Buffer.alloc(0),
        filename: "empty.png",
      }),
    ).rejects.toThrow("请选择 JPG、PNG、PDF、CSV 或 XLSX");

    await expect(
      ingestInboxAttachment({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        bytes: Buffer.concat([PNG_1X1, Buffer.alloc(5 * 1024 * 1024)]),
        filename: "huge.png",
      }),
    ).rejects.toThrow("附件超过 5MB");
  });

  it("重复内容不新建来源；外组织不能读取", async () => {
    const first = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: PNG_1X1,
      filename: "a.png",
    });
    const second = await ingestInboxAttachment({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      bytes: PNG_1X1,
      filename: "b.png",
    });
    expect(second.alreadyExisted).toBe(true);
    expect(second.source.id).toBe(first.source.id);
    expect(await prisma.sourceDocument.count({ where: { organizationId: IDS.orgDemo, mimeType: "image/png" } })).toBe(1);

    await expect(readInboxAttachment({ organizationId: IDS.orgIso, sourceId: first.source.id })).rejects.toThrow(
      "来源不存在或不属于当前组织",
    );
    const allowed = await readInboxAttachment({ organizationId: IDS.orgDemo, sourceId: first.source.id });
    expect(allowed.mime).toBe("image/png");
    expect(allowed.bytes.equals(PNG_1X1)).toBe(true);
  });
});
