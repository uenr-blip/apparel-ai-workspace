export type ParsedSizeLine = {
  colorName: string;
  sizeCode: string;
  quantity: number;
  sourceText: string;
  start: number;
  end: number;
  kind: "extracted" | "conflict";
  note: string | null;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectColorMentions(text: string, colorNames: string[], sizeCodes: string[]) {
  const mentions: Array<{ name: string; index: number; known: boolean }> = [];
  const known = [...colorNames].sort((a, b) => b.length - a.length);
  for (const name of known) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(name, from);
      if (index < 0) break;
      mentions.push({ name, index, known: true });
      from = index + name.length;
    }
  }

  if (sizeCodes.length > 0) {
    const sizeAlt = sizeCodes.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|");
    const extra = new RegExp(`([\\u4e00-\\u9fff]{1,8})\\s*(?=${sizeAlt})`, "g");
    for (const match of text.matchAll(extra)) {
      const name = match[1] ?? "";
      const index = match.index ?? 0;
      if (!name) continue;
      const overlapsKnown = mentions.some(
        (item) => item.index <= index && item.index + item.name.length >= index + name.length,
      );
      if (overlapsKnown) continue;
      mentions.push({ name, index, known: colorNames.includes(name) });
    }
  }

  mentions.sort((a, b) => a.index - b.index);
  return mentions;
}

export function parseSizeLines(
  text: string,
  colorNames: string[],
  sizeCodes: string[],
): { lines: ParsedSizeLine[]; conflicts: string[] } {
  const conflicts: string[] = [];
  const lines: ParsedSizeLine[] = [];
  if (!sizeCodes.length) return { lines, conflicts };

  const mentions = collectColorMentions(text, colorNames, sizeCodes);
  const sizeAlt = [...sizeCodes].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  const sizePattern = new RegExp(`(${sizeAlt})\\s*[:：=]?\\s*(\\d+)`, "g");
  const seen = new Map<string, number>();

  for (const match of text.matchAll(sizePattern)) {
    const sizeCode = match[1] ?? "";
    const quantity = Number(match[2]);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const preceding = [...mentions].reverse().find((item) => item.index < start);
    if (!preceding) {
      conflicts.push(`尺码 ${sizeCode} ${quantity} 未标明颜色`);
      continue;
    }
    if (!preceding.known) {
      conflicts.push(`${preceding.name} 不在当前订单颜色中`);
      lines.push({
        colorName: preceding.name,
        sizeCode,
        quantity,
        sourceText: match[0],
        start,
        end,
        kind: "conflict",
        note: "颜色不在当前订单",
      });
      continue;
    }
    const key = `${preceding.name}::${sizeCode}`;
    if (seen.has(key) && seen.get(key) !== quantity) {
      conflicts.push(`${preceding.name} ${sizeCode} 原文出现不同数量`);
      lines.push({
        colorName: preceding.name,
        sizeCode,
        quantity,
        sourceText: match[0],
        start,
        end,
        kind: "conflict",
        note: "同色同码数量冲突",
      });
      continue;
    }
    seen.set(key, quantity);
    lines.push({
      colorName: preceding.name,
      sizeCode,
      quantity,
      sourceText: match[0],
      start,
      end,
      kind: "extracted",
      note: null,
    });
  }

  return { lines, conflicts };
}

export function extractRibSpec(text: string): { value: string; sourceText: string; start: number | null; end: number | null } | null {
  const labeled = text.match(/罗纹规格[:：]\s*([^。；\n]+)/);
  const twoByTwo = text.match(/2\s*[xX×]\s*2\s*罗纹[^。；\n]*/);
  const match = labeled ?? twoByTwo;
  if (!match) return null;
  const value = (labeled ? labeled[1] : match[0]).trim();
  if (!value || /稍后确认|待确认|未确认|尚未/.test(value)) return null;
  const sourceText = match[0].trim();
  const start = text.indexOf(sourceText);
  return {
    value,
    sourceText,
    start: start >= 0 ? start : null,
    end: start >= 0 ? start + sourceText.length : null,
  };
}
