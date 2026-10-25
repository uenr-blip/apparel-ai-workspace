"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DecisionActions({
  proposalId,
  status,
  canDecide,
}: {
  proposalId: string;
  status: string;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (status === "executed") {
    return <p className="text-sm text-[var(--ok)]">提案已执行。重复批准不会再写一套业务记录。</p>;
  }
  if (status === "rejected") {
    return <p className="text-sm text-[var(--ink-muted)]">提案已拒绝，不能再批准。</p>;
  }
  if (status === "expired") {
    return <p className="text-sm text-[var(--warning)]">提案已过期。回到收件箱重新预览后再批。</p>;
  }

  async function post(path: string) {
    setPending(true);
    setMessage("");
    const response = await fetch(path, { method: "POST" });
    const body = (await response.json()) as { error?: string; result?: { orderId?: string; projectId?: string } };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "处理失败");
      return;
    }
    if (body.result?.orderId) {
      router.push(`/orders/${body.result.orderId}#chain-proposals`);
      router.refresh();
      return;
    }
    if (body.result?.projectId) {
      router.push(`/projects/${body.result.projectId}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!canDecide || pending} onClick={() => void post(`/api/proposals/${proposalId}/approve`)}>
          {pending ? "处理中…" : "批准"}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!canDecide || pending} onClick={() => void post(`/api/proposals/${proposalId}/reject`)}>
          拒绝
        </Button>
      </div>
      {!canDecide ? <p className="text-xs text-[var(--danger)]">当前角色无权批准或拒绝</p> : null}
      {message ? <p className="text-sm text-[var(--danger)]">{message}</p> : null}
    </div>
  );
}
