"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DesignerRosterForm({
  designers,
  canEdit,
}: {
  designers: Array<{ id: string; name: string; styleCount: number }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能改设计师名单。工厂只看已挂名。</p>;
  }

  async function add() {
    setPending("add");
    setMessage("");
    const response = await fetch("/api/designers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json()) as { error?: string; name?: string };
    setPending("");
    if (!response.ok) {
      setMessage(body.error || "增加失败");
      return;
    }
    setName("");
    setMessage(`已加入 ${body.name}，建单后可快选。这不是登录账号。`);
    router.refresh();
  }

  async function remove(id: string) {
    setPending(id);
    setMessage("");
    const response = await fetch(`/api/designers/${id}`, { method: "DELETE" });
    const body = (await response.json()) as { error?: string; name?: string };
    setPending("");
    if (!response.ok) {
      setMessage(body.error || "移除失败");
      return;
    }
    setMessage(`已从名单移除 ${body.name}`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-muted)]">
        设计师是款式署名，方便以后快选。增加或移除的是名单，不是系统账号。建单人仍是当前登录的员工，不能在这里冒选别人的名字。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">设计师姓名</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 沈予安" aria-label="设计师姓名" />
        </label>
        <Button type="button" size="sm" disabled={pending === "add" || !name.trim()} onClick={() => void add()}>
          {pending === "add" ? "加入中…" : "加入名单"}
        </Button>
      </div>
      <ul className="space-y-2 text-sm">
        {designers.length === 0 ? <li className="text-[var(--ink-muted)]">还没有设计师，先加入一位才能快选。</li> : null}
        {designers.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2">
            <span>
              {item.name}
              <span className="ml-2 text-xs text-[var(--ink-muted)]">{item.styleCount ? `挂在 ${item.styleCount} 款` : "未挂款"}</span>
            </span>
            <Button type="button" size="sm" variant="ghost" disabled={pending === item.id} onClick={() => void remove(item.id)}>
              {pending === item.id ? "移除中…" : "移除"}
            </Button>
          </li>
        ))}
      </ul>
      {message ? <p className={`text-sm ${/失败|无权|挂着/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{message}</p> : null}
    </div>
  );
}
