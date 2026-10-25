"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { SheetHead } from "@/components/ui/sheet";
import type { BulkDeskNext } from "@/server/domain/bulk-desk-next";

export function ProductionGateForm({
  orderId,
  expectedUpdatedAt,
  canRelease,
  alreadyReleased,
  alreadyDone,
  ready,
  label,
  checks,
  next,
}: {
  orderId: string;
  expectedUpdatedAt: string;
  canRelease: boolean;
  alreadyReleased: boolean;
  alreadyDone: boolean;
  ready: boolean;
  label: string;
  checks: Array<{ id: string; label: string; passed: boolean; evidence: string }>;
  facts: string[];
  next: BulkDeskNext;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function release() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "批准投产失败");
      return;
    }
    setMessage(body.message || "已批准投产");
    router.refresh();
  }

  return (
    <div className="gate-band">
      <div>
        <SheetHead title="投产门槛" />
        <p className="mt-2 text-sm leading-6">{next.action}</p>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          {next.who} · {next.availabilityLabel}
          {next.href && next.hrefLabel ? (
            <>
              {" · "}
              <Link href={next.href} className="text-[var(--brand-strong)]">
                {next.hrefLabel}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <div>
        <p className={`text-sm leading-6 ${ready || alreadyReleased ? "text-[var(--ok)]" : "text-[var(--warning)]"}`}>{label}</p>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {checks.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <Badge tone={item.passed ? "ok" : "warning"}>{item.passed ? "已齐" : "未齐"}</Badge>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col items-start gap-2">
        {alreadyReleased ? (
          <p className="text-sm text-[var(--ok)]">已可投产，进度台可登记产量。正式采购未下达。</p>
        ) : alreadyDone ? (
          <p className="text-sm text-[var(--ink-muted)]">已出运，不能再批准投产。</p>
        ) : (
          <Button type="button" onClick={() => void release()} disabled={pending || !canRelease || !ready}>
            {pending ? "处理中…" : "批准投产"}
          </Button>
        )}
        {!canRelease && !alreadyReleased && !alreadyDone ? (
          <p className="text-xs text-[var(--danger)]">当前角色无权批准投产</p>
        ) : null}
        {canRelease && !ready && !alreadyReleased && !alreadyDone ? (
          <p className="text-xs text-[var(--ink-muted)]">门槛未齐，不能批准投产。</p>
        ) : null}
        {message ? (
          <p className={`text-sm ${/失败|无权|冲突|不能/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
