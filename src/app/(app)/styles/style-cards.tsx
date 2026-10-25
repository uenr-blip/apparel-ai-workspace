import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Factory } from "lucide-react";
import { TablePhoto } from "@/components/table-photo";
import type { listStyleSummaries } from "@/server/services/style-thread";
import css from "./style-cards.module.css";

export function StyleCards({ styles, canEdit, previewPhotos = false }: { styles: Awaited<ReturnType<typeof listStyleSummaries>>; canEdit: boolean; previewPhotos?: boolean }) {
  const factoryLabels = new Map([...new Set(styles.flatMap(style => style.factoryNames))].map(name => {
    const shortName = name.replace(/(?:服装|服饰|制衣)?(?:有限责任公司|有限公司|加工厂|工厂|厂)$/u, "").trim();
    return [name, shortName.length >= 2 ? shortName : name];
  }));
  const labelCounts = new Map<string, number>();
  for (const label of factoryLabels.values()) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  return <div className={css.grid}>
    {styles.map(style => {
      const href = `/styles/${style.id}`;
      const pos = [...new Set([...style.orderPos, ...style.followPos].map(row => row.po).filter(Boolean))];
      const poLabel = pos.length ? `${pos.slice(0, 2).join(" · ")}${pos.length > 2 ? ` · 另 ${pos.length - 2} 个` : ""}` : "待填写";
      return <article key={style.id} className={css.card} aria-label={`${style.code} ${style.name}`}>
        {previewPhotos ? <TablePhoto src={style.imageSrc} label={`${style.code} ${style.name}`} className={css.picture} /> : <Link href={href} prefetch={false} className={css.picture} aria-label={`查看 ${style.code} 详情`}>
          <Image src={style.imageSrc} alt={`${style.name} 款式图`} width={224} height={312} unoptimized />
        </Link>}
        <div className={css.body}>
          <div className={css.heading}>
            <Link href={href} prefetch={false} className={css.code}>{style.code}</Link>
            <div className={css.factories} aria-label="关联工厂">
              {style.factories.length ? style.factories.map(({ id, name }) => {
                const content = <>
                  <span className={css.factoryIcon}><Factory size={13} strokeWidth={1.6} aria-hidden="true" /></span>
                  <span>{labelCounts.get(factoryLabels.get(name)!) === 1 ? factoryLabels.get(name) : name}</span>
                </>;
                return id ? <Link key={id} href={`/resources/parties/${id}`} prefetch={false} className={`${css.factory} ${css.factoryLink}`} title={`查看 ${name} 的工厂档案`} aria-label={`查看工厂：${name}`}>
                  {content}<ChevronRight className={css.factoryArrow} size={12} aria-hidden="true" />
                </Link> : <span key={name} className={`${css.factory} ${css.factoryPending}`} title={`${name} · 尚未关联唯一工厂档案`} aria-label={`关联工厂：${name}，档案待关联`}>{content}</span>;
              }) : <span className={`${css.factory} ${css.factoryPending}`} title="在销售样或大货跟单中填写工厂后自动显示">
                <Factory size={13} strokeWidth={1.6} aria-hidden="true" />
                <span>工厂待定</span>
              </span>}
            </div>
          </div>
          <Link href={href} prefetch={false} className={css.name} title={style.name}>{style.name}</Link>
          <div className={css.meta}>
            <span title="品牌">{style.brandName || "品牌待补"}</span>
            <span title="类型">{style.typeName || "类型待补"}</span>
            <span title="季节">{style.seasonCodes.join(" / ") || "季节待补"}</span>
          </div>
          <Link href={`${href}#style-orders`} prefetch={false} className={css.po} title={pos.join("、") || "打开款式中的订单 PO 区域填写"}>订单 PO · {poLabel}</Link>
        </div>
        <nav className={css.actions} aria-label={`${style.code} 快捷操作`}>
          <Link href={href} prefetch={false}>详情</Link>
          <Link href={`${href}#style-materials`} prefetch={false} title="查看本款面料、纱线与辅料">面辅料</Link>
          {canEdit ? <Link href={`/resources/catalog?kind=style&id=${style.id}`} prefetch={false}>编辑</Link> : null}
        </nav>
      </article>;
    })}
  </div>;
}
