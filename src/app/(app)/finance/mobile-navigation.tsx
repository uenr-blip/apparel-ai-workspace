"use client";
import { useRouter } from "next/navigation";
import type { FinanceLink } from "@/lib/finance-navigation";
export function MobileFinanceNavigation({ groups, section }: { groups: FinanceLink[]; section: string }) {
  const router = useRouter();
  return <label className="block space-y-1.5 text-xs text-[var(--ink-muted)] sm:hidden">切换财务工作区
    <select aria-label="切换财务工作区" value={groups.some(g => g.key === section) ? section : "home"} onChange={event => { const item = groups.find(g => g.key === event.target.value); if (item) router.push(item.href); }} className="block h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm font-medium text-[var(--ink)]">
      {groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
    </select>
  </label>;
}
