import { readFileSync } from "node:fs";
import path from "node:path";
import { crc32 } from "@/lib/crc32";
import { sha256Bytes } from "@/lib/hash";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const VISION_NOTE = "内置fixture演示，不是视觉识款，也不是按图搜款。";

export const VISION_REORDER_TEXT = `给北岸服饰追加 ST-26018，沿用之前已确认的款式，海军蓝 600 件、灰色 400 件。袖口改为罗纹，总量 1000 件。希望 10 月 20 日交货，客户 PO 暂未提供。各尺码数量和罗纹规格稍后确认。
【${VISION_NOTE}】`;

function insertPngTextChunk(png: Buffer, keyword: string, value: string) {
  const iend = png.lastIndexOf(Buffer.from("IEND"));
  if (iend < 4) throw new Error("invalid png");
  const insertAt = iend - 4;
  const payload = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(value, "latin1")]);
  const type = Buffer.from("tEXt");
  const crc = crc32(Buffer.concat([type, payload]));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([png.subarray(0, insertAt), header, type, payload, crcBuf, png.subarray(insertAt)]);
}

export const VISION_REORDER_PNG = insertPngTextChunk(PNG_1X1, "Comment", "yiju-fixture-10-vision-reorder");
export const VISION_REORDER_HASH = sha256Bytes(VISION_REORDER_PNG);
export const VISION_REORDER_PATH = "fixtures/10-vision-reorder.png";

export function visionFixtureForBytes(bytes: Buffer) {
  if (sha256Bytes(bytes) !== VISION_REORDER_HASH) return null;
  return {
    id: "fixtures/10-vision-reorder.png",
    label: VISION_NOTE,
    text: VISION_REORDER_TEXT,
    recognizedAsVision: false,
  };
}

export function loadCommittedVisionFixture() {
  return readFileSync(path.join(process.cwd(), VISION_REORDER_PATH));
}
