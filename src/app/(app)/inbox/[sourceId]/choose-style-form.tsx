"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ChooseStyleForm({
  sourceId,
  candidates,
  role,
}: {
  sourceId: string;
  candidates: Array<{ styleId: string; code: string; name: string; reason: string; selected: boolean }>;
  role: string;
}) {
  const router = useRouter();
  const [styleId, setStyleId] = useState(candidates.find((item) => item.selected)?.styleId ?? "");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const canChoose = role === "salesperson" || role === "manager";

  async function choose() {
    if (!styleId) {
      setMessage("请先选一份历史资料");
      return;
    }
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/inbox/${sourceId}/choose-style`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleId }),
    });
    const body = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "选定失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3">
      {candidates.map((item) => (
        <label key={item.styleId} className="flex cursor-pointer gap-3 rounded-lg border border-[var(--line)] p-3 text-sm">
          <input
            type="radio"
            name="history-style"
            value={item.styleId}
            checked={styleId === item.styleId}
            disabled={!canChoose || pending}
            onChange={() => setStyleId(item.styleId)}
          />
          <span>
            <span className="font-medium">
              {item.code} {item.name}
            </span>
            <span className="mt-1 block text-xs text-[var(--ink-muted)]">{item.reason}</span>
          </span>
        </label>
      ))}
      <Button type="button" onClick={() => void choose()} disabled={!canChoose || pending || !styleId}>
        {pending ? "保存中…" : "选定这份资料"}
      </Button>
      {!canChoose ? <p className="text-xs text-[var(--danger)]">当前角色无权选定历史资料</p> : null}
      <p className="text-xs text-[var(--ink-muted)]">选定只建引用，必须重确认。不是视觉识款，也不能沿用旧批准。</p>
      {message ? <p className="text-sm text-[var(--danger)]">{message}</p> : null}
    </div>
  );
}
