"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, X } from "lucide-react";
import { matchesCatalogQuery, buildCatalogHref } from "@/lib/catalog-query";
import type { listStyleSummaries } from "@/server/services/style-thread";
import { StyleCards } from "../styles/style-cards";

export function WorkspaceStyles({ styles, canEdit }: { styles: Awaited<ReturnType<typeof listStyleSummaries>>; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const matches = styles.filter(style => matchesCatalogQuery(query, [
    style.code, style.name, style.brandName, style.categoryLabel, style.typeName,
    ...style.seasonCodes, ...style.factoryNames, ...style.orderPos.map(row => row.po), ...style.followPos.map(row => row.po),
  ]));
  const tags = [...new Set(styles.flatMap(style => [style.typeName, ...style.seasonCodes]).filter((tag): tag is string => Boolean(tag)))].slice(0, 6);
  return <section id="workspace-styles" aria-labelledby="workspace-styles-title" className="space-y-4 pb-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 id="workspace-styles-title" className="text-lg font-semibold">款式档案</h3><p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">点图片放大，点款号或品名查看详情与面辅料。</p></div>
      <Link href={buildCatalogHref("/styles", { layout: "cards" }, query)} prefetch={false} className="inline-flex items-center gap-1 text-sm text-[var(--brand-strong)]">查看全部 <ArrowUpRight size={15} aria-hidden="true" /></Link>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 sm:max-w-sm">
        <Search size={16} aria-hidden="true" className="shrink-0 text-[var(--ink-muted)]" />
        <input value={query} onChange={event => setQuery(event.target.value)} aria-label="在工作台查找款式档案" placeholder="款号、品名、季节或 PO" maxLength={100} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" />
        {query ? <button type="button" aria-label="清除款式检索" onClick={() => setQuery("")} className="p-1"><X size={16} /></button> : null}
      </div>
      {tags.length ? <div role="group" aria-label="款式快捷标签" className="flex flex-wrap gap-2">{tags.map(tag => <button key={tag} type="button" aria-pressed={query === tag} onClick={() => setQuery(query === tag ? "" : tag)} className={`rounded-full border px-3 py-1.5 text-xs ${query === tag ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line)] bg-[var(--surface-solid)] text-[var(--ink-muted)]"}`}>{tag}</button>)}</div> : null}
    </div>
    <p role="status" className="text-xs text-[var(--ink-muted)]">{query ? `找到 ${matches.length} 款` : `共 ${styles.length} 款`}{matches.length > 6 ? " · 当前展示前 6 款，更多款式点查看全部" : ""}</p>
    {matches.length ? <StyleCards styles={matches.slice(0, 6)} canEdit={canEdit} previewPhotos /> : <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-muted)]">{query ? "没有匹配款式，换个关键词试试。" : "还没有可查看的款式档案，建档后会显示在这里。"}</p>}
  </section>;
}
