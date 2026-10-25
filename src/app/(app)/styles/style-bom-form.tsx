"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MaterialShelfItem } from "@/server/services/material-shelf";

const KIND_ORDER = ["fabric", "yarn", "trim"];

export function StyleBomDraftForm({
  styleId,
  materials,
  initialSelectedIds,
  initialConsumptions,
  canEdit,
}: {
  styleId: string;
  materials: MaterialShelfItem[];
  initialSelectedIds: string[];
  initialConsumptions: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initialSelectedIds);
  const [consumptions, setConsumptions] = useState<Record<string, string>>(initialConsumptions);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function save() {
    setPending(true);
    setMessage("");
    const payload: Record<string, string> = {};
    for (const id of selected) payload[id] = consumptions[id] ?? "";
    const response = await fetch(`/api/styles/${styleId}/bom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialIds: selected, consumptions: payload }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "写入失败");
      return;
    }
    setMessage(body.message || "已写入资料草稿");
    router.refresh();
  }

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: materials.filter((row) => row.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-3">
      <h3 className="font-medium">选择本款面料、纱线与辅料</h3>
      <p className="text-xs text-[var(--ink-muted)]">
        从面辅料库选料，保存到本款资料草稿。已批准版本保留；单耗待确认，保存不会生成采购单。
      </p>
      {groups.map((group) => (
        <fieldset key={group.kind} className="rounded-lg border border-[var(--line)] p-3">
          <legend className="px-1 text-sm font-medium">{group.items[0]?.kindLabel}</legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.items.map((item) => (
              <li key={item.id} className="space-y-2 rounded-md border border-transparent p-1">
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(item.id)}
                    disabled={!canEdit || pending}
                    onChange={() => toggle(item.id)}
                  />
                  <span>
                    <span className="font-medium">
                      {item.code} {item.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                      {item.specSummary}
                      {item.usedByStyleCodes.length ? ` · 已用在 ${item.usedByStyleCodes.join("、")}` : ""}
                    </span>
                  </span>
                </label>
                {selected.includes(item.id) ? (
                  <Input
                    aria-label={`${item.code} 单耗`}
                    placeholder={`单耗（${item.unit}），可空`}
                    value={consumptions[item.id] ?? ""}
                    disabled={!canEdit || pending}
                    onChange={(event) =>
                      setConsumptions((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      <Button type="button" onClick={save} disabled={pending || !canEdit}>
        {pending ? "写入中…" : "写入资料草稿"}
      </Button>
      {!canEdit ? <p className="text-xs text-[var(--danger)]">当前角色无权写入面辅料草稿</p> : null}
      {message ? (
        <p className={`text-sm ${/失败|无权|不存在|请至少|必须/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
