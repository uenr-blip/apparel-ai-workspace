"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CreateDesignForm({
  canEdit,
  styles,
  materials,
  presetStyleId = "",
  presetMaterialId = "",
  presetIntent = "reference",
}: {
  canEdit: boolean;
  styles: Array<{ id: string; code: string; name: string }>;
  materials: Array<{ id: string; code: string; name: string }>;
  presetStyleId?: string;
  presetMaterialId?: string;
  presetIntent?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能开设计草案。</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    const response = await fetch("/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(data.get("name") ?? ""),
        brief: String(data.get("brief") ?? ""),
        intent: String(data.get("intent") ?? "reference"),
        styleId: String(data.get("styleId") ?? ""),
        materialId: String(data.get("materialId") ?? ""),
      }),
    });
    const body = (await response.json()) as { error?: string; id?: string };
    setPending(false);
    if (!response.ok || !body.id) {
      setMessage(body.error || "创建失败");
      return;
    }
    router.push(`/styles/design/${body.id}`);
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm text-[var(--ink-muted)]">不需要正式款号。采用后才转入开发款式或资料草稿，不会批准，也不会采购。</p>
      <label className="block text-sm">
        草案名称
        <input name="name" required className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2" placeholder="例如：袋鼠袋改色" />
      </label>
      <label className="block text-sm">
        要求和参考
        <textarea name="brief" rows={3} className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2" placeholder="想做成什么样，哪些必须保持" />
      </label>
      <label className="block text-sm">
        先做哪一步
        <select name="intent" defaultValue={presetIntent} className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2">
          <option value="reference">参考生成</option>
          <option value="recolor">定向改色</option>
          <option value="edit">定向修改</option>
          <option value="onbody">上身看款</option>
        </select>
      </label>
      <label className="block text-sm">
        已有款式（可空）
        <select name="styleId" defaultValue={presetStyleId} className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2">
          <option value="">不先绑款号</option>
          {styles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        已有材料（可空）
        <select name="materialId" defaultValue={presetMaterialId} className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2">
          <option value="">不先绑材料</option>
          {materials.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} {item.name}
            </option>
          ))}
        </select>
      </label>
      {message ? <p className="text-sm text-[var(--danger)]">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "正在开草案…" : "进入创作"}
      </Button>
    </form>
  );
}
