import { AttachmentThumbnail } from "@/components/attachment-thumbnail";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { intakeWarnings } from "@/lib/customer-intake";
import { agentStatus } from "@/lib/agent-config";
import { getCustomerIntake, intakeCatalog } from "@/server/services/customer-intake";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import LegacyReview from "./legacy-review";
import { IntakeReviewForm } from "./intake-review-form";
export default async function ReviewPage({ params }: { params: Promise<{ sourceId: string }> }) {
  const session = await requireSession(); const { sourceId } = await params;
  if (!["salesperson", "manager"].includes(session.role)) notFound();
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
  // Already executed historical records keep their original result and approval trail.
  const legacy = await prisma.actionProposal.findFirst({ where: { organizationId: session.organizationId, sourceDocumentId: sourceId, actionType: { in: ["create_order_draft", "create_development_project"] }, status: "executed" } });
  if (legacy) return <LegacyReview params={params} />;
  let review; try { review = await getCustomerIntake(actor, sourceId); } catch { notFound(); }
  const [catalog, audits] = await Promise.all([intakeCatalog(actor), prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, entityId: sourceId }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 })]);
  return <div className="space-y-4">
    <PageHeader eyebrow="客户资料进入" title="客户 PO · 跟单核对" description="先整理一份大货 PO，核对客户、产品和颜色数量，再确认进入跟单。" actions={<Link href="/inbox" className="text-sm text-[var(--brand-strong)]">返回收件箱</Link>} />
    <ol aria-label="处理步骤" className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">{["1 已保存原件", "2 整理并修改表格", "3 核对后确认", "4 进入跟单"].map((text, i) => <li key={text} className={`rounded-lg border p-3 ${review.executed || i === 0 ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)]"}`}>{text}</li>)}</ol>
    {review.result ? <Card className="p-5 space-y-3"><h2 className="text-lg">已建成跟单，接下来在跟单里继续补资料</h2><p className="text-sm">原件、人工核对和建单记录已关联。再次提交同一资料会返回这张跟单；生产订单仍需单独开。</p><p className="text-sm">建单时待补：{intakeWarnings(review.draft).join("；") || "表头和颜色数量已核对"}。后续修改以跟单当前记录为准。</p><div className="flex gap-4"><Link className="text-[var(--brand-strong)] underline" href={`/orders/follow/${review.result.sheetId}`}>打开这张跟单</Link><Link className="text-[var(--brand-strong)] underline" href="/orders?sheet=bulk">查看大货总表</Link></div></Card> : <IntakeReviewForm key={`${review.jobId}:${review.proposalId}`} sourceId={sourceId} duplicates={review.duplicates} initial={review.draft} jobId={review.jobId} proposalId={review.proposalId} revision={review.revision} catalog={catalog} modelReady={agentStatus().ready} error={review.error} warnings={review.warnings} calledLiveModel={review.calledLiveModel} />}
    <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] p-4"><summary className="cursor-pointer font-medium">查看客户原件与整理依据</summary>
      {review.source.storagePath ? <AttachmentThumbnail href={`/api/inbox/${sourceId}/file`} name={review.source.filename || "客户原件"} mime={review.source.mimeType} /> : null}
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{review.source.rawText}</pre>
      {review.evidence.length ? <ul className="mt-3 space-y-2 text-xs text-[var(--ink-muted)]">{review.evidence.map((e: {field: string; quote: string}, i: number) => <li key={i}>{e.field}：{e.quote}</li>)}</ul> : null}
    </details>
    <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] p-4"><summary className="cursor-pointer font-medium">处理记录 · 当前操作人 {session.name}</summary><ul className="mt-3 space-y-2 text-sm">{audits.map(a => <li key={a.id}>{a.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {a.actor?.name ?? "系统"} · {a.summary}</li>)}</ul><p className="mt-3 text-xs text-[var(--ink-muted)]">确认结果回到当前经办人的页面；尚未向客户、工厂或其他员工发送消息。</p></details>
  </div>;
}
