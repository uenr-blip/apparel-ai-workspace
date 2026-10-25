import Link from "next/link";
import { ArrowUpRight, Archive, Boxes, ContactRound, Library, PackageCheck, Shirt, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

type Entry = { label: string; note: string; href: string; icon: LucideIcon };

export function ResourceHub({ factoryOnly }: { factoryOnly: boolean }) {
  const records: Entry[] = [
    { label: "款式档案", note: "款式图、产品编号与各版资料", href: "/styles", icon: Shirt },
    { label: "面辅料库", note: "面料、辅料与纱线，可从各阶段选用", href: "/styles?tab=materials", icon: Library },
    { label: "客户 / 工厂 / 供应商", note: "往来单位、关联业务与历史", href: "/resources?view=partners", icon: ContactRound },
  ];
  const stock: Entry[] = [
    { label: factoryOnly ? "本厂库存" : "库存批次", note: "在手、占用、在途，逐批核对凭证", href: "/resources", icon: Boxes },
    { label: "今日仓", note: "待调到厂、可用余料与在途未收", href: "/resources?view=today", icon: Archive },
    ...(!factoryOnly ? [{ label: "收料与退补", note: "收料、退料、补料与登记凭证", href: "/resources/material-ledger", icon: PackageCheck }] : []),
  ];
  return <div className="space-y-6">
    {!factoryOnly ? <HubSection title="资料库" note="保存规格、图片和往来资料。选用资料不代表已经买料或实物入库。" entries={records} /> : null}
    <HubSection title="实物库存与收发料" note="按实际批次和凭证记录。采购、到货、调拨、领用分别办理。" entries={stock} />
    {!factoryOnly ? <Link href="/resources/catalog" className="inline-flex items-center gap-2 text-sm text-[var(--brand-strong)]"><SlidersHorizontal size={16} />新增与维护资料 <ArrowUpRight size={14} /></Link> : null}
  </div>;
}

function HubSection({ title, note, entries }: { title: string; note: string; entries: Entry[] }) {
  return <section aria-label={title}>
    <h2 className="text-lg font-medium">{title}</h2>
    <p className="mb-4 mt-1 text-sm leading-6 text-[var(--ink-muted)]">{note}</p>
    <div className="grid gap-4 lg:grid-cols-3">
      {entries.map(({ label, note: detail, href, icon: Icon }) => <Card key={href} className="overflow-hidden">
        <Link href={href} className="group flex h-full items-start gap-3 p-5 hover:bg-[var(--nav-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--brand)]">
          <span className="rounded-xl bg-[var(--brand-soft)] p-2.5 text-[var(--brand-strong)]"><Icon size={21} strokeWidth={1.6} /></span>
          <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span><span className="mt-2 block text-xs leading-6 text-[var(--ink-muted)]">{detail}</span></span>
          <ArrowUpRight size={15} className="shrink-0 text-[var(--ink-muted)]" />
        </Link>
      </Card>)}
    </div>
  </section>;
}
