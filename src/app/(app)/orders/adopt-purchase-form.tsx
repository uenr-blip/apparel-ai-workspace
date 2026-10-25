"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AdoptPurchaseForm({
  orderId,
  materialId,
  expectedSnapshot,
  canEdit,
  canIssue,
  adopted,
}: {
  orderId: string;
  materialId: string;
  expectedSnapshot: string;
  canEdit: boolean;
  canIssue: boolean;
  adopted: { optionCode: string; qty: string; amountYuan: string; status: string; updatedAt?: string } | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function adopt(optionCode: "A" | "B") {
    setPending(optionCode);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/purchase-options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId, optionCode, expectedSnapshot }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(null);
    if (!response.ok) {
      setMessage(body.error || "采用失败");
      return;
    }
    setMessage(body.message || "已采用方案，未下达采购");
    router.refresh();
  }

  async function issue() {
    if (!adopted?.updatedAt) return;
    setPending("issue");
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/purchase-issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId, expectedUpdatedAt: adopted.updatedAt, idempotencyKey: crypto.randomUUID() }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(null);
    if (!response.ok) {
      setMessage(body.error || "下达失败");
      return;
    }
    setMessage(body.message || "已下达采购，未收料，未付款");
    router.refresh();
  }

  if (adopted?.status === "issued") {
    return (
      <p className="mt-3 text-sm text-[var(--ok)]">
        方案 {adopted.optionCode} 已下达采购 {adopted.qty} 米 / {adopted.amountYuan} 元。未收料，未付款。
      </p>
    );
  }

  if (adopted && adopted.status !== "stale") {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm text-[var(--ok)]">
          已采用方案 {adopted.optionCode}，采购草稿 {adopted.qty} 米 / {adopted.amountYuan} 元。未下达采购。
        </p>
        {canIssue ? (
          <Button type="button" size="sm" onClick={() => void issue()} disabled={pending !== null}>
            {pending === "issue" ? "处理中…" : "下达采购"}
          </Button>
        ) : (
          <p className="text-xs text-[var(--ink-muted)]">下达采购由经理办理。下达不是收料，也不是付款。</p>
        )}
        {message ? <p className={`text-sm ${/失败|无权|过期|变化/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {adopted?.status === "stale" ? (
        <p className="text-sm text-[var(--warning)]">
          旧方案 {adopted.optionCode}（草稿 {adopted.qty} 米）已过期，需按当前净需求重新采用。未下达采购。
        </p>
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">采用后占用可分配库存并生成采购草稿，不会下达正式采购单。</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void adopt("A")} disabled={!canEdit || pending !== null}>
          {pending === "A" ? "处理中…" : "采用方案 A"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => void adopt("B")} disabled={!canEdit || pending !== null}>
          {pending === "B" ? "处理中…" : "采用方案 B"}
        </Button>
      </div>
      {!canEdit ? <p className="text-xs text-[var(--danger)]">当前角色无权采用采购方案</p> : null}
      {message ? (
        <p className={`text-sm ${/失败|无权|占用|已采用方案 [AB]，不能/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
