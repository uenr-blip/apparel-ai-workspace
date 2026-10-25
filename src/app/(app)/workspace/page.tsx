import { BusinessAgentEntry } from "@/components/business-agent-entry";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getWorkspaceSnapshot } from "@/server/services/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { SheetHead } from "@/components/ui/sheet";
import { WorkspaceMore } from "./workspace-more";
import { workspaceGreeting } from "@/lib/workspace-greeting";
import { BusinessAreas } from "./business-areas";
import { stageUpdates } from "@/server/services/workflow-stage";
import { listStyleSummaries } from "@/server/services/style-thread";
import { WorkspaceStyles } from "./workspace-styles";

export default async function WorkspacePage() {
  const session = await requireSession();
  const data = await getWorkspaceSnapshot(session.organizationId, {
    organizationId: session.organizationId,
    userId: session.id,
    role: session.role,
    factoryId: session.factoryId,
  });
  const decisions = data.decisions.slice(0, 5);
  const gaps = data.blockGroups.slice(0, 6);
  const greeting = workspaceGreeting(session.name);
  const [updates, styles] = await Promise.all([
    stageUpdates({ organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId }),
    listStyleSummaries(session.organizationId, { role: session.role, factoryId: session.factoryId }),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 pt-6 md:gap-8 md:pt-10">
      <PageHeader
        inline
        title={`${greeting.hello}，${session.name}。`}
        description={greeting.note}
        actions={
          <>
            {session.role === "manager" || session.role === "salesperson" ? <BusinessAgentEntry module="workspace" /> : null}
            {session.role === "factory" && <Link href="/styles?tab=projects" className="desk-jump text-sm">本厂打样要求</Link>}
          </>
        }
      />

      <BusinessAreas financeHref={data.finance?.href ?? null} />
      {updates.length ? <Card className="p-5"><h3 className="font-medium"><span className="mr-2 text-[var(--danger)]">●</span>交接与资料更新</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">与你参与的业务有关；打开记录核对后，可标记本人已阅。</p><ul className="mt-3 space-y-2 text-sm">{updates.map(u => <li key={u.id}><Link className="underline" href={u.href}>{u.kind} · {u.summary}</Link></li>)}</ul>{updates.length === 20 ? <p className="text-xs">显示最近 20 条未阅变更，其他历史在各阶段记录中查看。</p> : null}</Card> : null}

      <Card className="flex min-h-0 flex-col sheet-pad">
        <div className="grid min-h-0 gap-6 lg:grid-cols-2">
          <section>
            <SheetHead title="待确认与批准" hint="先核对依据，再由有权限的负责人处理。" action={<div className="flex gap-3 text-xs text-[var(--brand-strong)]"><Link href="/decisions?status=preview">查看全部</Link><Link href="/decisions">处理记录</Link></div>} />
            <ul className="desk-feed text-sm leading-6">
              {decisions.length === 0 ? <li className="text-[var(--ink-muted)]">暂无待批准提案</li> : null}
              {decisions.map((item) => (
                <li key={item.id}>
                  <Link className="desk-feed-link" href={item.href}>
                    <span className="desk-feed-title">{item.title}</span>
                    <span className="desk-feed-note">{item.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <SheetHead title="待补资料与阻塞" hint="点订单回到原记录，补齐后继续办理。" />
            <ul className="desk-feed text-sm leading-6">
              {gaps.length === 0 ? <li className="text-[var(--ink-muted)]">没有缺项</li> : null}
              {gaps.map((group) => (
                <li key={group.key}>
                  <Link href={group.href} className="desk-feed-link">
                    <span className="desk-feed-title">{group.orderNo ?? "未挂单"}</span>
                    <span className="desk-feed-note">
                      {group.links.slice(0, 2).map((link) => link.title).join(" · ")}
                      {group.repeatCount > group.links.length ? ` · 共 ${group.repeatCount} 份` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <WorkspaceMore reuse={data.reuse} processed={data.processed} audits={data.audits} />
      </Card>
      <WorkspaceStyles styles={styles} canEdit={session.role === "manager" || session.role === "salesperson"} />
    </div>
  );
}
