import { ContextManager } from "@/components/context-manager";
import { requireSession } from "@/lib/auth";
import { getAiConfig, liveConfigured } from "@/lib/ai-config";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PermissionForm } from "./permission-form";
import { listPermissionAssignments } from "@/server/services/user-permissions";
import { CatalogSearch } from "@/components/catalog-search";
import { BRAND } from "@/lib/brand";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const config = getAiConfig();
  const q = (await searchParams).q ?? "";
  const assignments = session.role === "manager" ? await listPermissionAssignments(session.organizationId, session.id, q) : null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={BRAND.name}
        title="设置"
        description={`${BRAND.disclaimer}。外观在顶栏切换「纸色 / 墨黑」；四角按钮铺满窗口。密钥不会显示在此页面。`}
      />
      {session.role === "manager" ? <ContextManager /> : null}
      {assignments ? <Card className="space-y-4 p-5">
        <h3 className="font-medium">权限下发</h3>
        <p className="text-sm text-[var(--ink-muted)]">按员工分配调拨、领用和工厂加工对账权限。可以收回，操作记录仍保留实际办理人。授权不包含付款，也不会取消工厂范围限制。</p>
        <CatalogSearch action="/settings" q={q} placeholder="员工姓名或邮箱" />
        <p className="text-xs text-[var(--ink-muted)]">显示 {assignments.users.length} / {assignments.total} 位员工，超过50位时请缩小检索范围。</p>
        <PermissionForm users={assignments.users} />
      </Card> : <Card className="p-5 text-sm">办理权限由经理在此下发；当前账号不能修改他人权限。</Card>}
      <Card className="space-y-2 p-5 text-sm">
        <p>当前用户：{session.name} / {session.role}</p>
        <p>AI 模式：{config.mode}</p>
        <p>AI 供应商：{config.provider || "未设置"}</p>
        <p>模型：{config.model || "未设置"}</p>
        <p>live 是否已配置密钥：{liveConfigured() ? "是（仍需实际调用才能声称已验证）" : "否"}</p>
        <p className="text-[var(--ink-muted)]">密钥不会显示在此页面。</p>
      </Card>
    </div>
  );
}
