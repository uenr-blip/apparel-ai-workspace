import Link from "next/link";
import { ArrowUpRight, Factory, Layers3, LockKeyhole, PencilRuler, Shirt, WalletCards } from "lucide-react";
import styles from "./business-areas.module.css";
import { businessHref } from "@/lib/business-navigation";

export function BusinessAreas({ financeHref }: { financeHref: string | null }) {
  const areas = [
    { title: "开发", description: "版单 · 改版 · 工厂打样", href: businessHref("development"), icon: PencilRuler },
    { title: "销售样", description: "样单 · 客户确认 · 转大货", href: businessHref("sales"), icon: Shirt },
    { title: "大货", description: "工厂总表 · PO · 交期", href: businessHref("bulk"), icon: Layers3 },
    { title: "工厂", description: "生产单 · 进度 · 转厂", href: businessHref("production"), icon: Factory },
    { title: "财务", description: "收付 · 对账 · 结汇", href: financeHref, icon: WalletCards },
  ];

  return (
    <section aria-labelledby="business-areas-title" className={styles.section}>
      <div className={styles.heading}>
        <h3 id="business-areas-title">从这里开始工作</h3>
        <Link href="/styles?tab=materials" prefetch={false}>面辅料库 <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
      <nav aria-label="主要业务板块" className={styles.grid}>
        {areas.map(({ title, description, href, icon: Icon }) => {
          const content = <>
            <span className={styles.top}><span className={styles.icon}><Icon size={24} strokeWidth={1.6} aria-hidden="true" /></span>{href ? <ArrowUpRight size={18} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}</span>
            <span className={styles.title}>{title}</span>
            <span className={styles.description}>{description}</span>
            {!href && <span className={styles.access}>需财务查阅权限</span>}
          </>;
          return href
            ? <Link key={title} href={href} prefetch={false} className={styles.area} aria-label={`进入${title}`}>{content}</Link>
            : <div key={title} className={`${styles.area} ${styles.unavailable}`} aria-label="财务，需财务查阅权限">{content}</div>;
        })}
      </nav>
    </section>
  );
}
