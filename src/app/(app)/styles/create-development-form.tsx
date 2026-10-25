"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CreateDevelopmentForm({
  canEdit,
  styles,
  materials,
}: {
  canEdit: boolean;
  styles: Array<{ id: string; code: string; name: string }>;
  materials: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能新建打版。请联系打版负责人；工厂可查看已发给本厂的打样要求。</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(data.get("name") ?? ""),
        styleId: String(data.get("styleId") ?? ""),
        materialIds: data.getAll("materialIds").map((item) => String(item)),
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string; projectId?: string };
    setPending(false);
    if (!response.ok || !body.projectId) {
      setMessage(body.error || "新建打版失败");
      return;
    }
    router.push(`/projects/${body.projectId}`);
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm leading-6 text-[var(--ink-muted)]">
        创建后进入版单，可继续补参考图、面辅料和工艺要求。点选材料只建引用，不会采购或自动发厂。
      </p>
      <label className="block text-sm">
        打版名称
        <input
          name="name"
          required
          className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2"
          placeholder="例如：灯芯绒夹克开发打版"
        />
      </label>
      <label className="block text-sm">
        已有款式（可空）
        <select name="styleId" defaultValue="" className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2">
          <option value="">不先绑款号</option>
          {styles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} {item.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm">引用材料（可空，可多选）</legend>
        <div className="max-h-48 space-y-1 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--field-solid)] p-3">
          {materials.slice(0, 24).map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="materialIds" value={item.id} />
              {item.code} {item.name}
            </label>
          ))}
        </div>
      </fieldset>
      {message ? <p className="text-sm text-[var(--danger)]">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "正在建立…" : "创建并填写版单"}
      </Button>
    </form>
  );
}
