import Link from "next/link";
import { notFound } from "next/navigation";
import { agentStatus } from "@/lib/agent-config";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InboxForm } from "@/app/(app)/inbox/inbox-form";
import { CatalogCompose } from "@/components/catalog-compose";
import { CatalogSearch } from "@/components/catalog-search";
import { catalogQuery, matchesCatalogQuery } from "@/lib/catalog-query";
import { labels } from "@/lib/labels";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  if (!["salesperson", "manager"].includes(session.role)) notFound();
  const q = catalogQuery((await searchParams).q);
  const sources = await prisma.sourceDocument.findMany({
    where: { organizationId: session.organizationId, origin: { startsWith: "inbox-" } },
    orderBy: { createdAt: "desc" },
    include: { proposals: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const matched = sources.filter((source) =>
    matchesCatalogQuery(q, [
      labels.origin(source.origin),
      source.origin,
      source.filename,
      source.rawText,
      labels.parseStatus(source.parseStatus),
      source.proposals[0] ? labels.proposalStatus(source.proposals[0].status) : "",
    ]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="资料进入"
        title="客户来单"
        description="接收客户 PO → 整理成表 → 人工核对 → 确认建跟单。先处理一份 PO，同客户同工厂；销售样和客户改单暂走原业务流程。"
        actions={
          <CatalogCompose
            label="录入资料"
            title="粘贴或上传资料"
            note="列表只查阅。粘贴、上传在此完成，不必滚过整页记录。"
          >
            <InboxForm modelReady={agentStatus().ready} />
          </CatalogCompose>
        }
      />
      <CatalogSearch action="/inbox" q={q} placeholder="原文、来源、文件名、解析状态" />
      <p className="text-xs text-[var(--ink-muted)]">
        {q ? `匹配 ${matched.length} / ${sources.length} 条` : `共 ${sources.length} 条`}
      </p>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--paper)] text-left text-[var(--ink-muted)]">
            <tr>
              <th className="px-4 py-3">来源</th>
              <th>状态</th>
              <th>处理进展</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-[var(--ink-muted)]" colSpan={4}>
                  还没有资料。点右上角「录入资料」开始。
                </td>
              </tr>
            ) : null}
            {sources.length > 0 && matched.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-[var(--ink-muted)]" colSpan={4}>
                  没有匹配「{q}」的资料
                </td>
              </tr>
            ) : null}
            {matched.map((source) => (
              <tr key={source.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{labels.origin(source.origin)}</div>
                  <div className="max-w-xl truncate text-[var(--ink-muted)]">{source.rawText.replace(/\s+/g, " ")}</div>
                </td>
                <td>
                  <Badge tone={source.parseStatus === "succeeded" ? "ok" : source.parseStatus === "failed" ? "danger" : "warning"}>
                    {(source.proposals[0]?.actionType === "create_follow_sheet" && source.proposals[0]?.status === "executed") ? "已转跟单" : source.parseStatus === "needs_review" ? "待核对" : labels.parseStatus(source.parseStatus)}
                  </Badge>
                </td>
                <td>{source.proposals[0] ? labels.proposalStatus(source.proposals[0].status) : "—"}</td>
                <td className="px-4">
                  <Link href={`/inbox/${source.id}`} className="text-[var(--brand-strong)]">
                    打开处理
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
