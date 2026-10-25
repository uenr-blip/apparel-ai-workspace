"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SpecApproveForm({
  orderId,
  expectedUpdatedAt,
  canApprove,
  hasDraft,
  hasSpec,
  alreadyApproved,
}: {
  orderId: string;
  expectedUpdatedAt: string;
  canApprove: boolean;
  hasDraft: boolean;
  hasSpec: boolean;
  alreadyApproved: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (alreadyApproved && !hasDraft) {
    return (
      <p className="mt-4 text-sm text-[var(--ok)]">本单资料版本已批准。投产尚未开放，需门槛齐后由经理批准。</p>
    );
  }
  if (!hasDraft) return null;

  async function approve() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/spec/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "批准失败");
      return;
    }
    setMessage(body.message || "资料版本已批准");
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4">
      <h4 className="text-sm font-medium">资料版本批准</h4>
      <p className="text-xs text-[var(--ink-muted)]">
        批准后本单草稿成为已批准版本，不覆盖历史已批准资料，也不会自动投产。一线尚未确认业务员能否批规格，目前仅经理可操作。
      </p>
      <Button type="button" onClick={approve} disabled={pending || !canApprove || !hasSpec}>
        {pending ? "处理中…" : "批准本单资料版本"}
      </Button>
      {!canApprove ? <p className="text-xs text-[var(--danger)]">当前角色无权批准资料版本</p> : null}
      {canApprove && !hasSpec ? <p className="text-xs text-[var(--danger)]">请先记录罗纹规格草稿，再批准。</p> : null}
      {message ? (
        <p className={`text-sm ${/失败|无权|冲突|他人修改/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
