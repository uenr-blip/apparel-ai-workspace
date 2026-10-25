"use client";
import { useId, useState } from "react";
import { TablePhoto } from "@/components/table-photo";
import { CatalogCompose } from "@/components/catalog-compose";
import { Button } from "@/components/ui/button";
import { BoardDialog } from "@/components/board-dialog";
import { PatternCatalogPicker } from "./pattern-catalog-picker";
import { SheetPicture } from "@/app/(app)/orders/sheet-picture";
import { PATTERN_FIELDS, fieldValue, type PatternContent, type PatternReference } from "@/lib/pattern-workflow";
const fieldClass = "mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field-solid)] p-2 text-sm";
export function PatternReferenceEditor({ content, onChange, disabled }: { content: PatternContent; onChange: (content: PatternContent) => void; disabled: boolean }) {
  const [catalogOpen,setCatalogOpen] = useState(false), [message,setMessage] = useState("");
  const catalogTitle = useId();
  return <section className="space-y-3 rounded-xl border border-[var(--line)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">参考依据</p>{!disabled && <div className="flex flex-wrap gap-2"><CatalogCompose label="上传参考图" title="上传参考图" variant="outline"><ReferencePicker content={content} onChange={onChange} /></CatalogCompose><Button type="button" variant="outline" disabled={content.references.length>=12} onClick={()=>{setCatalogOpen(true);setMessage("");}}>参考已有款</Button></div>}</div>
    <BoardDialog open={catalogOpen} title="从款式库选择参考" titleId={catalogTitle} onClose={()=>setCatalogOpen(false)}>{catalogOpen && <PatternCatalogPicker content={content} onApply={value=>{onChange(value);setCatalogOpen(false);setMessage("已带入当前表格，可以继续修改；修改完成后请保存版单草稿。");}}/>}</BoardDialog>
    {message && <p role="status" className="text-sm text-[var(--ok)]">{message}</p>}
    {!content.references.length ? <p className="text-xs text-[var(--ink-muted)]">上传实物或局部参考图，或点“参考已有款”从款式库带入资料，再按本次要求修改。</p> : content.references.map(ref => <article key={ref.id} className="space-y-2 border-t border-[var(--line)] pt-3 text-sm">
      <div className="flex justify-between gap-3"><p>{ref.label} · {ref.mode === "fields" ? "部分字段参考" : "仅作说明"}</p><button type="button" disabled={disabled} className="text-[var(--ink-muted)] underline" onClick={() => onChange({ ...content, references: content.references.filter(r => r.id !== ref.id) })}>移除参考</button></div>
      <label className="block">参考哪些<input aria-label={`${ref.label}参考范围`} className={fieldClass} maxLength={400} value={ref.scope} disabled={disabled} onChange={e => onChange({ ...content, references: content.references.map(r => r.id === ref.id ? { ...r, scope: e.target.value } : r) })} /></label>
      <p className="text-xs text-[var(--ink-muted)]">{ref.sourceLabel}</p><label className="block">哪些不参考<input className={fieldClass} value={ref.exclusions} maxLength={400} disabled={disabled} onChange={e=>onChange({...content,references:content.references.map(r=>r.id===ref.id?{...r,exclusions:e.target.value}:r)})}/></label>
      {ref.fields.length ? <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>项目</th><th>来源原值</th><th>本次值（在版单中修改）</th></tr></thead><tbody>{ref.fields.map(f => <tr key={f}><td className="py-2">{PATTERN_FIELDS[f]}</td><td>{ref.sourceValues[f] || "未记录"}</td><td>{fieldValue(content,f) || "待填写"}</td></tr>)}</tbody></table></div> : null}
      <div className="flex flex-wrap gap-2">{ref.images.map((src,index) => <div key={src} className="space-y-1"><TablePhoto src={src} label={ref.label || "参考图"}/>{ref.kind === "image" && ref.images.length > 1 && <button type="button" disabled={disabled} aria-label={`移除${ref.label}参考图 ${index + 1}`} className="text-xs text-[var(--ink-muted)] underline" onClick={() => onChange({ ...content,references:content.references.map(r=>r.id===ref.id?{...r,images:r.images.filter((_,i)=>i!==index)}:r) })}>移除图片</button>}</div>)}</div>
      {ref.kind === "image" && ref.images.length === 1 && <p className="text-xs text-[var(--ink-muted)]">不再需要这张图时，点上方“移除参考”，一起去掉本条参考说明。</p>}
      {ref.catalog?.includeImage && <button type="button" disabled={disabled} className="text-xs text-[var(--ink-muted)] underline" onClick={() => onChange({ ...content,references:content.references.map(r=>r.id===ref.id?{...r,images:[],catalog:{...r.catalog!,includeImage:false}}:r) })}>移除来源参考图，保留参数参考</button>}
      {ref.catalog?.includeImage && !ref.images.length && <p className="text-xs text-[var(--ink-muted)]">来源参考图会在保存草稿后固定留存。</p>}
    </article>)}
    {content.references.length ? <p className="text-xs text-[var(--ink-muted)]">移除参考只移除来源说明，已填参数仍保留，请核对本次值。来源之后更新不会自动覆盖本版。</p> : null}
  </section>;
}
function ReferencePicker({ content, onChange }: { content: PatternContent; onChange: (content: PatternContent) => void }) {
  const [label,setLabel] = useState(""), [scope,setScope] = useState(""), [exclusions,setExclusions] = useState(""), [images,setImages] = useState<string[]>([]);
  const [confirmed,setConfirmed] = useState(false), [message,setMessage] = useState("");
  function add() {
    if (!confirmed || !scope.trim() || !label.trim() || !images.length) { setMessage("请上传图片、填写参考名称和范围，并核对确认"); return; }
    const ref: PatternReference = { id:crypto.randomUUID(),kind:"image",sourceRevisionId:"",images,label:label.trim(),sourceLabel:label.trim(),scope:scope.trim(),exclusions:exclusions.trim(),mode:"note",fields:[],sourceValues:{} };
    onChange({...content,references:[...content.references,ref]});setConfirmed(false);setImages([]);setScope("");setMessage("已加入本地草稿，关闭窗口后请保存版单草稿。");
  }
  return <div className="space-y-3" onChange={()=>setConfirmed(false)}>
    <label className="block text-sm">参考名称<input className={fieldClass} value={label} maxLength={400} onChange={e=>setLabel(e.target.value)} placeholder="例如：客人带来的样衣领口"/></label>
    <div className="flex flex-wrap gap-2">{images.map((src,index)=><div key={src} className="space-y-1"><TablePhoto src={src} label={`参考图片 ${index+1}`}/><button type="button" aria-label={`移除参考图片 ${index+1}`} className="text-xs text-[var(--ink-muted)] underline" onClick={()=>{setImages(images.filter(s=>s!==src));setConfirmed(false);}}>移除图片</button></div>)}</div>
    {images.length<6 && <SheetPicture label="参考图片（最多6张）" imageSrc="" disabled={false} onChange={path=>{setImages([...images,path]);setConfirmed(false);}}/>}
    <p className="text-xs text-[var(--ink-muted)]">图片用于说明外观和部位，纱线成分、支数仍须依据资料或人工核对。</p>
    <label className="block text-sm">参考哪些部位或内容<input className={fieldClass} value={scope} maxLength={400} onChange={e=>setScope(e.target.value)} placeholder="只参考领口结构和大身组织"/></label>
    <label className="block text-sm">哪些不参考<input className={fieldClass} value={exclusions} maxLength={400} onChange={e=>setExclusions(e.target.value)} placeholder="不参考颜色、衣长和原纱线"/></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>{e.stopPropagation();setConfirmed(e.target.checked);}}/>我已核对参考范围，允许加入当前草稿。</label>
    <Button type="button" disabled={!confirmed||content.references.length>=12} onClick={add}>加入当前草稿</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
