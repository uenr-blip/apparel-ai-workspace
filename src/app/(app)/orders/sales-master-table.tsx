"use client";

import Image from "next/image";
import Link from "next/link";
import { TablePhoto } from "@/components/table-photo";
import type { FollowStyleLine } from "@/server/services/order-merch";
import type { MasterColumn } from "@/lib/follow-master";
import { CellThumbs } from "./sheet-picture";

type Detail = { group: MasterColumn | "notes"; label: string; text: string; section: string; images?: string[] };
function details(line: FollowStyleLine, columns: MasterColumn[]): Detail[] {
  const rows: Detail[] = [];
  let group: MasterColumn | "notes" = "notes";
  const add = (label: string, text: string, section = "follow-sample", images?: string[]) => rows.push({ group, label, text, section, images });
  if (columns.includes("materials")) {
    group = "materials";
    add("面料与纱线", [line.composition, line.gsm && `克重 ${line.gsm}`, line.shellWidth && `门幅 ${line.shellWidth}`, line.shellConsumption && `单耗 ${line.shellConsumption}`, line.materialSummary].filter(Boolean).join(" · "), "stage-materials");
    add("里布", [line.liningWidth && `门幅 ${line.liningWidth}`, line.liningConsumption && `单耗 ${line.liningConsumption}`, line.liningColor].filter(Boolean).join(" · "), "stage-materials", line.pictures?.liningColor);
    add("面料颜色意见", line.colorOpinion);
  }
  if (columns.includes("labels")) {
    group = "labels";
    add("主唛", line.mainLabel, "follow-sample-labels", line.pictures?.mainLabel);
    add("挂牌", line.hangtag, "follow-sample-labels", line.pictures?.hangtag);
    add("贴纸", line.sticker);
  }
  if (columns.includes("trims")) {
    group = "trims";
    add("金属标", line.sampleMetal, "follow-sample-labels", line.pictures?.metalBadge);
    for (const element of line.sampleElements || []) add(element.label, element.text, "follow-sample-labels", element.images);
  }
  group = "notes";
  add("价格与费用", [line.shellPrice && `面布 ${line.shellPrice}`, line.liningPrice && `里布 ${line.liningPrice}`, line.buttonPrice && `扣子 ${line.buttonPrice}`, line.laborPrice && `工价 ${line.laborPrice}`, line.otherTrimCost && `其他辅料和走货 ${line.otherTrimCost}`, line.totalPrice && `总价 ${line.totalPrice}`].filter(Boolean).join(" · "));
  add("备注", line.note, "follow-sample-labels", line.pictures?.note);
  if (columns.includes("progress")) {
    group = "progress";
    add("跟单进度", line.progress, "follow-progress");
    add("生产登记", line.productionHref ? [line.productionOrderNo, line.productionProgress, line.shipmentDates.length ? `出运登记 ${line.shipmentDates.join("、")}` : ""].filter(Boolean).join(" · ") : "尚未开生产订单", "follow-open-order");
  }
  return rows;
}

export function SalesMasterTable({ name, lines, columns, printMode = false }: { name: string; lines: FollowStyleLine[]; columns: MasterColumn[]; printMode?: boolean }) {
  const groups: Array<{ key: MasterColumn | "notes"; title: string; names: string[] }> = [
    { key: "materials", title: "面料 / 纱线 / 里布", names: ["面料与纱线", "里布", "面料颜色意见"] },
    { key: "labels", title: "主唛 / 挂牌 / 贴纸", names: ["主唛", "挂牌", "贴纸"] },
    { key: "trims", title: "辅料 / 自定义元素", names: ["金属标", ...lines.flatMap(line => (line.sampleElements || []).map(e => e.label))] },
    { key: "notes", title: "价格 / 费用 / 备注", names: ["价格与费用", "备注"] },
    { key: "progress", title: "跟单 / 生产进度", names: ["跟单进度", "生产登记"] },
  ].filter(group => group.key === "notes" || columns.includes(group.key as MasterColumn)) as Array<{ key: MasterColumn | "notes"; title: string; names: string[] }>;
  if (printMode) return <section className="print-factory"><h3 className="print-factory-title">{name}<span>{lines.length} 条销售样记录</span></h3>{lines.map(line => <table key={line.key} className="print-style-table">
    <thead><tr><th colSpan={4} className="print-style-heading"><div className="print-style-identity">
      {line.imageSrc ? <div className="print-style-image"><Image src={line.imageSrc} alt={`${line.styleName}款式图`} width={56} height={72} unoptimized /></div> : null}
      <div className="print-style-name">{line.styleName || line.styleCode}<div>产品编号 {line.numericCode || "—"} · 款号 {line.styleCode || "—"}</div></div>
      <div className="print-style-batch">PO {line.po || "—"}<div>{line.seasonCode || "季节未填"}</div></div>
    </div></th></tr><tr><th>颜色</th><th>销售样数量 / 原文</th><th>拍照样</th><th>关联跟单</th></tr></thead>
    <tbody><tr className="print-color-row"><td>{line.sampleColors || "—"}</td><td>{line.salesSampleQty || "—"}</td><td>{line.photoSample || "—"}</td><td>{line.sheetTitle}</td></tr></tbody>
    <tbody className="print-wide-notes">{details(line, columns).filter(d => d.text || d.images?.length).map((d, i) => <tr key={i}><td colSpan={4}><strong>{d.label}：</strong><span className="whitespace-pre-wrap">{d.text || "—"}</span>{d.images?.length ? <div className="print-field-pictures"><div>{d.images.map(src => <Image key={src} src={src} alt={d.label} width={48} height={48} unoptimized />)}</div></div> : null}</td></tr>)}</tbody>
  </table>)}</section>;
  return <section className="master-factory mt-6 first:mt-0"><h3 className="mb-3 font-semibold">{name}<span className="ml-4 text-sm font-normal text-[var(--ink-muted)]">{lines.length} 条销售样记录 · 一款一行</span></h3>
    <div className="master-scroll overflow-auto rounded-lg border border-[var(--line)]"><table className="master-table text-xs leading-5">
      <colgroup><col className="master-col-product" /><col className="master-col-po" /><col className="master-col-color" />{groups.map(g => <col key={g.key} className="master-col-detail" />)}</colgroup>
      <thead><tr><th className="master-product">款式图 / 品名 / 产品编号</th><th>订单号（PO） / 季节</th><th>颜色 / 销售样 / 拍照样</th>{groups.map(g => <th key={g.key}>{g.title}</th>)}</tr></thead>
      <tbody>{lines.map(line => <tr key={line.key}>
        <td className="master-product"><div className="flex items-start gap-2"><TablePhoto src={line.imageSrc} label={`${line.styleName || line.styleCode}款式图`} /><div className="min-w-0"><Link href={`${line.href}#follow-product`} className="font-medium text-[var(--brand-strong)]">{line.styleName || line.styleCode || "品名待补"}</Link><Link href={`${line.href}#follow-product`} className="mt-1 block master-cell-link">产品编号 {line.numericCode || "待补"}</Link><div className="text-[var(--ink-muted)]">款号 {line.styleCode || "待补"}</div>{line.others?.length ? <details className="mt-1"><summary className="cursor-pointer text-[var(--brand-strong)]">相关跟单 {line.others.length}</summary>{line.others.map(link => <Link key={link.href + link.label} href={link.href} className="mt-1 block text-[var(--brand-strong)]">{link.label}</Link>)}</details> : null}</div></div></td>
        <td><Link href={`${line.href}#follow-product`} className="master-cell-link"><strong>{line.po || "PO 待补"}</strong></Link><div>{line.seasonCode || "季节待补"}</div></td>
        <td><Link href={`${line.href}#follow-sample`} className="master-cell-link"><div className="master-cell-content">{line.sampleColors || "颜色待补"}{"\n"}销售样：{line.salesSampleQty || "待补"}{"\n"}拍照样：{line.photoSample || "待补"}</div></Link></td>
        {groups.map(g => <td key={g.key}>{details(line, columns).filter(d => g.key === d.group).map((d, i) => <div key={i} className="mb-1 last:mb-0"><Link href={`${line.href}#${d.section}`} className="master-cell-link"><div className="master-cell-content"><span className="text-[var(--ink-muted)]">{d.label}：</span>{d.text || "待补"}</div></Link><CellThumbs images={d.images || []} label={d.label} /></div>)}</td>)}
      </tr>)}</tbody>
    </table></div>
  </section>;
}
