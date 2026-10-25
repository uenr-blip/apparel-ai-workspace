"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileWell } from "@/components/file-well";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
export function InboxForm({ modelReady = false }: { modelReady?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [useModel, setUseModel] = useState(modelReady);
  async function submit(file?: FormData) {
    setPending(true); setError("");
    try {
      if (file) file.set("useModel", String(useModel));
      const response = await fetch(file ? "/api/inbox/attachment" : "/api/inbox", { method: "POST", ...(file ? {} : { headers: { "Content-Type": "application/json" } }), body: file ?? JSON.stringify({ text, useModel }) });
      const body = await response.json();
      if (!response.ok || !body.sourceId) throw new Error(body.error || "资料未保存");
      router.push(`/inbox/${body.sourceId}`); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "连接中断，可用相同资料重试，系统会检查重复"); }
    finally { setPending(false); }
  }
  return <div className="space-y-5">
    <p className="text-sm">先处理同一客户、同一 PO 的大货。资料进来后可逐格修改、选款、补工厂，确认后进入跟单。</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={useModel} disabled={pending || !modelReady} onChange={e => setUseModel(e.target.checked)} />使用已配置模型整理客户原文{!modelReady ? "（尚未启用，可手动填写）" : "（会发送本次原文，按模型账户计费）"}</label>
    <section><label htmlFor="customer-source" className="font-medium">粘贴客户 PO 或邮件原文</label>
      <Textarea id="customer-source" name="sourceText" value={text} onChange={e => setText(e.target.value)} placeholder="粘贴真实客户资料。不要删除产品编号、PO、颜色数量和日期。" className="mt-2 max-h-[32vh] overflow-y-auto" />
      <Button className="mt-3" disabled={pending || text.trim().length < 4} onClick={() => void submit()}>{pending ? "正在接收并整理…" : "接收资料，进入核对"}</Button>
    </section>
    <details className="rounded-lg border border-[var(--line)] p-3"><summary className="cursor-pointer font-medium">上传客户文件</summary>
      <p className="my-3 text-xs text-[var(--ink-muted)]">Excel、CSV、文字 PDF 可读取文字；照片、扫描件先保留原件供人工填写，目前不自动识图。每份不超过 5MB。</p>
      <form onSubmit={e => { e.preventDefault(); void submit(new FormData(e.currentTarget)); }} className="space-y-3">
        <FileWell id="inbox-attachment" label="客户文件" hint="Excel / CSV / PDF / JPG / PNG" accept=".xlsx,.csv,.pdf,.jpg,.jpeg,.png" />
        <Button disabled={pending}>{pending ? "正在接收并整理…" : "接收文件，进入核对"}</Button>
      </form>
    </details>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    <p className="text-xs text-[var(--ink-muted)]">收到资料只生成待核对草稿。原件和修改记录会保留；确认建跟单不等于投产或采购。</p>
  </div>;
}
