import Link from "next/link";
import { ArrowUpRight, ImageOff } from "lucide-react";
import { TablePhoto } from "@/components/table-photo";
import type { MaterialShelfItem } from "@/server/services/material-shelf";
import card from "./style-cards.module.css";
import css from "./material-cards.module.css";

export function MaterialCards({ materials }: { materials: MaterialShelfItem[] }) {
  return <div className={card.grid}>
    {materials.map(item => {
      const href = `/resources/materials/${item.id}`;
      const usage = [
        item.usedByStyleCodes.length ? `${item.usedByStyleCodes.length} 款使用` : "",
        item.usedByProjectCodes.length ? `${item.usedByProjectCodes.length} 个开发引用` : "",
      ].filter(Boolean).join(" · ") || "尚未引用";
      return <article key={item.id} className={`${card.card} ${css.card}`} aria-label={`${item.code} ${item.name}`}>
        {item.imageSrc ? <TablePhoto src={item.imageSrc} label={`${item.name}材料图`} className={`${card.picture} ${css.picture}`} /> : <div className={`${card.picture} ${css.emptyPicture}`}><ImageOff size={23} strokeWidth={1.3} aria-hidden="true" /><span>暂无图片</span></div>}
        <div className={card.body}>
          <div className={card.heading}>
            <Link href={href} prefetch={false} className={card.code}>{item.code}</Link>
            <span className={css.kind}>{item.kindLabel}</span>
          </div>
          <Link href={href} prefetch={false} className={card.name} title={item.name}>{item.name}</Link>
          <dl className={css.facts}>
            <div><dt>成分</dt><dd title={item.composition || undefined}>{item.composition || "待补充"}</dd></div>
            <div><dt>规格</dt><dd title={item.specSummary || undefined}>{item.specSummary || "待补充"}</dd></div>
          </dl>
          <div className={css.measures}>
            {item.gsm ? <span>克重 {item.gsm} g/m²</span> : null}
            {item.widthCm ? <span>幅宽 {item.widthCm} cm</span> : null}
            <span>单位 {item.unit}</span>
          </div>
        </div>
        <nav className={`${card.actions} ${css.actions}`} aria-label={`${item.code} 快捷操作`}>
          <Link href={href} prefetch={false} aria-label={`查看${item.name}详情`}>详情 <ArrowUpRight size={13} aria-hidden="true" /></Link>
          <span className={css.usage} title={[...item.usedByStyleCodes, ...item.usedByProjectCodes].join("、") || undefined}>{usage}</span>
        </nav>
      </article>;
    })}
  </div>;
}
