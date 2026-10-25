import { parseCsv, type CsvCell } from "@/lib/csv";
import { extractPdfText } from "@/lib/pdf-text";
import { parseXlsx, type SpreadsheetCell } from "@/lib/xlsx-lite";

export type LocatedCell = {
  sheet: string;
  ref: string;
  locator: string;
  value: string;
  start: number;
  end: number;
};

export type TabularExtract = {
  kind: "csv" | "xlsx" | "pdf-text";
  text: string;
  cells: LocatedCell[];
  page: number | null;
};

export class TabularExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TabularExtractError";
  }
}

function flattenCells(filename: string, cells: Array<CsvCell | SpreadsheetCell>, kind: TabularExtract["kind"]): TabularExtract {
  const header =
    kind === "pdf-text"
      ? `# 提取自文字 PDF ${filename}，页码可定位，不是识款`
      : `# 提取自表格 ${filename}，单元格可定位，不是识款`;
  const lines = [header];
  const located: LocatedCell[] = [];
  let cursor = header.length + 1;
  for (const cell of cells) {
    const locator = kind === "pdf-text" ? `第1页 ${cell.ref}` : `${cell.sheet}!${cell.ref}`;
    const line = `${locator}\t${cell.value}`;
    lines.push(line);
    located.push({
      sheet: cell.sheet,
      ref: cell.ref,
      locator,
      value: cell.value,
      start: cursor,
      end: cursor + line.length,
    });
    cursor += line.length + 1;
  }
  return { kind, text: lines.join("\n"), cells: located, page: kind === "pdf-text" ? 1 : null };
}

export function extractCsv(bytes: Buffer, filename: string): TabularExtract {
  const text = bytes.toString("utf8");
  const cells = parseCsv(text);
  if (!cells.length) throw new TabularExtractError("CSV 没有可定位的单元格");
  return flattenCells(filename, cells, "csv");
}

export function extractXlsx(bytes: Buffer, filename: string): TabularExtract {
  const cells = parseXlsx(bytes);
  if (!cells.length) throw new TabularExtractError("XLSX 没有可定位的单元格");
  return flattenCells(filename, cells, "xlsx");
}

export function extractTextPdf(bytes: Buffer, filename: string): TabularExtract | null {
  const text = extractPdfText(bytes);
  if (!text.trim()) return null;
  const cells = text
    .split(/\n+/)
    .map((value, index) => ({ sheet: "PDF", ref: `L${index + 1}`, value: value.trim() }))
    .filter((row) => row.value);
  return flattenCells(filename, cells, "pdf-text");
}

export function looksLikeCsv(filename: string, bytes: Buffer) {
  if (/\.csv$/i.test(filename)) return true;
  const sample = bytes.subarray(0, 256).toString("utf8");
  return !sample.includes("\0") && /[,;\t].*\n/.test(sample) && !sample.startsWith("%PDF") && !sample.startsWith("PK");
}
