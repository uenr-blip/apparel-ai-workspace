import { StageExpensePanel } from "@/components/stage-expense-panel";
import { getPatternHandoff } from "@/server/services/pattern-handoff";
import { PatternHandoffForm } from "../pattern-handoff-form";
import Image from "next/image";
import { designVariantSrc } from "@/server/services/design-studio";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LinkStyleForm } from "@/app/(app)/projects/link-style-form";
import { PatternWorkspace } from "@/app/(app)/projects/pattern-workspace";
import { getPatternBoard, authorizePattern } from "@/server/services/pattern-workflow";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import { labels } from "@/lib/labels";
import { styleImageSrc } from "@/lib/style-image";
import { getStageWorkspace } from "@/server/services/workflow-stage";
import { WorkflowStagePanel } from "@/components/workflow-stage-panel";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stageRevision?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { stageRevision } = await searchParams;
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
  await authorizePattern(actor, prisma, true);
  if (session.role === "factory") {
    const samples = await prisma.patternSample.findMany({ where: { projectId: id, factoryId: session.factoryId!, issuedAt: { not: null }, project: { organizationId: session.organizationId } }, include: { revision: { select: { number: true } }, project: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" } });
    if (!samples.length) notFound();
    return <div className="space-y-4"><PageHeader title={`${samples[0].project.code} · 本厂打样要求`} /><Card className="space-y-3 p-5">{samples.map(s=><p key={s.id}><Link className="underline" href={`/projects/${id}/samples/${s.id}`}>V{s.revision.number} · 第{s.round}次打样 · {s.quantity}件 · {s.receivedAt?"已确认收到":"待确认收到"}</Link></p>)}</Card></div>;
  }
  const project = await prisma.developmentProject.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      style: true,
      designProjects: { include: { rounds: { include: { variants: { where: { selected: true } } }, orderBy: { versionNumber: "desc" } } } },
      source: true,
      candidates: { include: { material: true, style: true } },
      reuseEvents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) notFound();
  const styles = await prisma.style.findMany({
    where: { organizationId: session.organizationId },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const unknowns = JSON.parse(project.unknownsJson) as string[];
  const board = await getPatternBoard(actor,id);
  const handoff = await getPatternHandoff(actor,id);
  const stage = await getStageWorkspace(actor, { projectId: id });
  const assignees = await prisma.user.findMany({ where: { organizationId: session.organizationId, active: true, role: { in: ["salesperson", "manager"] } }, select: { id: true, name: true } });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="开发打版 · 可先于款号存在"
        title={`${project.code} ${project.name}`}
        actions={
          <>
            <BusinessAgentEntry module="product" initialText={`核对 ${project.code} 的版单和工厂打样情况`} />
            <Badge tone={project.styleId ? "ok" : "warning"}>{labels.projectStatus(project.status)}</Badge>
            <Badge>{project.style?.code ?? "尚未关联款号"}</Badge>
            {project.styleId ? (
              <Link href={`/styles/${project.styleId}`} className="text-sm text-[var(--brand-strong)]">
                打开款式一条链
              </Link>
            ) : null}
          </>
        }
      />
      {project.designProjects.map(design => <Card key={design.id} className="p-5"><h3 className="font-medium">已采用的设计参考 · {design.code}</h3><p className="mt-2 text-sm text-[var(--ink-muted)]">外观方案已选定，版型、色尺和工艺仍须核对。采用不等于资料批准。</p><div className="mt-3 flex flex-wrap gap-3">{design.rounds.flatMap(r => r.variants.map(v => <figure key={v.id}><Image src={designVariantSrc(v.id,v.imagePath)} alt={`已采用第${r.versionNumber}轮 ${v.label}`} width={280} height={280} unoptimized /><figcaption className="text-sm">第 {r.versionNumber} 轮 · {v.label}</figcaption></figure>))}</div><Link href={`/styles/design/${design.id}`} className="mt-3 block text-sm text-[var(--brand-strong)]">查看设计要求、原图和修改历史</Link></Card>)}
      <Card className="p-5">
        <h3 className="font-medium">版单</h3>
        {project.style?.imagePath && !board.content.sweater.imagePath && !board.content.fabric.imagePath && <figure className="mt-3">
          <Image src={styleImageSrc(project.style)} alt={`${project.style.code} ${project.style.name} · 关联款式参考图`} width={240} height={240} unoptimized className="h-auto max-h-60 w-auto max-w-full object-contain" />
          <figcaption className="mt-2 text-xs text-[var(--ink-muted)]">关联款式：{project.style.code} {project.style.name}。此图供参考；发厂版需要的图片请附到本款版单。</figcaption>
        </figure>}
        <div className="mt-3">
          <PatternWorkspace initial={board} currentUserId={session.id} assignees={assignees}/>
        </div>
      </Card>
      <WorkflowStagePanel key={`${stage.stageId ?? JSON.stringify(stage.target)}:${stageRevision ?? ""}`} board={stage} initialRevisionId={stageRevision} />
      <StageExpensePanel actor={actor} target={{ projectId: id }} />
      <details><summary className="cursor-pointer text-sm">将工厂回样整理为正式款式资料</summary><PatternHandoffForm board={handoff} userId={session.id} /></details>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-medium">候选引用</h3>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">已选资料保留来源；本款仍需核对适用部分。</p>
          <ul className="mt-3 space-y-3 text-sm">
            {project.candidates.map((row) => (
              <li key={row.id} className="rounded-lg border border-[var(--line)] p-3">
                <div>
                  {row.kind === "material" ? (
                    <Link href={`/resources/materials/${row.materialId}`}>{row.material?.code} {row.material?.name}</Link>
                  ) : (
                    <Link href={`/styles/${row.styleId}`}>{row.style?.code} {row.style?.name}</Link>
                  )}
                </div>
                <p className="text-[var(--ink-muted)]">{row.note}</p>
                <p className="text-xs text-[var(--warning)]">待确认：{(JSON.parse(row.unconfirmedJson) as string[]).join("、")}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-medium">未知与后续关联</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {unknowns.map((item) => (
              <Badge key={item} tone="warning">
                {item}
              </Badge>
            ))}
          </div>
          {project.source ? (
            <p className="mt-3 text-sm">
              来源：<Link href={`/inbox/${project.source.id}`}>查看原始资料</Link>
            </p>
          ) : null}
          <LinkStyleForm projectId={project.id} styles={styles} disabled={Boolean(project.styleId)} />
        </Card>
      </div>
    </div>
  );
}
