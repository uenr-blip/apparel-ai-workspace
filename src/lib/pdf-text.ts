function decodePdfString(raw: string) {
  const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

export function extractPdfText(bytes: Buffer) {
  const source = bytes.toString("latin1");
  if (!source.startsWith("%PDF")) return "";
  const texts: string[] = [];
  for (const stream of source.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = stream[1] ?? "";
    for (const match of body.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
      texts.push(decodePdfString(match[0].replace(/\s*Tj$/, "")));
    }
  }
  return texts.map((row) => row.trim()).filter(Boolean).join("\n");
}

export function buildTextPdf(lines: string[]) {
  const escaped = lines
    .map((line) => line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"))
    .join(") Tj T* (");
  const content = `BT /F1 12 Tf 72 720 Td 16 TL (${escaped}) Tj ET\n`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${content.length} >> stream\n${content}endstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${object}\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i += 1) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
