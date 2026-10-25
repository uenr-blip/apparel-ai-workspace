"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileWell } from "@/components/file-well";
import { Button } from "@/components/ui/button";

export function CreateMaterialForm({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能新建材料主档。</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    setPending(true);
    setMessage("");
    const response = await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: String(data.get("code") ?? ""),
        name: String(data.get("name") ?? ""),
        kind: String(data.get("kind") ?? ""),
        specSummary: String(data.get("specSummary") ?? ""),
        unit: String(data.get("unit") ?? ""),
        composition: String(data.get("composition") ?? ""),
        gsm: String(data.get("gsm") ?? ""),
        widthCm: String(data.get("widthCm") ?? ""),
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string; materialId?: string };
    if (!response.ok) {
      setPending(false);
      setMessage(body.error || "建档失败");
      return;
    }
    if (file instanceof File && file.size > 0 && body.materialId) {
      const image = new FormData();
      image.set("file", file);
      const uploaded = await fetch(`/api/materials/${body.materialId}/image`, { method: "POST", body: image });
      const imageBody = (await uploaded.json()) as { error?: string; message?: string };
      setPending(false);
      if (!uploaded.ok) {
        setMessage(imageBody.error || "主档已建，色卡图未存上");
        router.refresh();
        return;
      }
      setMessage(`${body.message || "已建档"}。${imageBody.message || "已挂色卡图"}`);
    } else {
      setPending(false);
      setMessage(body.message || "已建档");
    }
    form.reset();
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm text-[var(--ink-muted)]">
        货号就是材料编码，面料、纱线、辅料同一架子。建的是主档，不是库存，也不是已采购。要买料从订单料况出采购草稿。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm" htmlFor="new-material-code">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">货号</span>
          <input
            id="new-material-code"
            name="code"
            required
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm"
          />
        </label>
        <label className="text-sm" htmlFor="new-material-name">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">名称</span>
          <input
            id="new-material-name"
            name="name"
            required
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">种类</span>
          <select name="kind" required defaultValue="fabric" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm">
            <option value="fabric">面料</option>
            <option value="yarn">纱线</option>
            <option value="trim">辅料</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">单位</span>
          <input name="unit" defaultValue="m" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">成分</span>
          <input name="composition" placeholder="如 100%棉" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">克重 g/m²</span>
          <input name="gsm" inputMode="decimal" placeholder="可后补" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">幅宽 cm</span>
          <input name="widthCm" inputMode="decimal" placeholder="辅料可空" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">规格（兜底，可后补）</span>
          <input name="specSummary" placeholder="不填则用成分/克重/幅宽" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm" />
        </label>
      </div>
      <FileWell
        id="new-material-file"
        label="色卡图"
        hint="可选，JPG / PNG，最大 5MB"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
      />
      <p className="text-xs text-[var(--ink-muted)]">只存附件，不识料。有图不等于在库，也不等于已采购。</p>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "建档中…" : "新建材料"}
      </Button>
      {message ? (
        <p className={`text-sm ${/失败|无权|已存在|填写|未存/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
