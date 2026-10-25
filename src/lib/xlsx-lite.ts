import { unzipStore, zipStore } from "@/lib/zip-store";

export type SpreadsheetCell = {
  sheet: string;
  ref: string;
  value: string;
};

function colName(index: number) {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

export function buildXlsx(rows: string[][], sheet = "Sheet1") {
  const cells = rows
    .map((row, r) =>
      row
        .map((value, c) => {
          const ref = `${colName(c + 1)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join(""),
    )
    .map((row, r) => `<row r="${r + 1}">${row}</row>`)
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheet)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(types, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
  ]);
}

function sharedStrings(xml: string) {
  const values: string[] = [];
  for (const match of xml.matchAll(/<si[\s\S]*?<\/si>/g)) {
    const texts = [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((row) => unescapeXml(row[1] ?? ""));
    values.push(texts.join(""));
  }
  return values;
}

function sheetNameFromWorkbook(xml: string) {
  const match = xml.match(/<sheet[^>]*name="([^"]+)"/);
  return match?.[1] ? unescapeXml(match[1]) : "Sheet1";
}

export function parseXlsx(bytes: Buffer): SpreadsheetCell[] {
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") {
    throw new Error("不是可读取的 XLSX");
  }
  const files = unzipStore(bytes);
  const byName = new Map(files.map((file) => [file.name.replace(/\\/g, "/"), file.data.toString("utf8")]));
  const workbook = byName.get("xl/workbook.xml") ?? "";
  const sheetXml = byName.get("xl/worksheets/sheet1.xml") ?? "";
  if (!sheetXml) throw new Error("XLSX 缺少工作表，请另存为 CSV");
  const strings = sharedStrings(byName.get("xl/sharedStrings.xml") ?? "");
  const sheet = sheetNameFromWorkbook(workbook);
  const cells: SpreadsheetCell[] = [];
  for (const match of sheetXml.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const ref = attrs.match(/\br="([^"]+)"/)?.[1];
    if (!ref) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
    let value = "";
    if (type === "inlineStr") {
      value = unescapeXml([...(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))].map((row) => row[1] ?? "").join(""));
    } else if (type === "s") {
      const index = Number((body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "").trim());
      value = Number.isFinite(index) ? (strings[index] ?? "") : "";
    } else {
      value = unescapeXml((body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "").trim());
    }
    if (value) cells.push({ sheet, ref, value });
  }
  return cells;
}
