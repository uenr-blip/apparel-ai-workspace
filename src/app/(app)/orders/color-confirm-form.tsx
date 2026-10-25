"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/labels";
import type { ColorConfirmationBoard } from "@/server/services/color-confirm";

export function ColorConfirmForm({
  orderId,
  board,
  canEdit,
}: {
  orderId: string;
  board: ColorConfirmationBoard;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [evidenceByColor, setEvidenceByColor] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function submit(colorName: string, status: "approved" | "rejected") {
    if (!board.defaultMaterialId) {
      setMessage("没有可记录的材料");
      return;
    }
    setPending(`${colorName}-${status}`);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/color-confirmations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        materialId: board.defaultMaterialId,
        colorName,
        status,
        evidence: evidenceByColor[colorName] ?? "",
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(null);
    if (!response.ok) {
      setMessage(body.error || "记录失败");
      return;
    }
    setMessage(body.message || "已记录");
    setEvidenceByColor((current) => ({ ...current, [colorName]: "" }));
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium">分色确认</h3>
      <p className="text-xs text-[var(--ink-muted)]">
        按颜色分别记录批准或退回。历史轮次不会被覆盖。这不是图片识别终审，也不能把整款标成已批准。
      </p>
      <p className="text-sm">{board.headline}</p>
      {board.colors.length === 0 ? (
        <p className="text-sm text-[var(--warning)]">还没有本单颜色。先到上方色尺写下新颜色，再做分色确认，不能沿用旧样品批准。</p>
      ) : null}
      {board.colors.map((row) => (
        <section key={row.colorName} className="rounded-lg border border-[var(--line)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium">{row.colorName}</h4>
            <span className="text-xs text-[var(--ink-muted)]">
              {row.latest
                ? `最新：第 ${row.latest.round} 轮${labels.confirmationStatus(row.latest.status)}${row.latest.materialCode ? ` · ${row.latest.materialCode}` : ""}`
                : "尚未确认"}
            </span>
          </div>
          <ol className="mt-2 space-y-1 text-xs text-[var(--ink-muted)]">
            {row.history.map((item) => (
              <li key={item.id}>
                第 {item.round} 轮 {labels.confirmationStatus(item.status)}：{item.evidence}
              </li>
            ))}
          </ol>
          <label className="mt-2 block text-xs text-[var(--ink-muted)]" htmlFor={`evidence-${row.colorName}`}>
            {row.colorName}确认依据
          </label>
          <Input
            id={`evidence-${row.colorName}`}
            aria-label={`${row.colorName}确认依据`}
            placeholder="色样/手感/客户回复等依据，不能空"
            value={evidenceByColor[row.colorName] ?? ""}
            disabled={!canEdit || Boolean(pending)}
            onChange={(event) =>
              setEvidenceByColor((current) => ({ ...current, [row.colorName]: event.target.value }))
            }
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || Boolean(pending)}
              onClick={() => submit(row.colorName, "approved")}
            >
              {pending === `${row.colorName}-approved` ? "记录中…" : `批准${row.colorName}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={!canEdit || Boolean(pending)}
              onClick={() => submit(row.colorName, "rejected")}
            >
              {pending === `${row.colorName}-rejected` ? "记录中…" : `退回${row.colorName}`}
            </Button>
          </div>
        </section>
      ))}
      {!canEdit ? <p className="text-xs text-[var(--danger)]">当前角色无权记录颜色确认</p> : null}
      {message ? (
        <p className={`text-sm ${/失败|无权|请填|不在|不存在/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
