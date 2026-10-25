"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RosterSelect } from "./roster-select";

export function StyleDesignerForm({
  styleId,
  currentId,
  designers,
  canEdit,
}: {
  styleId: string;
  currentId: string | null;
  designers: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [roster, setRoster] = useState(designers);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!canEdit) return <p className="text-sm text-[var(--ink-muted)]">当前角色不能改设计师署名。</p>;

  async function assign(designerId: string | null) {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/styles/${styleId}/designer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designerId }),
    });
    const body = (await response.json()) as { error?: string; designerName?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "署名失败");
      return;
    }
    setMessage(designerId ? `已署名为 ${body.designerName}` : "已撤下设计师");
    router.refresh();
  }

  async function add(name: string) {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/designers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json()) as { error?: string; id?: string; name?: string };
    setPending(false);
    if (!response.ok || !body.id || !body.name) {
      setMessage(body.error || "加入失败");
      return;
    }
    const designer = { id: body.id, name: body.name };
    setRoster((current) => (current.some((item) => item.id === designer.id) ? current : [...current, designer]));
    await assign(body.id);
  }

  async function remove(id: string) {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/designers/${id}`, { method: "DELETE" });
    const body = (await response.json()) as { error?: string; name?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "撤下失败");
      return;
    }
    setRoster((current) => current.filter((item) => item.id !== id));
    if (currentId === id) {
      await assign(null);
      return;
    }
    setMessage(`已从名单撤下 ${body.name ?? "设计师"}`);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--ink-muted)]">设计师在框里下拉选。名单没有的回车加入；不要的点右侧「撤」。有款挂着不能撤。这不是建档人。</p>
      <RosterSelect
        label="设计师"
        value={currentId ?? ""}
        options={roster}
        placeholder="请选择设计师"
        disabled={pending}
        creating={pending}
        onChange={(id) => void assign(id || null)}
        onCreate={add}
        onRemove={remove}
      />
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </div>
  );
}
