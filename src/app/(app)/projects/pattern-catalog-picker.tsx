"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CRAFT_LABEL, type CraftFamily } from "@/server/domain/craft-sheet";
import { applyReferenceFields, fieldFits, fieldValue, PATTERN_FIELDS, type PatternContent, type PatternField, type PatternReference } from "@/lib/pattern-workflow";
import type { PatternCatalogResults, PatternCatalogSource } from "@/lib/pattern-catalog";

const fieldClass = "mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field-solid)] p-2 text-sm";
export function PatternCatalogPicker({ content, onApply }: { content: PatternContent; onApply: (value: PatternContent) => void }) {
  const [query,setQuery] = useState(""), [results,setResults] = useState<PatternCatalogResults|null>(null);
  const [composing,setComposing] = useState(false);
  const [source,setSource] = useState<PatternCatalogSource|null>(null), [busy,setBusy] = useState(true), [loadingSource,setLoadingSource] = useState(false), [error,setError] = useState("");
  const [family,setFamily] = useState(content.craftFamily), [fields,setFields] = useState<PatternField[]>([]), [includeImage,setIncludeImage] = useState(false);
  const [scope,setScope] = useState(""), [exclusions,setExclusions] = useState(""), [confirmed,setConfirmed] = useState(false);
  const requestNumber = useRef(0);
  useEffect(() => {
    if (composing) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/pattern-catalog?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "款式库暂时无法读取");
        if (!controller.signal.aborted) setResults(data);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "查找失败"); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, composing]);
  const used = (f: PatternField) => content.references.some(r => r.fields.includes(f));
  async function choose(id: string, material = "") {
    const request = ++requestNumber.current;
    setLoadingSource(true); setSource(null); setConfirmed(false); setError("");
    try {
      const response = await fetch(`/api/projects/pattern-catalog?source=${encodeURIComponent(id)}&material=${encodeURIComponent(material)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "来源资料暂时无法读取");
      if (request !== requestNumber.current) return;
      const next = data as PatternCatalogSource, nextFamily = content.craftFamily || next.content.craftFamily;
      const selected = next.fields.filter(f => (!nextFamily || fieldFits(nextFamily,f)) && !used(f));
      setSource(next); setFamily(nextFamily); setFields(selected); setIncludeImage(next.canAttachImage);
      setScope(selected.map(f => PATTERN_FIELDS[f]).join("、")); setExclusions("");
    } catch(e) { if (request === requestNumber.current) setError(e instanceof Error ? e.message : "读取失败"); }
    finally { if (request === requestNumber.current) setLoadingSource(false); }
  }
  function apply() {
    if (!source || !confirmed || !family || !scope.trim()) return;
    const selected = fields.filter(f => fieldFits(family,f) && !used(f));
    const ref: PatternReference = { id: crypto.randomUUID(), kind: "catalog", sourceRevisionId: "", catalog: { sourceId: source.sourceId, materialId: source.materialId, fingerprint: source.fingerprint, includeImage }, label: source.label.slice(0,400), sourceLabel: source.label, images: [], scope: scope.trim(), exclusions: exclusions.trim(), mode: selected.length ? "fields" : "note", fields: selected, sourceValues: Object.fromEntries(selected.map(f => [f,fieldValue(source.content,f)])) };
    const next = applyReferenceFields({ ...content, craftFamily: family }, { ...source.content, craftFamily: source.content.craftFamily || family }, selected);
    onApply({ ...next, references: [...content.references, ref] });
  }
  const overwrite = fields.filter(f => fieldValue(content,f) && fieldValue(content,f) !== fieldValue(source?.content ?? content,f));
  return <div className="space-y-4" onChange={() => setConfirmed(false)}>
    {!source && <>
      <label className="block text-sm">搜索款式库<input autoFocus className={fieldClass} value={query} maxLength={100} placeholder="输入一个字、款号或开发编号，例如：毛、DEV-02" onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onChange={e => { ++requestNumber.current; setQuery(e.target.value); setResults(null); setBusy(true); setLoadingSource(false); setError(""); }} /></label>
      <p className="text-xs text-[var(--ink-muted)]">选择已有款式或开发版单，核对后带入当前表格，再按本次要求修改。</p>
      {busy && <p role="status" className="text-sm">正在查找款式…</p>}
      {loadingSource && <p role="status" className="text-sm">正在读取所选款式资料…</p>}
      <div className="grid max-h-[50vh] gap-3 overflow-y-auto sm:grid-cols-2">
        {results?.items.map(item => <button type="button" key={item.id} disabled={loadingSource} className="flex gap-3 rounded-xl border border-[var(--line)] p-3 text-left hover:bg-[var(--surface)] disabled:opacity-50" onClick={() => void choose(item.id)}>
          {item.imageSrc ? <Image src={item.imageSrc} alt={item.label} width={88} height={100} unoptimized className="h-24 w-20 shrink-0 rounded-lg object-contain" /> : <span className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg bg-[var(--field-solid)] text-xs text-[var(--ink-muted)]">暂无图片</span>}
          <span className="min-w-0"><span className="block text-sm font-medium">{item.label}</span><span className="mt-2 block text-xs text-[var(--ink-muted)]">{item.description}</span></span>
        </button>)}
      </div>
      {!busy && results && !results.items.length && <p className="text-sm">没有找到匹配的款式，试试名称中的一个字或部分编号。</p>}
      {results?.limited && <p className="text-xs text-[var(--ink-muted)]">当前各列最近20个开发款和款式，请输入关键词缩小范围。</p>}
    </>}
    {source && <>
      <Button type="button" variant="ghost" onClick={() => { ++requestNumber.current; setSource(null); setConfirmed(false); }}>返回款式库，换一款</Button>
      <div className="flex items-start gap-4">{source.imageSrc && <Image width={160} height={180} unoptimized src={source.imageSrc} alt="所选款式参考图" className="max-h-44 w-32 object-contain" />}<div className="min-w-0"><p className="font-medium">{source.label}</p>{source.notes.map(n => <p key={n} className="mt-2 text-xs text-[var(--ink-muted)]">{n}</p>)}</div></div>
      {source.choices.length > 0 && <label className="block text-sm">参考哪一版<select className={fieldClass} value={source.sourceId} onChange={e => void choose(e.target.value)}>{source.choices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>}
      {source.materials.length > 1 && <label className="block text-sm">参考哪种材料<select className={fieldClass} value={source.materialId} onChange={e => void choose(source.sourceId,e.target.value)}><option value="">请选择，不自动猜大身用料</option>{source.materials.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
      {!content.craftFamily && <label className="block text-sm">本次版单类型<select className={fieldClass} value={family} onChange={e => { const value=e.target.value as CraftFamily; setFamily(value); const selected=source.fields.filter(f => fieldFits(value,f) && !used(f)); setFields(selected); setScope(selected.map(f=>PATTERN_FIELDS[f]).join("、")); }}><option value="">请选择，不能仅凭款名判断</option>{Object.entries(CRAFT_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      {source.fields.length ? <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>带入</th><th>项目</th><th>当前表格</th><th>来源资料</th></tr></thead><tbody>{source.fields.map(f => <tr key={f}>
        <td><input type="checkbox" aria-label={`带入${PATTERN_FIELDS[f]}`} disabled={!!family && !fieldFits(family,f) || used(f)} checked={fields.includes(f)} onChange={e => { const selected=e.target.checked?[...fields,f]:fields.filter(k=>k!==f); setFields(selected); setScope(selected.map(k=>PATTERN_FIELDS[k]).join("、")); }} /></td><td className="py-2">{PATTERN_FIELDS[f]}{used(f) && <span className="block text-xs text-[var(--warning)]">已有参考来源，请先移除旧参考</span>}{family && !fieldFits(family,f) && <span className="block text-xs text-[var(--warning)]">与本单类型不兼容</span>}</td><td>{fieldValue(content,f) || "未填"}</td><td>{fieldValue(source.content,f)}</td>
      </tr>)}</tbody></table></div> : <p className="rounded-lg border border-[var(--line)] p-3 text-sm">{source.materials.length > 1 && !source.materialId ? "选定材料后，才会显示可以带入的参数。" : "这份来源没有已填写的技术参数。可说明参考部位，参数仍需手动填写。"}</p>}
      {source.canAttachImage && <label className="flex gap-2 text-sm"><input type="checkbox" checked={includeImage} onChange={e => setIncludeImage(e.target.checked)} />附入这张参考图，保存后随本版留存</label>}
      <label className="block text-sm">参考哪些部位或内容<input className={fieldClass} maxLength={400} value={scope} onChange={e => setScope(e.target.value)} placeholder="例如：纱线成分、支数；图片只参考领口" /></label>
      <label className="block text-sm">哪些不参考<input className={fieldClass} maxLength={400} value={exclusions} onChange={e => setExclusions(e.target.value)} placeholder="例如：不参考颜色与衣长" /></label>
      <p className="text-sm">选中 {fields.length} 项，{overwrite.length ? `其中 ${overwrite.length} 项将替换当前已填内容。` : "未选中的参数保持原值。"}带入后可在表格继续修改。</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => { e.stopPropagation(); setConfirmed(e.target.checked); }} />我已核对来源、参考范围和替换内容。</label>
      <Button type="button" disabled={!confirmed || !scope.trim() || !family || content.references.length >= 12} onClick={apply}>{fields.length ? `带入 ${fields.length} 项到版单` : "加入参考说明"}</Button>
      <p className="text-xs text-[var(--ink-muted)]">这里只填入当前草稿；修改完成后点“保存版单草稿”。</p>
    </>}
    {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
  </div>;
}
