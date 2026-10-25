"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LinkStyleForm({
  projectId,
  styles,
  disabled,
}: {
  projectId: string;
  styles: Array<{ id: string; code: string; name: string }>;
  disabled: boolean;
}) {
  const router = useRouter();
  const [styleId, setStyleId] = useState(styles[0]?.id ?? "");
  const [message, setMessage] = useState("");

  async function submit() {
    const response = await fetch(`/api/projects/${projectId}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleId }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "关联失败");
      return;
    }
    router.refresh();
  }

  if (disabled) {
    return <p className="mt-3 text-sm text-[var(--ok)]">已关联款式，材料引用保持不变，没有复制主档。</p>;
  }

  return (
    <div className="mt-4 space-y-2">
      <label className="block text-sm">
        关联已有款式（不新建、不复制材料）
        <select
          className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm"
          value={styleId}
          onChange={(e) => setStyleId(e.target.value)}
        >
          {styles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.code} {style.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" onClick={submit} disabled={!styleId}>
        关联款式
      </Button>
      {message ? <p className="text-sm text-[var(--danger)]">{message}</p> : null}
    </div>
  );
}
