"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AttachmentThumbnail } from "@/components/attachment-thumbnail";
import { FileWell } from "@/components/file-well";
import { Button } from "@/components/ui/button";

type Attachment = { id: string; fileName: string; href: string };

export function StyleProcessForm({
  styleId,
  processNotes,
  patternRevision,
  attachments,
  canEdit,
}: {
  styleId: string;
  processNotes: string;
  patternRevision: string;
  attachments: Attachment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(processNotes);
  const [revision, setRevision] = useState(patternRevision);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function saveNotes() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/styles/${styleId}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processNotes: notes, patternRevision: revision }),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "保存失败");
      return;
    }
    setMessage(body.message || "已写入草稿");
    router.refresh();
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/styles/${styleId}/pattern`, {
      method: "POST",
      body: new FormData(form),
    });
    const body = (await response.json()) as { error?: string; message?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "上传失败");
      return;
    }
    setMessage(body.message || "附件已挂上");
    form.reset();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium">工艺与版次</h3>
      <p className="text-xs text-[var(--ink-muted)]">
        挂在本款资料版本上，不是工艺管理或制版管理菜单。已批准版本不会被就地改写。附件不能授权，也不能替代版型终审，更不会算出标准工时。
      </p>
      {canEdit ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--ink-muted)]">工艺说明</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="缝制要点、特殊工艺。不要填标准工时。"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--ink-muted)]">版次</span>
            <input
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
              placeholder="例如 P2"
              className="h-11 w-full max-w-xs rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm"
            />
          </label>
          <Button type="button" size="sm" disabled={pending} onClick={() => void saveNotes()}>
            {pending ? "保存中…" : "保存到资料草稿"}
          </Button>
          <form className="space-y-2" onSubmit={(event) => void upload(event)}>
            <FileWell
              label="版次附件"
              hint="PDF / JPG / PNG"
              required
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              上传版次附件
            </Button>
          </form>
        </>
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">当前角色不能改工艺与版次。</p>
      )}
      <div className="text-sm">
        <p>当前工艺：{processNotes.trim() || "未记，不能当生产依据"}</p>
        <p className="mt-1">当前版次：{patternRevision.trim() || "未标"}</p>
        {attachments.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {attachments.map((item) => (
              <li key={item.id}>
                <AttachmentThumbnail href={item.href} name={item.fileName} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-[var(--ink-muted)]">还没有版次附件。</p>
        )}
      </div>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </div>
  );
}
