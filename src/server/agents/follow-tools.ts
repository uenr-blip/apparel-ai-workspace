import { z } from "zod";
import { prisma } from "@/lib/db";
import { listFollowProducts } from "@/server/services/order-merch";
import { filterFollowProducts } from "@/lib/follow-search";
import { isFullDate } from "@/server/domain/follow-po";
import { COLOR_TRIM_FIELDS, BULK_LABEL_KEYS, BULK_PROCESS_KEYS, colorTrimText } from "@/server/domain/merch-sheet";
import { FOLLOW_CONTEXT_RULES } from "@/server/context/platform";
import type { TradeActor } from "@/server/services/trade-contract";
import { FollowSuggestion } from "@/lib/follow-assistant";
import type { AgentTool } from "./runtime";
import type { EvidenceCard } from "./business-tools";
import type { AgentTable } from "@/lib/agent-table";
export function followTools(actor: TradeActor, authorize: () => Promise<void>) {
  const cards: EvidenceCard[] = [];
  const tables: AgentTable[] = [];
  let consulted = false, recordsRead = false, draft: FollowSuggestion | null = null;
  const tools: AgentTool[] = [
    { name: "read_follow_records", description: "按客户 PO、产品编号、款号、工厂、颜色或辅料查跟单总表，包含面料、每色唛标及进度；日期范围按客户采购日期。只读，显示来源与出运登记，缺项不猜填。", parameters: { type: "object", properties: { query: { type: "string" }, from: { type: "string", description: "客户采购日期起始 YYYY-MM-DD，未指定传空" }, to: { type: "string", description: "客户采购日期截止 YYYY-MM-DD，未指定传空" } }, required: ["query", "from", "to"], additionalProperties: false }, run: async raw => {
      await authorize();
      const args = z.object({ query: z.string().trim().max(120), from: z.string(), to: z.string() }).strict().parse(raw);
      if ((args.from && !isFullDate(args.from)) || (args.to && !isFullDate(args.to)) || (args.from && args.to && args.from > args.to)) throw new Error("客户采购日期范围不正确，请核对完整年月日");
      const user = await prisma.user.findFirstOrThrow({ where: { id: actor.userId, organizationId: actor.organizationId, active: true } });
      const lists = filterFollowProducts(await listFollowProducts(actor.organizationId, { role: user.role, factoryId: user.factoryId }), args.query, args.from, args.to);
      const all = [...lists.sales.map(line => ({ ...line, kind: "销售样" })), ...lists.bulk.flatMap(group => group.styles.map(line => ({ ...line, kind: "大货" })))];
      const records = all.slice(0, 30).map(line => ({ kind: line.kind, po: line.po || "待补", productCode: line.numericCode || "待补", styleCode: line.styleCode, purchaseDate: line.purchaseDate || "待补", requestedShipDate: line.shipDate || "待补", shipmentDates: line.shipmentDates, factoryName: line.factoryName, colors: line.colors, sampleColors: line.sampleColors, mainLabel: line.bulkMainLabel, bulkPictures: line.bulkPictures, sampleElements: line.sampleElements, composition: line.composition, materialSummary: line.materialSummary, progress: line.progress, productionProgress: line.productionProgress, productionHref: line.productionHref, href: line.href }));
      recordsRead = true;
      tables.push({ title: "客户 PO 与跟单记录", columns: ["类型 / PO", "产品编号 / 款号", "客户采购日期", "颜色 / 客户采购数量（件）", "要求出货日期（计划）", "出运登记日期"], rows: records.map(line => ({ cells: [`${line.kind} · ${line.po}`, `${line.productCode} / ${line.styleCode || "待补"}`, line.purchaseDate, line.kind === "销售样" ? line.sampleColors || "待补" : line.colors.map(c => `${c.guestColor || "颜色待补"} ${c.qtyText || "数量待补"}`).join("；") || "待补", line.requestedShipDate, line.shipmentDates.join("、") || "暂无可归属此 PO 的登记"], href: line.href })), notes: ["采购日期按客户 PO 原单；要求出货日期是计划，不代表已出货。出运登记时间不替代实际离港凭证。", ...(all.length > 30 ? ["仅列前 30 条，请缩小条件；未列出的记录尚未核对。"] : [])], emptyMessage: "没有符合条件的跟单；未填采购日期的记录不计入日期范围。" });
      cards.push({ title: "客户 PO 查询依据", facts: [`按当前账号权限查到 ${all.length} 条款式记录。`, "同一产品编号可对应多次 PO；查询不改业务记录。"] });
      tables.push({ title: "总表面料、每色辅料与进度", columns: ["工厂 / PO / 产品编号", "面料依据", "每色唛标与辅料", "跟单进度 / 生产登记"], rows: records.map(line => ({ cells: [`${line.factoryName || "工厂待补"} / ${line.po} / ${line.productCode}`, [line.composition, line.materialSummary].filter(Boolean).join("；") || "待补", [line.mainLabel ? `本款主唛：${line.mainLabel}` : "", ...Object.entries(line.bulkPictures || {}).filter(([, images]) => images?.length).map(([key, images]) => `${({ mainLabel: "主唛", button: "纽扣", zipper: "拉链", hook: "裤钩", otherTrim: "本款其他辅料" } as Record<string,string>)[key]}图片 ${images!.length} 张`), ...(line.sampleElements || []).map(e => `${e.label}：${e.text || "待补"}`), ...line.colors.map(color => {
        const trims = [...BULK_LABEL_KEYS, ...BULK_PROCESS_KEYS, "careSizeLabel" as const].flatMap(key => { const value = colorTrimText(color, key); return value ? [`${key === "careSizeLabel" ? "原洗唛/尺码唛合并说明" : COLOR_TRIM_FIELDS[key]}：${value}`] : []; });
        for (const [key, images] of Object.entries(color.pictures || {})) if (images?.length) trims.push(`${key === "metalBadge" ? "金属标" : COLOR_TRIM_FIELDS[key as keyof typeof COLOR_TRIM_FIELDS]}图片 ${images.length} 张`);
        if (color.metalBadge) trims.unshift(`金属标：${color.metalBadge}`);
        return `${color.guestColor || "颜色待补"}：${trims.join("，") || "每色辅料待补"}`;
      })].filter(Boolean).join("；") || "暂无每色资料", [line.progress, line.productionProgress].filter(Boolean).join("；") || "进度待补"], href: line.href })), notes: ["同一个 PO 内仍按颜色核对；总表是原记录的汇总，点击原记录修改并保存后更新。", "图片按原字段留存，可打开原记录查看；图片张数不代表已识别或批准图片内容。", "整单生产数量不能推算为单款进度；查询不生成采购。"], emptyMessage: "暂无符合条件的总表资料。" });
      return { records, total: all.length, limited: all.length > 30, rules: FOLLOW_CONTEXT_RULES };
    } },
    { name: "read_follow_setup", description: "核对跟单表规则和本公司已有工厂", parameters: { type: "object", properties: { factoryQuery: { type: "string", description: "原话中的工厂名称；未提工厂时传空字符串" } }, required: ["factoryQuery"], additionalProperties: false }, run: async raw => {
      await authorize();
      const { factoryQuery } = z.object({ factoryQuery: z.string().trim().max(80) }).strict().parse(raw);
      const factories = factoryQuery ? await prisma.party.findMany({ where: { organizationId: actor.organizationId, kind: "factory", archivedAt: null, name: { contains: factoryQuery } }, select: { name: true, code: true }, take: 11 }) : [];
      consulted = true;
      tables.push({ title: "跟单建表依据", columns: ["核对项", "业务要求"], rows: [{ cells: ["类型", "一张表只放销售样或大货；大货一厂一表。"] }, { cells: ["本次草稿", "只准备表头；款式、颜色、件数在建成的跟单表中核对填写。"] }, { cells: ["确认后", "只建跟单表，不生成生产订单、采购或付款。"] }], emptyMessage: "尚未核对跟单规则。" });
      if (factoryQuery) tables.push({ title: `工厂核对 · ${factoryQuery}`, columns: ["工厂编码", "工厂名称"], rows: factories.slice(0, 10).map(f => ({ cells: [f.code, f.name] })), notes: ["工厂名称由跟单员核对；建表不新增工厂主档。", ...(factories.length > 10 ? ["仅显示前 10 家，请补充更完整的名称。"] : [])], emptyMessage: "没有匹配的工厂主档，请核对原话中的工厂名称。" });
      cards.push({ title: "跟单表的建表范围", facts: ["一张表只放销售样或大货；大货一厂一表。", "本次只准备表头；款式、颜色和件数请在建成的跟单表中核对填写。", "确认建表不会生成生产订单、采购或付款。", ...factories.slice(0,10).map(f => `已有工厂：${f.name}（${f.code}）`)] });
      return { factories: factories.slice(0,10), limited: factories.length > 10, rules: "先明确销售样或大货，不能混合或自行猜测。大货要写工厂，有同名候选须追问；客户不是工厂。只准备表头，不接受款式/数量/金额写入。季节未说可空；工厂名称由用户核对，建表不新增工厂主档。" };
    } },
    { name: "prepare_follow_header", description: "形成跟单表头建议，供人修改确认；此工具不写入", parameters: { type: "object", properties: { kind: { type: "string", enum: ["sales_sample", "bulk"] }, title: { type: "string" }, seasonCode: { type: "string" }, factoryName: { type: "string" } }, required: ["kind", "title", "seasonCode", "factoryName"], additionalProperties: false }, run: async raw => {
      await authorize(); if (!consulted) throw new Error("先核对跟单规则和工厂资料，再准备表头");
      const parsed = FollowSuggestion.parse(raw);
      if (parsed.kind === "bulk" && !parsed.factoryName) throw new Error("大货跟单需要先明确工厂");
      if (parsed.kind === "sales_sample" && parsed.factoryName) throw new Error("销售样不按工厂建表，请清空工厂并核对");
      draft = parsed;
      return { draft, saved: false, next: "让用户核对或修改表头，明确确认后才建跟单表；款式、数量、交期未写入。" };
    } },
  ];
  return { tools, cards, tables, hasEvidence: () => consulted || recordsRead, getOrderResult: () => null, getFollowDraft: () => draft };
}
