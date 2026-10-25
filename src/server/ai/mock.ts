import { demoYear } from "@/lib/clock";
import { emptyField, ExtractionSchema, type Extraction } from "@/server/ai/schema";
import { extractRibSpec, parseSizeLines } from "@/server/ai/size-lines";
import { hasJailbreakAttempt, locate } from "@/server/ai/text";

const DEMO_COLORS = ["海军蓝", "灰色", "红色", "黑色", "本色"];
const DEMO_SIZES = ["XS", "S", "M", "L", "XL"];

function field(
  text: string,
  snippet: string | null,
  value: string | number | null,
  kind: Extraction["customerName"]["kind"],
  inferenceNote: string | null = null,
) {
  if (!snippet) {
    return { ...emptyField(kind), value, inferenceNote };
  }
  const loc = locate(text, snippet);
  return {
    value,
    sourceText: loc.sourceText,
    start: loc.start,
    end: loc.end,
    kind,
    inferenceNote,
  };
}

function customerField(text: string) {
  if (text.includes("北岸服饰")) {
    return field(text, "北岸服饰", "北岸服饰", "extracted");
  }
  const en = text.match(/Northshore Apparel/i)?.[0] ?? text.match(/Northshore/i)?.[0];
  if (en) {
    return field(text, en, "北岸服饰", "extracted", "英文来源对照演示客户北岸服饰，未新建客户");
  }
  return emptyField();
}

function reuseField(text: string) {
  if (/还是上次那款/.test(text)) {
    return field(text, "还是上次那款", "yes", "extracted", "只说上次那款，不是款号，不能自动选定");
  }
  if (/沿用之前已确认的款式/.test(text)) {
    return field(text, "沿用之前已确认的款式", "yes", "extracted");
  }
  const en = text.match(/same confirmed style as last time/i)?.[0];
  if (en) return field(text, en, "yes", "extracted");
  return field(text, null, null, "unknown");
}

function poField(text: string, poMissing: boolean) {
  if (!poMissing) return emptyField();
  if (/客户\s*PO\s*暂未提供/.test(text)) {
    return field(text, "客户 PO 暂未提供", null, "extracted", "原文明确未提供，不得沿用历史订单 PO");
  }
  const en = text.match(/Customer PO not yet provided|PO not yet provided|PO to follow/i)?.[0] ?? null;
  return field(text, en, null, "extracted", "原文明确未提供，不得沿用历史订单 PO");
}

function cuffSnippet(text: string) {
  if (text.includes("袖口改为罗纹")) return "袖口改为罗纹";
  return text.match(/Change cuffs to rib/i)?.[0] ?? text.match(/cuffs to rib/i)?.[0] ?? null;
}

export function mockExtract(text: string): Extraction {
  const jailbreakAttempt = hasJailbreakAttempt(text);
  const styleMatch = text.match(/ST-\d{5}/);
  const northshore = text.includes("北岸服饰") || /Northshore/i.test(text);
  const oralVague = /还是上次那款|增加一批|颜色按新图|尺码明天补/.test(text);
  const reorderHint =
    oralVague || /追加|沿用之前已确认的款式|翻单|repeat order|repeat ST-|same confirmed style/i.test(text);
  const navy = text.match(/海军蓝\s*(\d+)\s*件/) ?? text.match(/Navy(?:\s+Blue)?\s+(\d+)\s*(?:pcs|pieces)/i);
  const grey = text.match(/灰色\s*(\d+)\s*件/) ?? text.match(/Gr[ae]y\s+(\d+)\s*(?:pcs|pieces)/i);
  const total = text.match(/总量\s*(\d+)\s*件/) ?? text.match(/total\s+(\d+)/i);
  const delivery = text.match(/(\d{1,2}\s*月\s*\d{1,2}\s*日)/) ?? text.match(/(\d{1,2}\s+October|October\s+\d{1,2})/i);
  const poMissing = /客户\s*PO\s*暂未提供|PO\s*暂未提供|PO not yet provided|PO to follow/i.test(text);
  const cuffRib = /袖口改为罗纹|Change cuffs to rib|cuffs to rib/i.test(text);
  const sizeLater =
    (/尺码/.test(text) && /稍后确认|未确认|明天补/.test(text)) || /size breakdown to follow/i.test(text);
  const newColorByImage = /颜色按新图/.test(text);
  const ribLater = /罗纹规格|rib spec to follow/i.test(text);

  const parsedSizes = parseSizeLines(text, DEMO_COLORS, DEMO_SIZES);
  const amendmentHint = /补充尺码|色尺|各码数量/.test(text) || parsedSizes.lines.length > 0;
  const ribExtract = extractRibSpec(text);

  if (
    !styleMatch &&
    !northshore &&
    !reorderHint &&
    !text.includes("YARN-DEMO") &&
    !/圆领针织/.test(text) &&
    !amendmentHint
  ) {
    return ExtractionSchema.parse({
      intent: "unknown",
      customerName: emptyField(),
      styleCode: emptyField(),
      reuseExistingStyle: emptyField(),
      externalCustomerPo: emptyField(),
      totalQuantity: emptyField(),
      colors: [],
      materials: [],
      deliveryText: emptyField(),
      deliveryDateInferred: emptyField(),
      modifications: [],
      sizeLines: [],
      unknowns: ["无法在演示规则内理解该输入，未调用真实模型，也未伪造提取结果"],
      jailbreakAttempt,
      notes: jailbreakAttempt
        ? ["资料中的指令性文字已被视为不可信内容，不会授予权限"]
        : ["mock 模式只处理内置演示场景或可识别规则"],
    });
  }

  const materialDev = /尚未确定款号|YARN-DEMO|开发轻薄圆领/.test(text);
  const yarnCodes = Array.from(text.matchAll(/YARN-DEMO-\d+/g)).map((match) => match[0]);
  const uniqueYarns = [...new Set(yarnCodes)];

  if (materialDev && !reorderHint) {
    return ExtractionSchema.parse({
      intent: "material_dev",
      customerName: customerField(text),
      styleCode: emptyField("unknown"),
      reuseExistingStyle: emptyField("unknown"),
      externalCustomerPo: emptyField("unknown"),
      totalQuantity: emptyField("unknown"),
      colors: [],
      materials: uniqueYarns.map((code) => ({
        code,
        ...locate(text, code),
      })),
      deliveryText: emptyField(),
      deliveryDateInferred: emptyField(),
      modifications: [],
      sizeLines: [],
      unknowns: ["试验报告", "成分要求", "目标成本", "投产数量", "款号"],
      jailbreakAttempt,
      notes: [
        "演示模式，未调用真实模型",
        "材料开发可先于款号保存",
        "历史客户批准不能自动迁移到本项目",
      ],
    });
  }

  const colors = [];
  if (navy) {
    const loc = locate(text, navy[0]);
    colors.push({
      colorName: "海军蓝",
      quantity: Number(navy[1]),
      sourceText: loc.sourceText,
      start: loc.start,
      end: loc.end,
    });
  }
  if (grey) {
    const loc = locate(text, grey[0]);
    colors.push({
      colorName: "灰色",
      quantity: Number(grey[1]),
      sourceText: loc.sourceText,
      start: loc.start,
      end: loc.end,
    });
  }

  const year = demoYear();
  const deliveryRaw = delivery?.[0] ?? null;
  const deliverySnippet = deliveryRaw
    ? /月/.test(deliveryRaw)
      ? deliveryRaw.replace(/\s/g, "")
      : deliveryRaw
    : null;
  const inferredDate =
    deliveryRaw && /10\s*月\s*20\s*日|20\s*October|October\s*20/i.test(deliveryRaw)
      ? `${year}-10-20`
      : null;

  const sizeLines = parsedSizes.lines.map((line) => ({
    colorName: line.colorName,
    sizeCode: line.sizeCode,
    quantity: line.quantity,
    sourceText: line.sourceText,
    start: line.start,
    end: line.end,
    kind: line.kind,
    note: line.note,
  }));

  if (amendmentHint && !reorderHint) {
    return ExtractionSchema.parse({
      intent: "order_change",
      customerName: customerField(text),
      styleCode: styleMatch ? field(text, styleMatch[0], styleMatch[0], "extracted") : emptyField(),
      reuseExistingStyle: emptyField(),
      externalCustomerPo: emptyField(),
      totalQuantity: emptyField(),
      colors,
      materials: [],
      deliveryText: emptyField(),
      deliveryDateInferred: emptyField("unknown"),
      modifications: ribExtract
        ? [
            {
              field: "ribSpec",
              requested: ribExtract.value,
              sourceText: ribExtract.sourceText,
              start: ribExtract.start,
              end: ribExtract.end,
            },
          ]
        : [],
      sizeLines,
      unknowns: [
        ...(sizeLines.length ? [] : ["尺码明细"]),
        ...(ribExtract ? [] : ["罗纹规格"]),
        ...parsedSizes.conflicts,
      ],
      jailbreakAttempt,
      notes: [
        "演示模式，未调用真实模型",
        "提取结果需人工确认后才会写入订单",
        ...(jailbreakAttempt ? ["已拦截资料中的越权指令，不会读取密钥或跳过批准"] : []),
      ],
    });
  }

  const unknowns = [];
  if ((sizeLater || !text.includes("XS")) && sizeLines.length === 0) unknowns.push("尺码明细");
  if (newColorByImage) unknowns.push("新颜色未确认");
  if ((ribLater || cuffRib) && !ribExtract) unknowns.push("罗纹规格与批准");
  if (inferredDate) unknowns.push("交期年份推断");
  if (poMissing) unknowns.push("客户PO");
  if (jailbreakAttempt) unknowns.push("附件指令不是有效授权");

  return ExtractionSchema.parse({
    intent: reorderHint || styleMatch ? "reorder" : "unknown",
    customerName: customerField(text),
    styleCode: styleMatch
      ? field(text, styleMatch[0], styleMatch[0], "extracted")
      : emptyField(),
    reuseExistingStyle: reuseField(text),
    externalCustomerPo: poField(text, poMissing),
    totalQuantity: total
      ? field(text, total[0], Number(total[1]), "extracted")
      : colors.length
        ? field(text, null, colors.reduce((sum, row) => sum + row.quantity, 0), "inferred", "由颜色数量加总")
        : emptyField(),
    colors,
    materials: [],
    deliveryText: deliverySnippet
      ? field(text, delivery?.[0] ?? deliverySnippet, deliverySnippet, "extracted")
      : emptyField(),
    deliveryDateInferred: inferredDate
      ? {
          value: inferredDate,
          sourceText: delivery?.[0] ?? null,
          start: delivery ? locate(text, delivery[0]).start : null,
          end: delivery ? locate(text, delivery[0]).end : null,
          kind: "inferred" as const,
          inferenceNote: `年份 ${year} 来自组织演示参考日期 ${year}-09-18，不是原文已写明的事实`,
        }
      : emptyField("unknown"),
    modifications: (() => {
      const rows: Extraction["modifications"] = [];
      const cuff = cuffSnippet(text);
      if (cuffRib && cuff) {
        rows.push({
          field: "cuffType",
          requested: "罗纹",
          ...locate(text, cuff),
        });
      }
      if (newColorByImage) {
        rows.push({
          field: "colorway",
          requested: "按新图",
          ...locate(text, "颜色按新图"),
        });
      }
      return rows;
    })(),
    sizeLines,
    unknowns,
    jailbreakAttempt,
    notes: [
      "演示模式，未调用真实模型",
      ...(northshore && /Northshore/i.test(text) && !text.includes("北岸服饰")
        ? ["英文客户名已对照演示客户北岸服饰，未新建客户"]
        : []),
      ...(jailbreakAttempt ? ["已拦截资料中的越权指令，不会读取密钥或跳过批准"] : []),
    ],
  });
}
