import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";
import { agentStatus } from "@/lib/agent-config";
import { prisma } from "@/lib/db";
import { getLoginPolicy } from "@/lib/login-policy";
import { getUserProfile } from "@/server/services/profile";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { tradePermissions } from "@/server/services/trade-db";
import { canUserAction } from "@/server/services/user-permissions";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const profile = await getUserProfile(session.id, session.organizationId);
  const organization = await prisma.organization.findUnique({ where: { id: session.organizationId }, select: { name: true } });
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
  const [ledger, trade, recon] = await Promise.all([ledgerPermissions(actor), tradePermissions(actor), canUserAction(actor, "generate_factory_recon")]);
  const canOpenFinance = ledger.has("ledger_view") || trade.has("trade_view") || recon;
  return (
    <AppShell user={session} canOpenFinance={canOpenFinance} avatarSrc={profile.avatarSrc} pilotMode={getLoginPolicy().mode === "pilot"} organizationName={organization?.name} aiModeLabel={agentStatus().ready ? "客户资料整理 · 模型已配置" : "客户资料整理 · 可手动核对"}>
      {children}
    </AppShell>
  );
}
