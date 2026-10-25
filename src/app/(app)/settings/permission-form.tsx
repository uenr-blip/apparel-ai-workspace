"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { listPermissionAssignments } from "@/server/services/user-permissions";
import { labels } from "@/lib/labels";

export function PermissionForm({ users }: { users: Awaited<ReturnType<typeof listPermissionAssignments>>["users"] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function change(targetUserId: string, action: string, enabled: boolean) {
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/settings/permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId, action, enabled }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "权限更新失败");
      setMessage(enabled ? "权限已下发，员工可以按授权办理。" : "权限已收回，后续提交会重新检查权限。");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "网络异常，请重新核对权限状态"); }
    finally { setPending(false); }
  }
  return <div className="space-y-4">
    {users.length === 0 ? <p className="text-sm text-[var(--ink-muted)]">没有匹配的员工。</p> : null}
    {users.map(user => <div key={user.id} className="rounded-xl border border-[var(--line)] p-4">
      <p className="font-medium">{user.name} <span className="text-xs text-[var(--ink-muted)]">{labels.role(user.role)} · {user.active ? "有效账号" : "已停用"}</span></p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">{user.actions.map(item => <label key={item.action} className="flex items-start gap-2 text-sm">
        <input type="checkbox" aria-label={`${user.name} ${item.label}`} checked={item.enabled} disabled={pending || (!item.canGrant && !item.enabled)} onChange={event => void change(user.id, item.action, event.target.checked)} className="mt-1" />
        <span>{item.label}<span className="mt-1 block text-xs text-[var(--ink-muted)]">{item.canGrant || item.enabled ? item.description : "此账号不适用，工厂范围保持隔离"}</span></span>
      </label>)}</div>
    </div>)}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </div>;
}
