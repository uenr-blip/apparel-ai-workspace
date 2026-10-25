"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ReviewActions({
  proposalId,
  proposalStatus,
  role,
  actionType,
}: {
  proposalId: string | null;
  proposalStatus: string | null;
  role: string;
  actionType: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const canApprove = role === "salesperson" || role === "manager";
  const isDev = actionType === "create_development_project";

  if (!proposalId) {
    return <p className="mt-4 text-sm text-[var(--ink-muted)]">没有可批准的操作提案。</p>;
  }
  if (proposalStatus === "executed") {
    return (
      <p className="mt-4 text-sm text-[var(--ok)]">
        提案已执行。刷新后记录仍在，重复批准不会再新建{isDev ? "开发款式" : "订单"}。
      </p>
    );
  }
  if (proposalStatus === "rejected") {
    return <p className="mt-4 text-sm text-[var(--ink-muted)]">提案已拒绝，不能再批准。</p>;
  }
  if (proposalStatus === "expired") {
    return <p className="mt-4 text-sm text-[var(--warning)]">提案已过期。请重新解析资料后再预览。</p>;
  }

  async function approve() {
    if (!proposalId) return;
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/proposals/${proposalId}/approve`, { method: "POST" });
    const body = (await response.json()) as { error?: string; result?: { orderId?: string; projectId?: string } };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "批准失败");
      return;
    }
    if (body.result?.projectId) {
      router.push(`/projects/${body.result.projectId}`);
      router.refresh();
      return;
    }
    if (body.result?.orderId) {
      router.push(`/orders/${body.result.orderId}`);
      router.refresh();
    }
  }

  async function reject() {
    if (!proposalId) return;
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/proposals/${proposalId}/reject`, { method: "POST" });
    const body = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "拒绝失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={approve} disabled={!canApprove || pending}>
          {pending ? "执行中…" : isDev ? "批准创建开发款式" : "批准创建草稿"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void reject()} disabled={!canApprove || pending}>
          拒绝
        </Button>
      </div>
      {!canApprove ? <p className="text-xs text-[var(--danger)]">当前角色无权批准该动作</p> : null}
      <p className="text-xs text-[var(--ink-muted)]">
        {isDev
          ? "批准后创建开发款式并引用已有材料，不新建款号，不迁移历史批准。"
          : "批准后走服务端事务：订单草稿 + 新的资料草稿版本 + 内部任务。不会投产，也不会覆盖已批准历史版本。"}
      </p>
      {message ? <p className="text-sm text-[var(--danger)]">{message}</p> : null}
    </div>
  );
}
