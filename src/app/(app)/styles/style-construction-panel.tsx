"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ConstructionItem, ConstructionMaterialChoice } from "@/lib/style-construction";
import { StyleConstructionFields, StyleConstructionSummary } from "./style-construction-fields";

export function StyleConstructionPanel({ rows, styleId, versionId, expectedStamp, canEdit, materials }: { rows: ConstructionItem[]; styleId: string; versionId: string; expectedStamp: string; canEdit: boolean; materials: ConstructionMaterialChoice[] }) {
  const [editing, setEditing] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/styles/${styleId}/construction`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error || "保存失败，请重试"); return; }
      setEditing(false); setMessage(result.message); router.refresh();
    } catch { setMessage("连接中断，填写内容已保留，请重试。"); } finally { setPending(false); }
  }
  return <div>
    {canEdit && !editing ? <Button className="mt-3" size="sm" variant="outline" onClick={() => { setEditing(true); setMessage(""); }}>编辑用料与特殊工艺</Button> : null}
    {editing ? <form onSubmit={submit} className="mt-3"><input type="hidden" name="expectedStamp" value={expectedStamp} /><fieldset disabled={pending}><StyleConstructionFields materials={materials} initial={rows} styleId={styleId} versionId={versionId} /><div className="mt-4 flex gap-3"><Button type="submit" size="sm">{pending ? "保存中…" : "保存资料草稿"}</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>取消修改</Button></div></fieldset></form> : <StyleConstructionSummary rows={rows} styleId={styleId} versionId={versionId} />}
    {message ? <p role="status" className="mt-3 text-sm">{message}</p> : null}
  </div>;
}
