import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogSearch } from "@/components/catalog-search";
import { catalogQuery } from "@/lib/catalog-query";
import { listDecisions } from "@/server/services/decision-center";

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "preview", label: "待批准" },
  { id: "executed", label: "已执行" },
  { id: "rejected", label: "已拒绝" },
  { id: "expired", label: "已过期" },
] as const;

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const q = catalogQuery(params.q);
  const status = FILTERS.find((item) => item.id === params.status)?.id ?? "all";
  const rows = await listDecisions(session.organizationId, { q, status });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="可审核提案"
        title="待确认与处理记录"
        description="核对依据后批准或拒绝。方案比较仍在订单页。过期必须重新预览，不能按旧批准执行。"
        actions={<Link href="/workspace" className="text-sm text-[var(--brand-strong)]">返回工作台</Link>}
      />
      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((item) => {
          const href = item.id === "all" ? `/decisions${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/decisions?status=${item.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
          return (
            <Link
              key={item.id}
              href={href}
              scroll={false}
              className={item.id === status ? "rounded-full bg-[var(--brand-soft)] px-3 py-1 font-medium text-[var(--brand-strong)]" : "rounded-full border border-[var(--line)] px-3 py-1"}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <CatalogSearch
        action="/decisions"
        q={q}
        extras={status === "all" ? {} : { status }}
        placeholder="动作、来源摘要、状态"
      />
      <p className="text-xs text-[var(--ink-muted)]">{q ? `匹配 ${rows.length} 条` : `共 ${rows.length} 条`}</p>
      <div className="space-y-3">
        {rows.length === 0 ? <p className="text-sm text-[var(--ink-muted)]">{q ? `没有匹配「${q}」的提案` : "还没有提案"}</p> : null}
        {rows.map((item) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Link href={item.href} className="font-medium text-[var(--brand-strong)]">
                  {item.actionLabel}
                </Link>
                <div className="text-sm leading-6">{item.detail}</div>
                <div className="text-sm text-[var(--ink-muted)]">
                  {item.when} · 来源 {item.sourceMark}
                </div>
                {item.excerpt ? <div className="text-sm leading-6 text-[var(--ink-muted)]">{item.excerpt}</div> : null}
              </div>
              <Badge tone={item.status === "executed" ? "ok" : item.status === "expired" ? "warning" : "neutral"}>{item.statusLabel}</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
