"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CONSTRUCTION_FIELDS, CONSTRUCTION_LABELS, CONSTRUCTION_OPTIONS, GROUP_FIELDS, type ConstructionItem, type ConstructionGroup, type ConstructionMaterialChoice } from "@/lib/style-construction";
import styles from "./style-construction.module.css";
import type { ConstructionReference } from "@/lib/construction-reference";
import { CellThumbs } from "@/app/(app)/orders/sheet-picture";

export function constructionImageUrl(styleId: string, versionId: string, key: string) { return `/api/styles/${styleId}/construction/${versionId}/${encodeURIComponent(key)}`; }

function ItemImage({ item, initialUrl, onRemove }: { item: ConstructionItem; initialUrl?: string; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  const src = preview || (item.imageId ? initialUrl : item.useMaterialImage && item.materialId ? `/api/materials/${item.materialId}/image` : "");
  return <div className={styles.imageControl}>
    {src ? <a href={src} target="_blank" rel="noreferrer" aria-label={`查看 ${item.name} 图片`}><Image src={src} width={54} height={54} unoptimized alt={`${item.name}参考图`} className="mx-auto h-[54px] w-[54px] cursor-zoom-in rounded object-contain" /></a> : null}
    <label className={styles.imageButton} title={`为 ${item.name || CONSTRUCTION_LABELS[item.group]} 添加图片`}>
      <span aria-hidden>{src ? "换图" : "＋"}</span>
      <input ref={input} className={styles.fileInput} type="file" name={`construction-image-${item.key}`} accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-label={`${item.name || CONSTRUCTION_LABELS[item.group]}图片`} onChange={e => {
        const next = e.target.files?.[0];
        if (!next) return;
        if (next.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(next.type)) { setError("请选择 5MB 内的 JPG / PNG"); e.target.value = ""; setPreview(""); return; }
        setError(""); setPreview(URL.createObjectURL(next));
      }} />
    </label>
    <span className={styles.muted}>{src ? "小图可放大" : "添加图片"}</span>
    {src ? <button type="button" className={styles.textButton} onClick={() => { setPreview(""); if (input.current) input.current.value = ""; onRemove(); }}>移除图片</button> : null}
    {error ? <span role="alert" className={styles.error}>{error}</span> : null}
  </div>;
}

export type { ConstructionMaterialChoice } from "@/lib/style-construction";
export function StyleConstructionFields({ initial = [], styleId, versionId, imageBaseUrl, materials = [] }: { initial?: ConstructionItem[]; styleId?: string; versionId?: string; imageBaseUrl?: string; materials?: ConstructionMaterialChoice[] }) {
  const [rows, setRows] = useState<ConstructionItem[]>(initial);
  function add(group: ConstructionGroup, name = "") {
    if (rows.length >= 60) return;
    setRows(current => [...current, { key: crypto.randomUUID(), group, name, fields: group === "process" ? {} : { unit: group === "fabric" ? "m" : group === "yarn" ? "kg" : "pcs" } }]);
  }
  function update(key: string, change: Partial<ConstructionItem>) { setRows(current => current.map(r => r.key === key ? { ...r, ...change } : r)); }
  function group(group: ConstructionGroup) {
    const items = rows.filter(r => r.group === group);
    return <div className={styles.group} key={group}>
      <div className={styles.groupHeader}><h4>{CONSTRUCTION_LABELS[group]} <span className={styles.count}>{items.length}</span></h4><button type="button" className={styles.addButton} disabled={rows.length >= 60} onClick={() => add(group)}>＋ {group === "fabric" || group === "yarn" ? `添加${CONSTRUCTION_LABELS[group]}` : "自定义"}</button></div>
      {group !== "process" && materials.length ? <label className="block text-sm">从面辅料库选用<select aria-label={`从库选择${CONSTRUCTION_LABELS[group]}`} value="" className="ml-2 max-w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2" disabled={rows.length >= 60} onChange={e => {
        const material = materials.find(m => m.id === e.target.value); if (!material) return;
        setRows(current => [...current, { key: crypto.randomUUID(), group, name: material.name, materialId: material.id, useMaterialImage: material.hasImage, fields: { unit: material.unit, composition: material.composition, gsm: material.gsm, width: material.widthCm, specification: material.specSummary } }]);
      }}><option value="">选择已有材料…</option>{materials.filter(m => m.kind === (group === "fabric" || group === "yarn" ? group : "trim") && !rows.some(r => r.materialId === m.id)).map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></label> : null}
      {CONSTRUCTION_OPTIONS[group].length ? <div className={styles.options} aria-label={`${CONSTRUCTION_LABELS[group]}建议选项`}>{CONSTRUCTION_OPTIONS[group].map(name => <button key={name} type="button" disabled={rows.length >= 60} onClick={() => add(group, name)}>＋ {name}</button>)}</div> : null}
      {!items.length ? <p className={styles.empty}>{group === "fabric" || group === "yarn" ? `按实际需要添加，可填写多种${CONSTRUCTION_LABELS[group]}。` : "点选一项就增加一项；没有合适的可自定义。"}</p> : null}
      {items.map((item, index) => <fieldset className={styles.item} key={item.key}>
        <legend>{CONSTRUCTION_LABELS[group]} {index + 1}</legend>
        <div className={styles.itemTop}>
          <label className={styles.name}>名称<input required maxLength={120} placeholder={group === "process" ? "如：胸前绣花" : "填写名称"} value={item.name} onChange={e => update(item.key, { name: e.target.value })} /></label>
          <ItemImage key={`${item.key}:${item.materialId ?? "new"}`} item={item} initialUrl={imageBaseUrl ? `${imageBaseUrl}/${encodeURIComponent(item.key)}` : styleId && versionId ? constructionImageUrl(styleId, versionId, item.key) : undefined} onRemove={() => update(item.key, { imageId: undefined, useMaterialImage: false })} />
          <button className={styles.textButton} type="button" aria-label={`移除${CONSTRUCTION_LABELS[group]} ${index + 1}`} onClick={() => setRows(current => current.filter(r => r.key !== item.key))}>移除项目</button>
        </div>
        {group !== "process" && materials.length ? <label className="mt-3">替换为库中材料
          <select aria-label={`替换${item.name || CONSTRUCTION_LABELS[group]}`} value="" onChange={e => {
            const material = materials.find(m => m.id === e.target.value); if (!material) return;
            update(item.key, { name: material.name, materialId: material.id, imageId: undefined, useMaterialImage: material.hasImage, fields: { position: item.fields.position, unit: material.unit, composition: material.composition, gsm: material.gsm, width: material.widthCm, specification: material.specSummary } });
          }}><option value="">选择替换材料（单耗、颜色需重新核对）…</option>{materials.filter(m => m.kind === (group === "fabric" || group === "yarn" ? group : "trim") && !rows.some(r => r.materialId === m.id)).map(m => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select>
        </label> : null}
        <div className={styles.fields}>{GROUP_FIELDS[group].map(field => <label key={field} className={field === "notes" ? styles.wide : undefined}>
          {CONSTRUCTION_FIELDS[field]}
          {field === "notes" ? <textarea rows={2} maxLength={2000} value={item.fields[field] || ""} onChange={e => update(item.key, { fields: { ...item.fields, [field]: e.target.value } })} placeholder="可后补，填写本款要求" /> : field === "unit" ? <select value={item.fields.unit || ""} onChange={e => update(item.key, { fields: { ...item.fields, unit: e.target.value } })}>
            {[...new Set([item.fields.unit || "m", "m", "kg", "g", "pcs", "pair", "set", "cm"])].map(unit => <option value={unit} key={unit}>{{ m: "米", kg: "千克", g: "克", pcs: "个 / 件", pair: "对", set: "套", cm: "厘米" }[unit] || unit}</option>)}
          </select> : <input maxLength={300} inputMode={field === "consumption" ? "decimal" : "text"} value={item.fields[field] || ""} onChange={e => update(item.key, { fields: { ...item.fields, [field]: e.target.value } })} placeholder={field === "consumption" ? "未确认可留空" : "可后补"} />}
        </label>)}</div>
      </fieldset>)}
    </div>;
  }
  return <div className={styles.root}>
    <input type="hidden" name="construction" value={JSON.stringify(rows)} />
    <section className={styles.section}><h3>02 <span>面料与纱线</span></h3><p className={styles.hint}>面料、纱线分别留档；未确认的单耗留空，保存后仍需核对。</p>{group("fabric")}{group("yarn")}</section>
    <section className={styles.section}><h3>03 <span>辅料</span></h3><p className={styles.hint}>以下为可调整的建议分类，每项可独立填写规格、用量和图片。</p>{group("regularTrim")}{group("customTrim")}</section>
    <section className={styles.section}><h3>04 <span>特殊工艺</span></h3><p className={styles.hint}>写清位置、尺寸和要求，图片用来补充说明。</p>{group("process")}</section>
    <p className={styles.hint}>新填面料、纱线和辅料保存后进入同一个面辅料库；替换或改规格只用于本份资料，原材料仍保留。每项可配一张 JPG / PNG（5MB 内），合计不超过 20MB。保存资料不会采购或批准投产。</p>
  </div>;
}

export function StyleConstructionSummary({ rows, styleId = "", versionId = "", imageBaseUrl, references = [] }: { rows: ConstructionItem[]; styleId?: string; versionId?: string; imageBaseUrl?: string; references?: ConstructionReference[] }) {
  const imageUrl = (item: ConstructionItem) => !item.imageId && item.useMaterialImage && item.materialId ? `/api/materials/${item.materialId}/image` : imageBaseUrl ? `${imageBaseUrl}/${encodeURIComponent(item.key)}` : constructionImageUrl(styleId, versionId, item.key);
  return <div className={styles.root}>{(["fabric", "yarn", "regularTrim", "customTrim", "process"] as ConstructionGroup[]).map(group => {
    const items = rows.filter(r => r.group === group);
    return <section className={styles.readGroup} key={group}><h4>{CONSTRUCTION_LABELS[group]} <span className={styles.count}>{items.length}</span></h4>
      {!items.length ? <p className={styles.empty}>尚未填写</p> : <div className={styles.readGrid}>{items.map((item, i) => <article className={styles.readItem} key={item.key}>
        {(item.imageId || item.useMaterialImage) ? <a href={imageUrl(item)} target="_blank" rel="noreferrer" aria-label={`查看 ${item.name} 图片`}><Image loading="lazy" width={64} height={76} unoptimized src={imageUrl(item)} alt={`${item.name}参考图`} /></a> : null}
        <div><h5><span>{CONSTRUCTION_LABELS[group]} {i + 1}</span> {item.name}</h5><dl>{GROUP_FIELDS[group].filter(f => item.fields[f]).map(f => <div key={f}><dt>{CONSTRUCTION_FIELDS[f]}</dt><dd>{item.fields[f]}</dd></div>)}</dl></div>
      </article>)}</div>}
    </section>;
  })}{references.length ? <section className={styles.readGroup}><h4>随交接保留的原表说明与图片</h4><p className={styles.hint}>以下按来源原文保留；尚未分项的内容可在上方用料与工艺中整理，不能据此自动认定材料、单耗或批准。</p><div className={styles.readGrid}>{references.map((r, i) => <article className={styles.readItem} key={i}><div><h5>{r.label}</h5><p className="whitespace-pre-wrap break-words text-sm">{r.text}</p><CellThumbs images={r.images} label={r.label} /></div></article>)}</div></section> : null}</div>;
}
