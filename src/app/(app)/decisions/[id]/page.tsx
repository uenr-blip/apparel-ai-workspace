import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canApproveAction } from "@/server/permissions";
import { DecisionCenterError, getDecisionRecord } from "@/server/services/decision-center";
import { DecisionActions } from "../decision-actions";

export default async function DecisionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let record;
  try {
    record = await getDecisionRecord(session.organizationId, id);
  } catch (error) {
    if (error instanceof DecisionCenterError) notFound();
    throw error;
  }

  if (record.reviewInInbox) redirect(record.links.inbox);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="可审核提案"
        title={record.actionLabel}
        description={
          <>
            {record.statusLabel} · {record.idempotencyKey} ·{" "}
            <Link href="/decisions" className="text-[var(--brand-strong)]">
              返回待确认与处理记录
            </Link>
          </>
        }
      />
      {record.staleReason ? <p className="text-sm text-[var(--warning)]">{record.staleReason}</p> : null}
      <Card className="p-5">
        <DecisionActions
          proposalId={record.id}
          status={record.status}
          canDecide={canApproveAction(session.role, record.actionType)}
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 text-sm">
          <h3 className="font-medium">依据</h3>
          <p className="mt-2 text-[var(--ink-muted)]">{record.sourcePreview}…</p>
          <ul className="mt-3 space-y-1">
            {record.evidenceLines.length === 0 ? <li className="text-[var(--ink-muted)]">没有可定位证据字段</li> : null}
            {record.evidenceLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href={record.links.inbox} className="text-[var(--brand-strong)]">
              打开资料原文
            </Link>
            {record.links.style ? (
              <Link href={record.links.style} className="text-[var(--brand-strong)]">
                打开款式
              </Link>
            ) : null}
            {record.links.order ? (
              <Link href={record.links.order} className="text-[var(--brand-strong)]">
                打开订单
              </Link>
            ) : null}
            {record.links.project ? (
              <Link href={record.links.project} className="text-[var(--brand-strong)]">
                打开开发款式
              </Link>
            ) : null}
          </div>
        </Card>
        <Card className="p-5 text-sm">
          <h3 className="font-medium">将做什么 / 不做什么</h3>
          <p className="mt-2">将创建：{record.willCreate.join("、") || "无"}</p>
          <p className="mt-1">不会修改：{record.willNotChange.join("、") || "无"}</p>
          <ul className="mt-3 space-y-2">
            {record.risks.length === 0 ? <li className="text-[var(--ink-muted)]">没有差异风险</li> : null}
            {record.risks.map((row) => (
              <li key={row.field}>
                {row.field}
                {row.incoming ? ` → ${row.incoming}` : ""}
                {row.impact ? <span className="block text-xs text-[var(--warning)]">{row.impact}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 text-sm lg:col-span-2">
          <h3 className="font-medium">执行与审计</h3>
          <p className="mt-2">{record.executionStatus ? `执行 ${record.executionStatus}` : "尚未执行"}</p>
          <ul className="mt-3 space-y-1">
            {record.audits.length === 0 ? <li className="text-[var(--ink-muted)]">还没有审计记录</li> : null}
            {record.audits.map((row) => (
              <li key={row.id}>
                <Badge className="mr-2">{row.createdAt.slice(0, 10)}</Badge>
                {row.summary}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
