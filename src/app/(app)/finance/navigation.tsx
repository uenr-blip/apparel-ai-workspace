import Link from "next/link";
import { FINANCE_GUIDES, financeNavigation } from "@/lib/finance-navigation";
import { MobileFinanceNavigation } from "./mobile-navigation";
export function FinanceNavigation({ navigation }: { navigation: ReturnType<typeof financeNavigation> }) {
  const nav = navigation;
  return <div className="min-w-0 space-y-3"><MobileFinanceNavigation groups={nav.groups} section={nav.section} /><nav aria-label="财务工作区域" className="hidden max-w-full gap-1 overflow-x-auto border-b border-[var(--line)] pb-px sm:flex">{nav.groups.map(item => <Link key={item.key} href={item.href} aria-current={nav.section === item.key ? "page" : undefined} className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm sm:px-4 ${nav.section === item.key ? "border-[var(--brand)] font-semibold text-[var(--brand-strong)]" : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}>{item.label}</Link>)}</nav>
    {!nav.denied && nav.secondary.length ? <nav aria-label="当前工作区功能" className="flex max-w-full gap-2 overflow-x-auto">{nav.secondary.map(item => <Link key={item.key} href={item.href} aria-current={nav.subKey === item.key ? "page" : undefined} className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm ${nav.subKey === item.key ? "bg-[var(--brand-soft)] font-medium text-[var(--brand-strong)]" : "text-[var(--ink-muted)] hover:bg-[var(--paper)]"}`}>{item.label}</Link>)}</nav> : null}
  </div>;
}
export function FinanceGuide({ navigation }: { navigation: ReturnType<typeof financeNavigation> }) {
  const guide = FINANCE_GUIDES[navigation.subKey];
  if (!guide) return null;
  return <section aria-label="当前操作指引" className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-4 sm:px-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{guide.title}</h2><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{guide.description}</p></div>{navigation.section === "business" && ["reconciliation", "vouchers", "documents"].includes(navigation.tab) ? <Link href={navigation.tab === "documents" ? "/finance?tab=receivables&view=bills" : "/finance?section=business"} className="text-xs text-[var(--brand-strong)]">返回款项核对 →</Link> : null}</div>
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--ink-muted)]">{guide.steps.map((step, i) => <li key={step} className="flex items-center gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-strong)]">{i + 1}</span>{step}</li>)}</ol>
    {navigation.related.length ? <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--line)] pt-3 text-xs"><span className="text-[var(--ink-muted)]">需要核对依据时</span>{navigation.related.map(item => <Link key={item.key} href={item.href} className="text-[var(--brand-strong)]">{item.label} →</Link>)}</div> : null}
  </section>;
}
