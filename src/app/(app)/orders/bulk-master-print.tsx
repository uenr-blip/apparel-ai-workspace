import Image from "next/image";
import Link from "next/link";
import { masterCounts, type MasterColumn } from "@/lib/follow-master";
import { followPrintContent, type PrintValue } from "@/lib/follow-print";
import type { FollowStyleLine } from "@/server/services/order-merch";

function Values({ values }: { values: PrintValue[] }) {
  return values.length ? <>{values.map((item, i) => <span key={i}>{i ? "； " : ""}<span className="print-field-label">{item.label}：</span>{item.value}</span>)}</> : <span className="print-empty">—</span>;
}

export function BulkMasterPrint({ name, lines, columns }: { name: string; lines: FollowStyleLine[]; columns: MasterColumn[] }) {
  const count = masterCounts(lines), labels = columns.includes("labels"), width = labels ? 4 : 3;
  return <section className="print-factory" data-factory={name}>
    <h3 className="print-factory-title">{name}<span>{count.products} 款 · {count.pos} 个已填 PO · 已填 {count.quantity.toLocaleString()} 件{count.missingQuantity ? ` · ${count.missingQuantity} 行数量待补` : ""}</span></h3>
    {lines.map(line => {
      const content = followPrintContent(line, columns), total = masterCounts([line]);
      return <table key={line.key} className="print-style-table" data-style-key={line.key}>
        <colgroup><col className="print-col-color" /><col className="print-col-quantity" />{labels ? <col /> : null}<col /></colgroup>
        <thead>
          <tr><th colSpan={width} className="print-style-heading">
            <div className="print-style-identity">
              {line.imageSrc ? <Link href={line.styleHref || `${line.href}#follow-product`} className="print-style-image"><Image src={line.imageSrc} width={42} height={50} alt={`${line.styleName || line.styleCode}款式图`} unoptimized /></Link> : null}
              <div className="print-style-name"><Link href={line.styleHref || `${line.href}#follow-product`}>{line.styleName || line.styleCode || "品名待补"}</Link><div>产品编号 {line.numericCode || "待补"} · 款式编码 {line.styleCode || "待补"} · {line.seasonCode || "季节待补"}</div></div>
              <div className="print-style-batch"><Link href={`${line.href}#follow-batch`}><strong>订单号 {line.po || "PO 待补"}</strong></Link><div>{content.rows.length} 个颜色行 · 已填 {total.quantity.toLocaleString()} 件{total.missingQuantity ? "（部分待补）" : ""}</div></div>
            </div>
            <div className="print-batch-dates">工厂：{name} · 采购：{line.purchaseDate || "待补"} · 要求出货：{line.shipDate || "待补"} · 进仓：{line.inboundDate || "待补"}{line.orderNo && line.orderNo !== line.po ? ` · 原编号 ${line.orderNo}（待核对）` : ""}</div>
            {labels ? <div className="print-batch-dates print-note-text">主唛 · 本款共用：{content.mainLabel || "待补"}</div> : null}
          </th></tr>
          <tr className="print-column-headings"><th>颜色 / 厂色</th><th>件数</th>{labels ? <th>每色唛标 / 吊牌</th> : null}<th>{columns.includes("trims") ? "金属标 / 特殊工艺 / 其他每色辅料" : "金属标"}</th></tr>
        </thead>
        <tbody>{content.rows.map(row => <tr key={row.number} className="print-color-row">
          <td><Link href={`${line.href}#follow-colors`}><span className="print-row-number">{String(row.number).padStart(2, "0")}</span>{row.color || "颜色待补"}{row.factoryColor ? <div className="print-factory-color">厂色：{row.factoryColor}</div> : null}</Link></td>
          <td className="print-quantity"><Link href={`${line.href}#follow-colors`}>{row.quantity || "待补"}</Link></td>
          {labels ? <td><Link href={`${line.href}#follow-color-trims`}><Values values={row.labels} /></Link></td> : null}
          <td><Link href={`${line.href}#follow-color-trims`}><Values values={row.trims} /></Link></td>
        </tr>)}</tbody>
        {content.pictures.length ? <tbody className="print-picture-notes">{Array.from({ length: Math.ceil(content.pictures.length / 4) }, (_, i) => <tr key={i}><td colSpan={width}><div className="print-picture-groups">{content.pictures.slice(i * 4, i * 4 + 4).map((group, n) => <div key={n} className="print-field-pictures"><strong>{group.label} · {group.shared ? "本款共用" : `颜色行 ${group.rows.map(n => String(n).padStart(2, "0")).join("、")}`}</strong><div>{group.images.map((src, index) => <Image key={src} src={src} alt={`${group.label}图片 ${index + 1}`} width={56} height={56} unoptimized />)}</div></div>)}</div></td></tr>)}</tbody> : null}
        {content.notes.length || content.details.length ? <tbody className="print-wide-notes">
          {content.notes.map(note => <tr key={note.number}><td colSpan={width}><Link href={`${line.href}#follow-color-trims`}><strong>说明 {note.number} · {note.label}（{note.allColors ? "本表全部颜色" : `颜色行 ${note.rows.map(n => String(n).padStart(2, "0")).join("、")}`}）</strong><div className="print-note-text">{note.text}</div></Link></td></tr>)}
          {content.details.length ? <tr><td colSpan={width}>{content.details.map((detail, i) => <span key={`detail-${i}`} className="print-detail"><Link href={detail.href || `${line.href}#${detail.section}`}><strong>{detail.label}：</strong><span className="print-note-text">{detail.text}</span></Link></span>)}</td></tr> : null}
        </tbody> : null}
      </table>;
    })}
  </section>;
}
