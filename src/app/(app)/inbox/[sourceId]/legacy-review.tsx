import { AttachmentThumbnail } from "@/components/attachment-thumbnail";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getReview } from "@/server/services/intake";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ReviewActions } from "@/app/(app)/inbox/[sourceId]/review-actions";
import { ChooseStyleForm } from "@/app/(app)/inbox/[sourceId]/choose-style-form";
import { SourcePreview } from "@/app/(app)/inbox/source-preview";
import type { Extraction } from "@/server/ai/schema";
import { labels } from "@/lib/labels";

export default async function ReviewPage({ params }: { params: Promise<{ sourceId: string }> }) {
  const session = await requireSession();
  const { sourceId } = await params;
  let review;
  try {
    review = await getReview(session.organizationId, sourceId);
  } catch {
    notFound();
  }
  const extraction = review.parsed?.extraction as Extraction | undefined;
  const diffs = (review.parsed?.diffs ?? []) as Array<{ field: string; previous: string; incoming: string; impact: string }>;
  const payload = review.proposal ? JSON.parse(review.proposal.payloadJson) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="资料进入"
        title="资料审核"
        description="先处理任务：选历史资料、标颜色变化、尺码未齐。不是长回答。"
        actions={<Badge tone="ai">{review.job?.mode === "live" ? "真实模型调用" : "演示模式，未调用真实模型"}</Badge>}
      />
      {review.tasks.length ? (
        <Card className="p-4">
          <h3 className="text-sm font-medium">可处理任务</h3>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">资料匹配不等于批准。翻单先进入草稿。</p>
          <ul className="mt-3 space-y-2">
            {review.tasks.map((task) => (
              <li key={task.id} className="flex gap-2 text-sm">
                <Badge tone={task.status === "done" ? "ok" : "warning"}>{task.status === "done" ? "已处理" : "待处理"}</Badge>
                {task.href ? (
                  <Link href={task.href} className="text-[var(--brand-strong)]">
                    {task.title}
                  </Link>
                ) : (
                  <span>{task.title}</span>
                )}
              </li>
            ))}
          </ul>
          {review.parsed?.candidates?.length > 1 && !review.proposal ? (
            <ChooseStyleForm
              sourceId={sourceId}
              role={session.role}
              candidates={review.parsed.candidates}
            />
          ) : null}
        </Card>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr_0.9fr]">
        <Card className="p-4">
          <h3 className="text-sm font-medium">原始资料</h3>
          {review.fileHref ? <AttachmentThumbnail href={review.fileHref} name={review.source.filename || "客户原件"} mime={review.source.mimeType} /> : null}
          {review.source.rawText.includes("不是视觉识款") ? (
            <p className="mt-2 text-xs text-[var(--warning)]">内置 fixture 演示，不是视觉识款，也不是按图搜款。</p>
          ) : null}
          <SourcePreview text={review.source.rawText} fragments={review.source.fragments} />
          <p className="mt-2 text-xs text-[var(--ink-muted)]">{labels.origin(review.source.origin)}</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-medium">提取字段与差异</h3>
          {review.parsed?.recognized === false ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              未进行语义识别，未提取 BOM。请改用粘贴邮件或文本进单。图片不能替代颜色、手感、版型终审。
            </p>
          ) : review.source.origin === "oral-order" ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">这是口头建单记录，不是邮件解析。请打开对应订单补色尺，不能直接投产。</p>
          ) : extraction ? (
            <dl className="mt-3 space-y-3 text-sm">
              <Field label="意图" field={{ value: labels.intent(extraction.intent), kind: "extracted", inferenceNote: null, sourceText: null }} />
              <Field label="客户" field={extraction.customerName} />
              <Field label="款号" field={extraction.styleCode} emptyText="尚未确定，允许材料先行" />
              <Field label="客户PO" field={extraction.externalCustomerPo} emptyText="空（原文未提供，不沿用历史 PO）" />
              <Field label="总量" field={extraction.totalQuantity} />
              <Field label="交期原文" field={extraction.deliveryText} />
              <Field label="交期推断" field={extraction.deliveryDateInferred} />
              {(extraction.materials ?? []).length ? (
                <div>
                  <dt className="text-[var(--ink-muted)]">候选材料</dt>
                  <dd>{extraction.materials.map((row) => row.code).join("、")}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-[var(--ink-muted)]">颜色数量</dt>
                <dd>
                  {extraction.colors.map((color) => (
                    <div key={color.colorName}>
                      {color.colorName} {color.quantity} 件
                    </div>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-muted)]">未知项</dt>
                <dd className="flex flex-wrap gap-1">
                  {extraction.unknowns.map((item) => (
                    <Badge key={item} tone="warning">
                      {item}
                    </Badge>
                  ))}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[var(--danger)]">{review.job?.errorMessage || "尚无提取结果"}</p>
          )}
          <div className="mt-4 space-y-2">
            {diffs.map((diff) => (
              <div key={diff.field} className="rounded-lg border border-[var(--line)] p-3 text-sm">
                <div className="font-medium">{diff.field}</div>
                <div className="text-[var(--ink-muted)]">原：{diff.previous}</div>
                <div>现：{diff.incoming}</div>
                <div className="mt-1 text-xs text-[var(--warning)]">{diff.impact}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-medium">关联与提案</h3>
          {review.style ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-[var(--line)]">
              <Image src={review.style.imagePath} alt={`${review.style.name} 示意`} width={480} height={220} unoptimized className="h-36 w-full object-cover" />
              <div className="p-3 text-sm">
                <div className="font-medium">
                  {review.style.code} {review.style.name}
                </div>
                <p className="text-[var(--ink-muted)]">关联依据：款号一致，复用主档，不新建重复款。</p>
                <p className="mt-1 text-xs">已批准版本：{review.style.versions.find((row) => row.status === "approved")?.cuffType ?? "无"}</p>
              </div>
            </div>
          ) : review.parsed?.recognized === false ? (
            <p className="mt-3 text-sm">未识款，没有操作提案。不能从图批准建单或写入 BOM。</p>
          ) : review.parsed?.recognized === false ? (
            <p className="mt-3 text-sm">未识款，没有操作提案。不能从图批准建单或写入 BOM。</p>
          ) : payload?.actionType === "create_development_project" ? (
            <p className="mt-3 text-sm">材料开发可先于款号。批准后创建开发款式并引用已有纱线，不复制材料主档，也不沿用历史批准。</p>
          ) : review.parsed?.candidates?.length > 1 ? (
            <p className="mt-3 text-sm">已找到多份历史资料。先在上方选定，才会生成订单草稿提案。</p>
          ) : (
            <p className="mt-3 text-sm">没有唯一款式候选，不能自动建单。</p>
          )}
          {payload ? (
            <div className="mt-4 space-y-2 text-sm">
              <p>将创建：{payload.willCreate?.join("、")}</p>
              <p>不会修改：{payload.willNotChange?.join("、")}</p>
              {payload.productionReadiness ? <p>投产状态：{payload.productionReadiness}</p> : null}
            </div>
          ) : null}
          <ReviewActions
            proposalId={review.proposal?.id ?? null}
            proposalStatus={review.proposal?.status ?? null}
            role={session.role}
            actionType={review.proposal?.actionType ?? null}
          />
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  field,
  emptyText,
}: {
  label: string;
  field: {
    value: string | number | null;
    kind: string;
    inferenceNote: string | null;
    sourceText: string | null;
    start?: number | null;
  };
  emptyText?: string;
}) {
  return (
    <div>
      <dt className="text-[var(--ink-muted)]">{label}</dt>
      <dd>
        <span>{field.value ?? emptyText ?? "空"}</span>
        <Badge className="ml-2" tone={field.kind === "inferred" ? "warning" : field.kind === "extracted" ? "brand" : "neutral"}>
          {labels.fieldKind(field.kind)}
        </Badge>
        {field.start != null ? (
          <a href={`#loc-${field.start}`} className="ml-2 text-xs text-[var(--brand-strong)]">
            定位到原文
          </a>
        ) : null}
        {field.inferenceNote ? <p className="text-xs text-[var(--warning)]">{field.inferenceNote}</p> : null}
        {field.sourceText ? <p className="text-xs text-[var(--ink-muted)]">依据：{field.sourceText}</p> : null}
      </dd>
    </div>
  );
}
