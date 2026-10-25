"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StyleCatalog } from "@/server/services/style-catalog";
import { StyleCatalogFields, type CatalogPick } from "./style-catalog-fields";

export function StyleCatalogForm({
  styleId,
  catalog,
  current,
  canEdit,
}: {
  styleId: string;
  catalog: StyleCatalog;
  current: CatalogPick;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [localCatalog, setLocalCatalog] = useState(catalog);
  const [pick, setPick] = useState(current);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能改主档资料选项。</p>;
  }

  async function assign(next: CatalogPick) {
    setPick(next);
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/styles/${styleId}/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandOptionId: next.brandOptionId || null,
        categoryOptionId: next.categoryOptionId || null,
        typeOptionId: next.typeOptionId || null,
        yearOptionId: next.yearOptionId || null,
      }),
    });
    const body = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "更新失败");
      return;
    }
    setMessage("已更新主档资料，年份不是新款号");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <StyleCatalogFields
        catalog={localCatalog}
        value={pick}
        canEdit={canEdit}
        onCatalogPatch={setLocalCatalog}
        onChange={(next) => void assign(next)}
      />
      {pending ? <p className="text-xs text-[var(--ink-muted)]">保存中…</p> : null}
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </div>
  );
}
