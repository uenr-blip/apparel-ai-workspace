"use client";

import { TablePhoto } from "@/components/table-photo";
import { SalesMasterTable } from "./sales-master-table";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import { COLOR_TRIM_FIELDS, BULK_LABEL_KEYS, BULK_PROCESS_KEYS, bulkMainLabel, colorTrimText, type BulkColor } from "@/server/domain/merch-sheet";
import type { FollowProductLists, FollowStyleLine } from "@/server/services/order-merch";
import { filterFollowProducts } from "@/lib/follow-search";
import { isFullDate } from "@/server/domain/follow-po";
import { MASTER_COLUMNS, masterCounts, parseMasterColumns, standardMasterColumns, type MasterColumn } from "@/lib/follow-master";
import { CellThumbs } from "./sheet-picture";
import { BulkMasterPrint } from "./bulk-master-print";
import "./bulk-master-print.css";

const labelKeys = BULK_LABEL_KEYS;
const trimKeys = BULK_PROCESS_KEYS;
const blankColor: BulkColor = { guestColor: "", factoryColorName: "", qtyText: "", metalBadge: "" };
const materialHref = (line: FollowStyleLine) => line.productionHref ? `${line.productionHref}#order-materials` : `${line.href}#stage-materials`;

function CellLink({ line, section, children }: { line: FollowStyleLine; section: string; children: React.ReactNode }) {
  return <Link href={section === "stage-materials" ? materialHref(line) : `${line.href}#${section}`} className="master-cell-link" title={typeof children === "string" && children ? `${children}\n点击打开对应资料修改` : "打开这款的对应资料修改"}><div className="master-cell-content">{children || <span className="text-[var(--ink-muted)]">待补</span>}</div></Link>;
}

function MasterFocus({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.documentElement.style.overflow;
    dialog?.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => { dialog?.close(); document.documentElement.style.overflow = previousOverflow; };
  }, []);
  return createPortal(<dialog ref={ref} aria-labelledby={titleId} className="master-focus-dialog" onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>, document.body);
}

function FactoryTable({ name, lines, columns }: { name: string; lines: FollowStyleLine[]; columns: MasterColumn[] }) {
  const count = masterCounts(lines);
  const show = (key: MasterColumn) => columns.includes(key);
  return <section className="master-factory mt-6 first:mt-0">
    <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <h3 className="font-semibold">{name}</h3>
      <p className="text-sm text-[var(--ink-muted)]">{count.products} 款 · {count.pos} 个已填 PO · 已填 {count.quantity.toLocaleString()} 件{count.missingQuantity ? `，${count.missingQuantity} 行数量待补` : ""}</p>
    </div>
    <div className="master-scroll overflow-auto rounded-lg border border-[var(--line)]">
      <table className="master-table text-xs leading-5">
        <colgroup>
          <col className="master-col-product" /><col className="master-col-po" /><col className="master-col-color" /><col className="master-col-quantity" /><col className="master-col-date" />
          {show("materials") ? <col className="master-col-detail" /> : null}
          {show("labels") ? <><col className="master-col-note" />{labelKeys.map(key => <col key={key} className="master-col-note" />)}</> : null}
          <col className="master-col-note" />
          {show("trims") ? <><col className="master-col-note" />{trimKeys.map(key => <col key={key} className="master-col-note" />)}<col className="master-col-detail" /></> : null}
          {show("progress") ? <><col className="master-col-detail" /><col className="master-col-detail" /></> : null}
        </colgroup>
        <thead><tr>
          <th className="master-product">款式图 / 品名 / 产品编号</th><th>订单号（PO）<br />客户采购日期</th><th>客人颜色 / 厂色</th><th>客户采购<br />数量（件）</th><th>要求出货日期<br />进仓日期</th>
          {show("materials") ? <th>面料成分 / 规格 / 单耗</th> : null}
          {show("labels") ? <><th>主唛 · 本款共用</th>{labelKeys.map(key => <th key={key}>{COLOR_TRIM_FIELDS[key]}</th>)}</> : null}
          <th>金属标</th>
          {show("trims") ? <><th>纽扣 / 拉链 / 裤钩</th>{trimKeys.map(key => <th key={key}>{COLOR_TRIM_FIELDS[key]}</th>)}<th>本款其他辅料</th></> : null}
          {show("progress") ? <><th>跟单 / 面辅料进度</th><th>生产与出运登记</th></> : null}
        </tr></thead>
        {lines.map(line => {
          const colors = line.colors.length ? line.colors : [blankColor];
          const total = masterCounts([line]);
          return <tbody key={line.key}>{colors.map((color, index) => <tr key={index} className={/下不|不下/.test(color.qtyText) ? "text-[var(--ink-muted)]" : ""}>
            {index === 0 ? <>
              <td rowSpan={colors.length} className="master-product align-top">
                <div className="flex items-start gap-2">
                  <TablePhoto src={line.imageSrc} label={`${line.styleName || line.styleCode}款式图`} />
                  <div className="min-w-0 flex-1">
                    <Link href={`${line.href}#follow-product`} className="font-medium text-[var(--brand-strong)]">{line.styleName || line.styleCode || "品名待补"}</Link>
                    <CellLink line={line} section="follow-product"><div className="mt-1">产品编号 {line.numericCode || "待补"}</div></CellLink>
                    <div className="text-[var(--ink-muted)]">款式编码 {line.styleCode || "待补"}</div>
                    <div className="mt-2">{colors.length} 个颜色行 · 已填 {total.quantity.toLocaleString()} 件{total.missingQuantity ? "（部分待补）" : ""}</div>
                  </div>
                </div>
              </td>
              <td rowSpan={colors.length} className="align-top"><CellLink line={line} section="follow-product"><strong>{line.po || "PO 待补"}</strong><div className="mt-1">采购：{line.purchaseDate || "待补"}</div></CellLink>{line.orderNo && line.orderNo !== line.po ? <p>原编号 {line.orderNo}（待核对）</p> : null}<div className="text-[var(--ink-muted)]">{line.seasonCode || "季节待补"}</div></td>
            </> : null}
            <td><CellLink line={line} section="follow-colors">{color.guestColor || "颜色待补"}<div className="text-[var(--ink-muted)]">{color.factoryColorName || "厂色未填"}</div></CellLink></td>
            <td className="master-quantity text-right"><CellLink line={line} section="follow-colors">{color.qtyText || "待补"}</CellLink></td>
            {index === 0 ? <>
              <td rowSpan={colors.length} className="align-top"><CellLink line={line} section="follow-batch"><div>要求出货：{line.shipDate || "待补"}</div><div className="mt-1">进仓：{line.inboundDate || "待补"}</div></CellLink></td>
              {show("materials") ? <td rowSpan={colors.length} className="align-top"><CellLink line={line} section="stage-materials"><div>{line.composition || "成分待补"}</div><div>{[line.gsm && `${line.gsm} GSM`, line.shellWidth && `门幅 ${line.shellWidth}`, line.shellConsumption && `单耗 ${line.shellConsumption}`].filter(Boolean).join(" · ")}</div>{line.materialSummary ? <div className="mt-2 text-[var(--ink-muted)]">本单资料：{line.materialSummary}</div> : null}</CellLink></td> : null}
            </> : null}
            {show("labels") ? <>{index === 0 ? <td rowSpan={colors.length} className="align-top" data-main-label><CellLink line={line} section="follow-color-trims">{bulkMainLabel({ mainLabel: line.bulkMainLabel, colors })}</CellLink><CellThumbs images={line.bulkPictures?.mainLabel || []} label="主唛 · 本款共用" /></td> : null}{labelKeys.map(key => <td key={key}><CellLink line={line} section="follow-color-trims">{colorTrimText(color, key) || "待补"}{key === "careLabel" && color.colorTrims?.careSizeLabel ? <div className="mt-1 text-[var(--ink-muted)]">原洗唛 / 尺码唛合并说明：{color.colorTrims.careSizeLabel}</div> : null}</CellLink><CellThumbs images={color.pictures?.[key] || []} label={`${color.guestColor}的${COLOR_TRIM_FIELDS[key]}`} /></td>)}</> : null}
            <td><CellLink line={line} section="follow-colors">{color.metalBadge}</CellLink><CellThumbs images={color.pictures?.metalBadge || []} label={`${color.guestColor}的金属标`} /></td>
            {show("trims") ? <>
              {index === 0 ? <td rowSpan={colors.length} className="align-top"><CellLink line={line} section="follow-colors">{[line.button && `纽扣：${line.button}`, line.zipper && `拉链：${line.zipper}`, line.hook && `裤钩：${line.hook}`].filter(Boolean).join("\n")}</CellLink>{(["button", "zipper", "hook"] as const).map(key => line.bulkPictures?.[key]?.length ? <div key={key}><span className="text-[var(--ink-muted)]">{{button:"纽扣",zipper:"拉链",hook:"裤钩"}[key]}</span><CellThumbs images={line.bulkPictures[key]!} label={{button:"纽扣",zipper:"拉链",hook:"裤钩"}[key]} /></div> : null)}</td> : null}
              {trimKeys.map(key => <td key={key}><CellLink line={line} section="follow-color-trims">{colorTrimText(color, key)}</CellLink><CellThumbs images={color.pictures?.[key] || []} label={`${color.guestColor}的${COLOR_TRIM_FIELDS[key]}`} /></td>)}
              {index === 0 ? <td rowSpan={colors.length} className="align-top"><CellLink line={line} section="follow-colors">{line.otherTrim}</CellLink><CellThumbs images={line.bulkPictures?.otherTrim || []} label="本款其他辅料" /></td> : null}
            </> : null}
            {show("progress") && index === 0 ? <>
              <td rowSpan={colors.length} className="align-top"><CellLink line={line} section="follow-progress">{line.progress || "进度待补"}</CellLink></td>
              <td rowSpan={colors.length} className="align-top">{line.productionHref ? <Link href={line.productionHref} className="master-cell-link"><div>生产单 {line.productionOrderNo}</div><div>{line.productionProgress}</div><div className="mt-1">出运登记：{line.shipmentDates.join("、") || "暂无可归属此 PO 的登记"}</div></Link> : "尚未开生产订单"}</td>
            </> : null}
          </tr>)}</tbody>;
        })}
      </table>
    </div>
  </section>;
}

export function BulkMasterBoard({ lists, viewerKey, side = "bulk", printMode = false, initial = {} }: { lists: FollowProductLists; viewerKey?: string; side?: "sales" | "bulk"; printMode?: boolean; initial?: { season?: string; factory?: string; query?: string; from?: string; to?: string; columns?: string } }) {
  const sales = side === "sales";
  const title = sales ? "销售样总表" : "大货总表";
  const [season, setSeason] = useState(initial.season ?? "");
  const [factory, setFactory] = useState(initial.factory ?? "");
  const [query, setQuery] = useState(initial.query ?? "");
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [columnOverride, setColumnOverride] = useState<MasterColumn[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
  const [fullText, setFullText] = useState(false);
  const [scale, setScale] = useState(100);
  const [printPaper, setPrintPaper] = useState("a4");
  const [separateFactories, setSeparateFactories] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (!expanded && wasExpanded.current) expandButtonRef.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);
  const id = useId();
  const storageKey = viewerKey ? `yiju:${sales ? "sales-" : ""}master-columns:v1:${viewerKey}` : null;
  const savedColumns = useSyncExternalStore(
    notify => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); },
    () => { try { return !printMode && storageKey ? localStorage.getItem(storageKey) : null; } catch { return null; } },
    () => null,
  );
  const columns = columnOverride ?? parseMasterColumns(savedColumns ?? initial.columns);
  function setColumns(next: MasterColumn[]) {
    setColumnOverride(next);
    if (storageKey && !printMode) try { localStorage.setItem(storageKey, next.join(",")); } catch { /* Optional local preference. */ }
  }
  const groupedSales = (lines: FollowStyleLine[]) => [...new Set(lines.map(line => line.factoryName || "工厂待定"))].map(factoryName => ({ factoryName, styles: lines.filter(line => (line.factoryName || "工厂待定") === factoryName) }));
  const groups = sales ? groupedSales(lists.sales) : lists.bulk;
  const sourceLines = groups.flatMap(group => group.styles);
  const seasons = [...new Set(sourceLines.map(line => line.seasonCode))].sort();
  const searched = filterFollowProducts(lists, query, sales ? "" : from, sales ? "" : to);
  const filtered = (sales ? groupedSales(searched.sales) : searched.bulk)
    .filter(group => !factory || group.factoryName === factory)
    .map(group => ({ ...group, styles: group.styles.filter(line => !season || (season === "__empty__" ? !line.seasonCode : line.seasonCode === season)) })).filter(group => group.styles.length);
  const visibleLines = filtered.flatMap(group => group.styles);
  const count = masterCounts(visibleLines);
  const suggestions = [...new Set(sourceLines.flatMap(line => [line.numericCode, line.po, line.styleCode, line.styleName, line.sampleColors, ...line.colors.map(color => color.guestColor)]).filter(Boolean))].filter(value => value.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  const printParams = new URLSearchParams({ sheet: side, season, factory, q: query, from: sales ? "" : from, to: sales ? "" : to, columns: columns.join(",") });
  const content = <div data-paper={printPaper} data-separate-factories={separateFactories} className={`follow-master ${printMode ? "follow-print-root" : ""} ${fullText || printMode ? "master-full-text" : "master-compact"}`}>
    <div className="master-toolbar mb-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={`${id}-title`} className="text-lg font-semibold">{season && season !== "__empty__" ? `${season} ` : ""}{title}</h2>
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--brand-strong)]">
          {!printMode ? <button ref={expandButtonRef} type="button" aria-expanded={expanded} className="inline-flex items-center gap-1.5" onClick={() => { if (!expanded) setPlaceholderHeight(boardRef.current?.getBoundingClientRect().height ?? 0); setExpanded(!expanded); }}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{expanded ? "收起总表" : "放大总表"}</button> : null}
          {printMode ? <button type="button" onClick={() => window.print()}>打印 / 保存 PDF</button> : <Link href={`/orders/follow/print?${printParams}`} target="_blank">打印 / PDF</Link>}
        </div>
      </div>
      {!printMode ? <>
        <div className="flex flex-wrap gap-3 text-sm">
          <label>季节<select aria-label="总表季节" value={season} onChange={e => setSeason(e.target.value)} className="ml-2 rounded border border-[var(--line)] bg-[var(--field-solid)] p-2"><option value="">全部季节</option>{seasons.map(value => <option key={value} value={value || "__empty__"}>{value || "季节未填"}</option>)}</select></label>
          <label>工厂<select aria-label="总表工厂" value={factory} onChange={e => setFactory(e.target.value)} className="ml-2 rounded border border-[var(--line)] bg-[var(--field-solid)] p-2"><option value="">全部工厂</option>{groups.map(group => <option key={group.factoryName}>{group.factoryName}</option>)}</select></label>
          <label className="min-w-[240px] flex-1"><span className="sr-only">检索总表</span><input aria-label="检索总表" list={id} value={query} onChange={e => setQuery(e.target.value)} placeholder="产品编号、PO、品名、颜色或辅料；输入即筛选" className="w-full rounded border border-[var(--line)] bg-[var(--field-solid)] p-2" /><datalist id={id}>{suggestions.map(value => <option key={value} value={value} />)}</datalist></label>
        </div>
        {expanded ? <div className="flex items-center gap-3 text-xs text-[var(--ink-muted)]"><label>表格缩放 <select aria-label="表格缩放" value={scale} onChange={event => setScale(Number(event.target.value))} className="rounded border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1">{[80, 100, 120].map(value => <option key={value} value={value}>{value}%</option>)}</select></label><span>按 Esc 返回原页面</span></div> : null}
        <details className="text-sm"><summary className="cursor-pointer text-[var(--ink-muted)]">{sales ? "显示选项" : "日期筛选与显示选项"}</summary><div className="mt-3 flex flex-wrap items-center gap-4">
          {!sales ? <><label>采购起始日期<input aria-label="采购起始日期" placeholder="YYYY-MM-DD" value={from} onChange={e => setFrom(e.target.value)} className="ml-2 w-36 rounded border border-[var(--line)] bg-[var(--field-solid)] p-1" /></label>
          <label>采购结束日期<input aria-label="采购结束日期" placeholder="YYYY-MM-DD" value={to} onChange={e => setTo(e.target.value)} className="ml-2 w-36 rounded border border-[var(--line)] bg-[var(--field-solid)] p-1" /></label></> : null}
          {standardMasterColumns.map(key => <label key={key} className="flex gap-1"><input type="checkbox" checked={columns.includes(key)} onChange={e => setColumns(e.target.checked ? [...columns, key] : columns.filter(column => column !== key))} />{sales ? ({ materials: "面料 / 纱线 / 里布", labels: "唛标 / 挂牌", trims: "辅料 / 自定义元素", progress: "跟单 / 生产进度" })[key] : MASTER_COLUMNS[key]}</label>)}
          <label className="flex gap-1"><input aria-label="展开长说明" type="checkbox" checked={fullText} onChange={event => setFullText(event.target.checked)} />展开长说明</label>
          <button type="button" className="text-[var(--brand-strong)]" onClick={() => setColumns(standardMasterColumns)}>恢复标准列</button>
          {query || season || factory || from || to ? <button type="button" className="text-[var(--brand-strong)]" onClick={() => { setQuery(""); setSeason(""); setFactory(""); setFrom(""); setTo(""); }}>清除筛选</button> : null}
        </div></details>
        <p className="text-xs text-[var(--ink-muted)]">点图片放大查看；点品名、产品编号或 PO 打开本款详情，点资料进入对应位置修改。长说明可在显示选项中展开，打印保留全文；显示设置不改变业务记录。</p>
      </> : <>
        <p className="text-sm">{factory || "全部工厂"}{query ? ` · 检索 ${query}` : ""}{from || to ? ` · 客户采购日期 ${from || "不限"} 至 ${to || "不限"}` : ""} · 保留当前选定资料，长说明移至宽行</p>
        <div className="print-options flex flex-wrap items-center gap-4 text-sm">
          <label>打印纸张 <select aria-label="打印纸张" value={printPaper} onChange={event => setPrintPaper(event.target.value)} className="rounded border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1"><option value="a4">A4 横向</option><option value="a3">A3 横向</option></select></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={separateFactories} onChange={event => setSeparateFactories(event.target.checked)} />每家工厂另起一页</label>
          <span className="text-xs text-[var(--ink-muted)]">默认连续排版；长说明完整保留，相同说明按颜色合并。预览时可关闭浏览器的页眉和页脚。</span>
        </div>
        <p className="print-legend">— 表示当前未填，不代表无需使用；“见说明”对应本款本 PO 下方原文。</p>
      </>}
      {from && to && from > to ? <p role="alert" className="text-[var(--danger)]">采购起始日期不能晚于结束日期。</p> : null}
      {(from && !isFullDate(from)) || (to && !isFullDate(to)) ? <p role="alert" className="text-[var(--danger)]">请按 YYYY-MM-DD 填写有效的完整采购日期。</p> : null}
      <p className="text-sm">{filtered.length} 家工厂 · {count.products} 款 · {count.pos} 个已填 PO · {sales ? `${visibleLines.length} 条销售样记录（数量按各行原文核对）` : `已填 ${count.quantity.toLocaleString()} 件${count.missingQuantity ? `，${count.missingQuantity} 行数量待补` : ""}`}</p>
    </div>
    {!filtered.length ? <p role="status" className="py-5 text-sm">没有符合条件的{sales ? "销售样" : "大货"}记录。可清除筛选，或新建跟单填写款式。</p> : null}
    <div className="master-tables" style={{ zoom: printMode || !expanded ? 1 : scale / 100 }}>{filtered.map(group => sales ? <SalesMasterTable key={group.factoryName} name={group.factoryName} lines={group.styles} columns={columns} printMode={printMode} /> : printMode ? <BulkMasterPrint key={group.factoryName} name={group.factoryName} lines={group.styles} columns={columns} /> : <FactoryTable key={group.factoryName} name={group.factoryName} lines={group.styles} columns={columns} />)}</div>
    <p className="mt-4 text-xs text-[var(--ink-muted)]">{sales ? "销售样一款一行，数量保留原文，拍照样与销售样分列；转大货不沿用销售样件数、旧 PO 或旧批准。" : <>“不下”的颜色保留但不计入件数；缺数量不按零计完整。要求出货日期是计划，进仓日期另记，出运登记不替代实际离港凭证。生产数量注明整单范围，不摊算成单款进度。</>}</p>
  </div>;
  return <><div ref={boardRef}>{expanded ? <div aria-hidden="true" style={{ height: placeholderHeight }} /> : content}</div>{expanded ? <MasterFocus titleId={`${id}-title`} onClose={() => setExpanded(false)}>{content}</MasterFocus> : null}</>;
}
