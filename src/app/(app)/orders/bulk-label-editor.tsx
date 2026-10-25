"use client";

import { useState } from "react";
import { CellImageEditor } from "./cell-image-editor";
import { BULK_LABEL_KEYS, BULK_PROCESS_KEYS, COLOR_TRIM_FIELDS, LABEL_COLOR_KEYS, SAME_AS_CARE, bulkMainLabel, labelColorText, specialProcessText, type BulkColor, type BulkSheet, type LabelColorKey } from "@/server/domain/merch-sheet";

const inputClass = "w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1 text-sm";

function LabelColor({ color, field, disabled, available, onChange }: { color: BulkColor; field: LabelColorKey; disabled: boolean; available: string[]; onChange: (value: string) => void }) {
  const [adding, setAdding] = useState(false), [custom, setCustom] = useState("");
  const value = color.labelColors?.[field] || "";
  const name = `${color.guestColor || "未填颜色"}的${COLOR_TRIM_FIELDS[field]}颜色`;
  const values = [...new Set(["黑色", "白色", ...available, value].filter(v => v && v !== SAME_AS_CARE))];
  return <div className="mb-2 space-y-1">
    <select className={inputClass} aria-label={name} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">选择颜色</option>
      {(field === "instructionLabel" || field === "spareLabel") ? <option value={SAME_AS_CARE}>同洗唛</option> : null}
      {values.map(v => <option key={v}>{v}</option>)}
    </select>
    {value === SAME_AS_CARE ? <p className="text-xs text-[var(--ink-muted)]">{labelColorText(color, field)}</p> : null}
    {!disabled && !adding ? <div className="flex gap-3"><button type="button" className="text-xs text-[var(--brand-strong)]" onClick={() => setAdding(true)}>＋ 增加颜色</button>{value && <button type="button" aria-label={`清空${name}`} className="text-xs text-[var(--ink-muted)] underline" onClick={() => onChange("")}>清空颜色</button>}</div> : null}
    {adding ? <div className="space-y-1"><input className={inputClass} aria-label={`${name}新增`} placeholder="例如：灰色、本白" maxLength={80} value={custom} disabled={disabled} onChange={e => setCustom(e.target.value)} /><div className="flex gap-3 text-xs"><button type="button" disabled={disabled || !custom.trim() || custom.trim() === SAME_AS_CARE} onClick={() => { onChange(custom.trim()); setAdding(false); setCustom(""); }}>添加并选用</button><button type="button" onClick={() => { setAdding(false); setCustom(""); }}>取消</button></div></div> : null}
  </div>;
}

export function BulkLabelEditor({ bulk, disabled, onMainLabel, onMainImages, onColor, onUploadChange }: { bulk: BulkSheet; disabled: boolean; onMainLabel: (value: string) => void; onMainImages: (images: string[]) => void; onColor: (index: number, patch: Partial<BulkColor>) => void; onUploadChange: (delta: number) => void }) {
  const available = bulk.colors.flatMap(c => Object.values(c.labelColors || {}));
  const legacyMain = bulk.colors.some(c => c.colorTrims?.mainLabel);
  const fields = [...BULK_LABEL_KEYS, ...BULK_PROCESS_KEYS];
  return <div id="follow-color-trims" className="mt-5 scroll-mt-24 space-y-3">
    <h4 className="font-medium">唛标、辅料与特殊工艺</h4>
    <label className="block max-w-xl text-sm">主唛 · 本款共用<textarea className={`${inputClass} mt-1`} rows={2} maxLength={800} aria-label="主唛 · 本款共用" placeholder="同款各颜色共用，只填一次" value={bulkMainLabel(bulk)} disabled={disabled} onChange={e => onMainLabel(e.target.value)} /></label>
    <CellImageEditor label="主唛 · 本款共用" images={bulk.pictures?.mainLabel} disabled={disabled} onChange={onMainImages} onUploadChange={onUploadChange} />
    {legacyMain ? <details className="text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer">查看原有每色主唛记录</summary><p>原记录有差异或缺项时，请核对后填写上方共用主唛。</p>{bulk.colors.map((c, i) => <p key={i}>{c.guestColor || `${i + 1} 行`}：{c.colorTrims?.mainLabel || "待补"}</p>)}</details> : null}
    <p className="text-xs text-[var(--ink-muted)]">主唛在本款这个 PO 内共用；其他批次分别保留。洗唛、尺码唛分别填，说明唛和备扣空白唛可选“同洗唛”或其他颜色。</p>
    <div className="overflow-x-auto"><table className="sheet-table trim-sheet color-trim-sheet text-sm"><thead><tr><th>客人颜色</th>{fields.map(key => <th key={key}>{COLOR_TRIM_FIELDS[key]}</th>)}</tr></thead>
      <tbody>{bulk.colors.map((color, index) => <tr key={index}><td>{color.guestColor || "颜色待补"}</td>{fields.map(key => <td key={key}>
        {LABEL_COLOR_KEYS.includes(key as LabelColorKey) ? <LabelColor color={color} field={key as LabelColorKey} disabled={disabled} available={available} onChange={value => onColor(index, { labelColors: { ...color.labelColors, [key]: value } })} /> : null}
        <textarea rows={2} maxLength={key === "specialProcess" ? 3000 : 800} className={`${inputClass} max-h-28 resize-y`} aria-label={`${color.guestColor || `${index + 1} 行`}的${COLOR_TRIM_FIELDS[key]}说明`} placeholder={key === "specialProcess" ? "贴布、绣花、印花、套结等要求" : "规格、颜色说明"} value={key === "specialProcess" ? specialProcessText(color) : color.colorTrims?.[key] || ""} disabled={disabled} onChange={e => onColor(index, { colorTrims: { ...color.colorTrims, [key]: e.target.value } })} />
        <CellImageEditor label={`${color.guestColor || `${index + 1} 行`}的${COLOR_TRIM_FIELDS[key]}`} images={color.pictures?.[key]} disabled={disabled} onChange={images => onColor(index, { pictures: { [key]: images } })} onUploadChange={onUploadChange} />
        {key === "careLabel" && color.colorTrims?.careSizeLabel ? <details className="mt-1 text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer">原洗唛 / 尺码唛合并说明</summary><p className="whitespace-pre-wrap">{color.colorTrims.careSizeLabel}</p><p>原文保留，请核对后分别填写。</p></details> : null}
      </td>)}</tr>)}</tbody>
    </table></div>
  </div>;
}
