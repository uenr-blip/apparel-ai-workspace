import { createHash, randomUUID } from "node:crypto";

export function createId() {
  return randomUUID();
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Bytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeSourceText(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}
