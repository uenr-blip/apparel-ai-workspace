"use client";
import { patternEdition } from "@/lib/workflow-stage";
import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EditableChoice } from "@/components/editable-choice";
import { COMMON_PATTERN_CHOICES, PATTERN_PRICE_FIELDS, choiceIdentity, choicesForField, isPatternChoiceField, type PatternChoice, type PatternChoiceField, type PatternChoiceVisibility } from "@/lib/pattern-choices";
import { AgentResultTable } from "@/components/agent-result-table";
import { SheetPicture, NotedPictures } from "@/app/(app)/orders/sheet-picture";
import { PatternReferenceEditor } from "./pattern-reference-editor";
import { CRAFT_LABEL, PATTERN_ORIGIN_LABEL, type CraftFamily, type PatternOrigin } from "@/server/domain/craft-sheet";
import { PATTERN_FIELDS, patternDiff, type PatternBoard, type PatternContent, referenceInput, type SampleView } from "@/lib/pattern-workflow";
const fieldClass = "mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2 text-sm";
const labels: Record<string,string> = { ...PATTERN_FIELDS, "sweater.imageNote": "图注", "sweater.yarnSupplier": "纱线供应商（内部）", "sweater.yarnPrice": "纱线价格（内部）", "sweater.customYarnPrice": "定制纱价格（内部）", "fabric.imageNote": "图注", "fabric.supplier": "供应商（内部）", "fabric.price": "价格（内部）", "fabric.orderQtyPrice": "定数量和价格（内部）" };
type Run = (input: Record<string, unknown>, expected: string) => Promise<boolean>;
function Confirmation({ checked, onChange, disabled, text }: { checked: boolean; onChange: (v:boolean)=>void; disabled?: boolean; text: string }) { return <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>{ e.stopPropagation(); onChange(e.target.checked); }} />{text}</label>; }
export function PatternWorkspace({ initial, currentUserId, assignees }: { initial: PatternBoard; currentUserId: string; assignees: { id:string; name:string }[] }) {
  const router = useRouter();
  const [board,setBoard]=useState(initial), [draft,setDraft]=useState<PatternContent>(initial.content), [busy,setBusy]=useState(false), [message,setMessage]=useState(""), [error,setError]=useState("");
  const [reason,setReason]=useState(""), [confirmed,setConfirmed]=useState(false), [selectedRevision,setSelectedRevision]=useState(initial.revisions[0]?.id || "");
  const lastRequest = useRef<{ signature:string; key:string }|null>(null);
  const [choiceVisibility, setChoiceVisibility] = useState<PatternChoiceVisibility[]>([]);
  const [choiceEntries, setChoiceEntries] = useState<Partial<Record<PatternChoiceField, { value: string; supplier: string }>>>({});
  // Only a user's final, explicitly entered value can re-add a removed candidate.
  // Ordinary saves and partial typing must not bring old suggestions back.
  const visibilityChanges = [...choiceVisibility];
  for (const [field, entry] of Object.entries(choiceEntries)) {
    const { value } = entry;
    if (!isPatternChoiceField(field) || !value.trim()) continue;
    const family = draft.craftFamily === "sweater" ? "sweater" : "fabric";
    if (!draft.craftFamily || !field.startsWith(`${family}.`)) continue;
    if ((draft[family] as unknown as Record<string, string>)[field.split(".")[1]] !== value) continue;
    const supplier = family === "sweater" ? draft.sweater.yarnSupplier : draft.fabric.supplier;
    const identity = choiceIdentity(field, { value, supplier });
    if (identity !== choiceIdentity(field, entry)) continue;
    const original = choicesForField(board.choices ?? COMMON_PATTERN_CHOICES, field, supplier).find(row => choiceIdentity(field, row) === identity);
    const index = visibilityChanges.findIndex(row => choiceIdentity(row.field, row) === identity);
    if (index >= 0) visibilityChanges.splice(index, 1);
    if (original?.hidden) visibilityChanges.push({ field, value: original.value, supplier: original.supplier, hidden: false, expectedHidden: true });
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(board.content) || visibilityChanges.length > 0;
  const [initialStamp, setInitialStamp] = useState(initial.updatedAt);
  if (!busy && !dirty && initial.updatedAt !== initialStamp) { setInitialStamp(initial.updatedAt); setBoard(initial); setDraft(initial.content); setChoiceVisibility([]); setChoiceEntries({}); setConfirmed(false); }
  const group = draft.craftFamily === "sweater" ? "sweater" : "fabric";
  const base = board.revisions.find(r=>r.id===draft.baseRevisionId);
  const revision = board.revisions.find(r=>r.id===selectedRevision);
  const historyParent = board.revisions.find(r=>r.id===revision?.parentId);
  const historyChanges = revision && historyParent ? patternDiff(historyParent.content,revision.content) : [];
  const changes = base ? patternDiff(base.content,draft) : [];
  function change(next: PatternContent) { setDraft(next); setConfirmed(false); setMessage(""); }
  function removeChoice(field: PatternChoiceField, row: PatternChoice) {
    const identity = choiceIdentity(field,row);
    const original = (board.choices ?? COMMON_PATTERN_CHOICES)[field]?.find(c => choiceIdentity(field,c) === identity);
    const expectedHidden = original?.hidden ?? false;
    setChoiceEntries(previous => { const next = { ...previous }; delete next[field]; return next; });
    setChoiceVisibility(previous => [...previous.filter(c => choiceIdentity(c.field,c) !== identity), ...(!expectedHidden ? [{ field,value:row.value,supplier:row.supplier,hidden: true,expectedHidden }] : [])]);
    setConfirmed(false); setMessage("");
  }
  async function refresh() {
    const response = await fetch(`/api/projects/${board.projectId}/pattern-workflow`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "重新读取失败，请刷新页面");
    setBoard(data); setDraft(data.content); setChoiceVisibility([]); setChoiceEntries({}); setConfirmed(false); router.refresh();
  }
  async function post(url:string, body: Record<string,unknown>) {
    const signature = JSON.stringify({url,body});
    if (lastRequest.current?.signature !== signature) lastRequest.current={signature,key:crypto.randomUUID()};
    const response = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,idempotencyKey:lastRequest.current.key})});
    const data=await response.json(); if(!response.ok)throw new Error(data.error || "没有保存，请核对后重试");
    return data as {message:string};
  }
  async function save() {
    setBusy(true);setError("");setMessage("");
    try { const references=draft.references.map(referenceInput); const data=await post(`/api/projects/${board.projectId}/pattern-sheet`,{expectedUpdatedAt:board.updatedAt,contextStamp:board.contextStamp,craftFamily:draft.craftFamily,origin:draft.origin,originNote:draft.originNote,sweater:draft.sweater,fabric:draft.fabric,references,choiceVisibility:visibilityChanges,reason:reason||"修改草稿"}); await refresh();setMessage(data.message); }
    catch(e){setError(e instanceof Error?e.message:"连接中断，请核对结果后重试");}finally{setBusy(false);}
  }
  const run: Run=async(input,expected)=>{
    if(dirty){setError("请先保存或核对当前草稿，再处理版本与工厂记录");return false;}
    setBusy(true);setError("");setMessage("");
    try{const data=await post(`/api/projects/${board.projectId}/pattern-workflow`,{...input,expectedUpdatedAt:expected,contextStamp:board.contextStamp});await refresh();setMessage(data.message);return true;}
    catch(e){setError(e instanceof Error?e.message:"连接中断，请核对结果后重试");return false;}finally{setBusy(false);}
  };
  return <div className="space-y-5">
    <p className="text-sm">{base ? `当前草稿基于 V${base.number}；旧版及已发厂要求完整保留。` : "当前是未留档草稿；保存后可留为第一版。"} 保存版单不批准资料、不采购。</p>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">版单类型<select aria-label="版单类型" value={draft.craftFamily} className={fieldClass} onChange={e=>change({...draft,craftFamily:e.target.value as CraftFamily})}><option value="">请选择</option>{Object.entries(CRAFT_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm">这款从哪来<select value={draft.origin} className={fieldClass} onChange={e=>change({...draft,origin:e.target.value as PatternOrigin})}><option value="">还没写</option>{Object.entries(PATTERN_ORIGIN_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
      <label className="block text-sm">来源补充<input className={fieldClass} value={draft.originNote} maxLength={400} onChange={e=>change({...draft,originNote:e.target.value})}/></label>
      {draft.craftFamily && <SheetPicture label="本款款式图" imageSrc={draft[group].imagePath} disabled={busy} onChange={path=>change({...draft,[group]:{...draft[group],imagePath:path}})} />}
      <PatternReferenceEditor content={draft} onChange={change} disabled={busy}/>
      {draft.craftFamily && <>
      <p className="text-xs text-[var(--ink-muted)]">参数可选可填。候选右侧 × 可删除，重新填写并保存可再用。供应商名称先作参考；历史价格须核对本次条件。</p>
      <div className="grid gap-3 md:grid-cols-2">{Object.entries(labels).filter(([key])=>key.startsWith(`${group}.`)).map(([field,label])=>{
        const key=field.split(".")[1], value=(draft[group] as unknown as Record<string,string>)[key];
        const onChange=(value:string)=>change({...draft,[group]:{...draft[group],[key]:value}});
        if (isPatternChoiceField(field)) return <EditableChoice key={field} label={label} value={value} onChange={next=>{ onChange(next); setChoiceEntries(previous=>({...previous,[field]:{value:next,supplier:group === "sweater" ? draft.sweater.yarnSupplier : draft.fabric.supplier}})); }} onRemove={row=>removeChoice(field,row)} disabled={busy} price={PATTERN_PRICE_FIELDS.includes(field)} options={choicesForField(board.choices ?? COMMON_PATTERN_CHOICES,field,group === "sweater" ? draft.sweater.yarnSupplier : draft.fabric.supplier).map(row=>({...row,hidden:visibilityChanges.find(c=>choiceIdentity(c.field,c)===choiceIdentity(field,row))?.hidden ?? row.hidden}))}/>;
        return <label key={field} className="text-sm">{label}<input aria-label={label} className={fieldClass} maxLength={400} value={value} onChange={e=>onChange(e.target.value)}/></label>;
      })}<label className="text-sm">库存情况（须重新核对）<select className={fieldClass} value={draft[group].inStock} onChange={e=>change({...draft,[group]:{...draft[group],inStock:e.target.value}})}><option value="">还没问</option><option value="unknown">还不知道</option><option value="yes">有库存</option><option value="no">没有库存</option></select></label></div></>}
      <label className="block text-sm">本次修改说明<input className={fieldClass} value={reason} maxLength={400} onChange={e=>{setReason(e.target.value);setConfirmed(false);}} placeholder="例如：按第一版回样意见更换纱线"/></label>
      <div className="flex items-center gap-3"><Button type="button" disabled={busy||!draft.craftFamily} onClick={()=>void save()}>{busy?"正在处理…":"保存版单草稿"}</Button><span className="text-xs text-[var(--ink-muted)]">{dirty?"有未保存修改":"草稿已与保存记录对齐"}</span></div>
    </fieldset>
    {changes.length>0 && <AgentResultTable table={{title:`本次草稿与 V${base!.number} 的差异`,columns:["项目","原版","本次草稿"],rows:changes.map(c=>({cells:[c.label,c.before||"未填",c.after||"已清空"]})),emptyMessage:"内容未变"}}/>}
    {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}{message && <p role="status" className="text-sm text-[var(--ok)]">{message}</p>}
    <details className="rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer font-medium">版次留档与历史 · {board.revisions.length} 版</summary><div className="mt-4 space-y-4">
      <Confirmation checked={confirmed} onChange={setConfirmed} disabled={busy||dirty} text="我已核对保存内容与修改说明；留档不等于发厂或资料批准。"/>
      <Button type="button" disabled={busy||dirty||!confirmed||!reason.trim()} onClick={()=>void run({action:"freeze",reason,confirmed},board.updatedAt)}>留为{patternEdition((board.revisions[0]?.number??0)+1)}</Button>
      {board.revisions.length>0 && <><label className="block text-sm">查看历史版次<select className={fieldClass} value={selectedRevision} onChange={e=>{setSelectedRevision(e.target.value);setConfirmed(false);}}><option value="">请选择</option>{board.revisions.map(r=><option value={r.id} key={r.id}>{patternEdition(r.number)} · {r.reason}</option>)}</select></label>{revision && <>
        <p className="text-xs text-[var(--ink-muted)]">留档：{revision.createdByName} · {new Date(revision.createdAt).toLocaleString("zh-CN")} · {revision.parentId ? `基于 V${board.revisions.find(r=>r.id===revision.parentId)?.number??"历史版"}`:"首次留档"}</p>
        <AgentResultTable table={{title:`V${revision.number} 完整参数`,columns:["项目","留档值"],rows:historyRows(revision.content),emptyMessage:"没有资料"}}/>
        {historyChanges.length>0 && <AgentResultTable table={{title:`V${revision.number} 对比 V${historyParent!.number} 的留档变化`,columns:["项目","原版","本版"],rows:historyChanges.map(c=>({cells:[c.label,c.before||"未填",c.after||"已清空"]})),emptyMessage:"内容未变"}}/>}
        <div className="flex flex-wrap gap-2">{[revision.content.sweater.imagePath,revision.content.fabric.imagePath,...revision.content.references.flatMap(r=>r.images)].filter(Boolean).map((src,i)=><Image width={160} height={160} unoptimized key={`${src}-${i}`} src={src} alt={`V${revision.number} 留档图片`} className="h-28 w-28 object-contain"/>)}</div>
        <Button type="button" variant="outline" disabled={busy||dirty||!confirmed||!reason.trim()} onClick={()=>void run({action:"revise",revisionId:revision.id,reason,confirmed},board.updatedAt)}>从{patternEdition(revision.number)}准备修订草稿</Button><p className="text-xs text-[var(--ink-muted)]">会用这版内容替换当前草稿，替换前后也留记录；旧版和各厂打样要求保持不变。</p>
      </>}</>}
    </div></details>
    <details className="rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer font-medium">工厂打样与比较 · {board.samples.length} 条</summary><div className="mt-4 space-y-4">
      <p className="text-xs text-[var(--ink-muted)]">同版可交多家厂；版次与各厂打样轮次分开。报价条件不同不能直接比最低价。报价不产生应付或采购，评价不等于选定大货工厂。</p>
      <CreateSample board={board} run={run} disabled={busy||dirty}/>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["工厂 / 轮次","版次 / 负责人","报价","回样 / 评价","交接","处理"].map(t=><th key={t} className="whitespace-nowrap border-b border-[var(--line)] p-2">{t}</th>)}</tr></thead><tbody>{board.samples.map(s=><tr key={s.id}>
        <td className="p-2 align-top">{s.factoryName}<br/>第{s.round}次</td><td className="p-2 align-top">V{s.revisionNumber}<br/>{s.ownerName}</td><td className="p-2 align-top">打样费：{s.quote.sampleFee?`${s.quote.currency} ${s.quote.sampleFee}`:"待报价"}<br/>大货单价：{s.quote.unitPrice?`${s.quote.currency} ${s.quote.unitPrice}`:"待报价"}<br/><span className="text-xs text-[var(--ink-muted)]">数量：{s.quote.bulkQuantity||"待补"}；{s.quote.basis||"报价条件待补"}</span></td><td className="p-2 align-top">{s.feedback.returnedOn||"未登记回样"}<br/>{{pending:"待评价",rework:"建议重打",acceptable:"样衣可接受"}[s.feedback.review]}</td><td className="p-2 align-top">{s.receivedAt?"工厂已确认收到":s.issuedAt?"已发厂，待确认收到":"未发厂"}</td><td className="p-2 align-top"><Link className="underline" href={`/projects/${board.projectId}/samples/${s.id}`}>工厂版预览</Link></td>
      </tr>)}</tbody></table></div>
      {board.samples.length>1 && <p className="text-sm text-[var(--warning)]">{new Set(board.samples.map(s=>JSON.stringify([s.revisionId,s.quote.currency,s.quote.bulkQuantity,s.quote.basis,s.quantity]))).size>1 ? "各条记录的版次、数量或报价条件不同，请逐项核对。" : "版次与已填条件相同，仍需人工核对费用范围和样衣效果。"}</p>}
      {board.samples.map(s=><details key={`${s.id}-${s.updatedAt}`} className="border-t border-[var(--line)] pt-3"><summary className="cursor-pointer text-sm">{s.factoryName} · V{s.revisionNumber} · 第{s.round}次 · 查看或登记</summary><SampleEditor sample={s} currentUserId={currentUserId} assignees={assignees} run={run} disabled={busy||dirty}/></details>)}
    </div></details>
  </div>;
}
function CreateSample({ board, run, disabled }: { board:PatternBoard; run:Run; disabled:boolean }) {
  const [factoryId,setFactoryId]=useState(""),[revisionId,setRevisionId]=useState(""),[quantity,setQuantity]=useState("1"),[dueDate,setDueDate]=useState(""),[requirements,setRequirements]=useState(""),[confirmed,setConfirmed]=useState(false);
  return <details><summary className="cursor-pointer text-sm">准备一条工厂打样记录</summary><div className="mt-3 space-y-3" onChange={()=>setConfirmed(false)}><fieldset disabled={disabled} className="grid gap-3 md:grid-cols-2">
    <label className="text-sm">使用版次<select className={fieldClass} value={revisionId} onChange={e=>setRevisionId(e.target.value)}><option value="">请选择已留档版次</option>{board.revisions.map(r=><option key={r.id} value={r.id}>{patternEdition(r.number)} · {r.reason}</option>)}</select></label>
    <label className="text-sm">工厂<select className={fieldClass} value={factoryId} onChange={e=>setFactoryId(e.target.value)}><option value="">请选择</option>{board.factories.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <label className="text-sm">打样件数<input type="number" min="1" max="10000" className={fieldClass} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label className="text-sm">预计回样日期<input type="date" className={fieldClass} value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
    <label className="text-sm md:col-span-2">给工厂的补充说明<input maxLength={400} className={fieldClass} value={requirements} onChange={e=>setRequirements(e.target.value)} placeholder="例如：留意领口平整；改参数需另留版次"/></label>
  </fieldset><Confirmation checked={confirmed} onChange={setConfirmed} disabled={disabled} text="我负责这条打样记录，已核对工厂、版次、数量与说明；先准备记录，发厂前再核对。"/><Button type="button" variant="outline" disabled={disabled||!confirmed||!revisionId||!factoryId} onClick={()=>void run({action:"create_sample",revisionId,factoryId,quantity:Number(quantity),dueDate,requirements,confirmed},board.updatedAt).then(ok=>{if(ok)setConfirmed(false);})}>准备打样记录</Button></div></details>;
}
function SampleEditor({ sample, currentUserId, assignees, run, disabled }: { sample:SampleView; currentUserId:string; assignees:{id:string;name:string}[];run:Run;disabled:boolean }) {
  const [quote,setQuote]=useState(sample.quote),[feedback,setFeedback]=useState(sample.feedback),[opinion,setOpinion]=useState(sample.internalOpinion),[confirmed,setConfirmed]=useState(false),[ownerId,setOwnerId]=useState(""),[reason,setReason]=useState("");
  const owner=sample.ownerId===currentUserId, locked=disabled||!owner;
  const changed=JSON.stringify([quote,feedback,opinion])!==JSON.stringify([sample.quote,sample.feedback,sample.internalOpinion]);
  return <div className="mt-3 space-y-3" onChange={()=>setConfirmed(false)}>
    <p className="text-xs text-[var(--ink-muted)]">负责人：{sample.ownerName}。发厂后版次和要求固定；改要求请另建对应新版的打样记录。</p>
    <p className="text-sm">V{sample.revisionNumber} · {sample.quantity}件 · 预计回样：{sample.dueDate||"待确认"} · 要求：{sample.requirements||"按本版完整要求"}</p>
    <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">{Object.entries({sampleFee:"打样费",unitPrice:"大货单价",currency:"币种（如 CNY）",quotedOn:"报价日期",bulkQuantity:"大货报价对应数量",basis:"报价条件（用料、工艺和费用范围）"}).map(([key,label])=><label key={key} className="text-sm">{label}<input className={fieldClass} type={key==="quotedOn"?"date":"text"} maxLength={400} value={quote[key as keyof typeof quote]} onChange={e=>setQuote({...quote,[key]:key==="currency"?e.target.value.toUpperCase():e.target.value})}/></label>)}
      <label className="text-sm">实际回样日期<input type="date" className={fieldClass} value={feedback.returnedOn} onChange={e=>setFeedback({...feedback,returnedOn:e.target.value})}/></label><label className="text-sm">内部回样评价<select className={fieldClass} value={feedback.review} onChange={e=>setFeedback({...feedback,review:e.target.value as typeof feedback.review})}><option value="pending">待评价</option><option value="rework">建议重打</option><option value="acceptable">样衣可接受</option></select></label>
      <label className="text-sm">评价依据<input className={fieldClass} maxLength={400} value={feedback.reviewNote} onChange={e=>setFeedback({...feedback,reviewNote:e.target.value})}/></label><label className="text-sm">内部比较意见<input className={fieldClass} maxLength={400} value={opinion} onChange={e=>setOpinion(e.target.value)}/></label>
    </fieldset>
    <NotedPictures label="回样照片与工厂意见" text={feedback.factoryNote} images={feedback.images} disabled={locked} onText={value=>{setFeedback({...feedback,factoryNote:value});setConfirmed(false);}} onImages={images=>{setFeedback({...feedback,images});setConfirmed(false);}}/>
    <Confirmation checked={confirmed} onChange={setConfirmed} disabled={locked} text="我已核对本条打样记录和工厂版预览。保存报价与评价不等于财务记账、选定大货工厂或批准投产。"/>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked||!confirmed} onClick={()=>void run({action:"update_sample",sampleId:sample.id,quote,feedback,internalOpinion:opinion,confirmed},sample.updatedAt)}>保存报价与回样</Button>{!sample.issuedAt && <Button type="button" variant="outline" disabled={locked||!confirmed||changed} onClick={()=>void run({action:"issue_sample",sampleId:sample.id,confirmed},sample.updatedAt)}>核对预览后，在系统内发给工厂</Button>}</div>
    <p className="text-xs text-[var(--ink-muted)]">发厂前请打开上方工厂版预览。系统内发厂后指定工厂账号可查看，不发送微信或邮件；工厂确认收到后才显示回执。</p>
    {owner && <details><summary className="cursor-pointer text-xs">更换负责人</summary><div className="mt-2 space-y-2"><select aria-label="新的打样负责人" className={fieldClass} value={ownerId} onChange={e=>setOwnerId(e.target.value)}><option value="">选择接手人</option>{assignees.filter(u=>u.id!==sample.ownerId).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select><input aria-label="交接原因" className={fieldClass} maxLength={400} value={reason} onChange={e=>setReason(e.target.value)} placeholder="交接原因"/><Button type="button" variant="outline" disabled={locked||!confirmed||!ownerId||!reason||changed} onClick={()=>void run({action:"reassign_sample",sampleId:sample.id,ownerId,reason,confirmed},sample.updatedAt)}>确认交接负责人</Button></div></details>}
  </div>;
}

function historyRows(content: PatternContent) {
  const group = content.craftFamily === "sweater" ? "sweater" : "fabric";
  const rows = [
    {cells:["类型", CRAFT_LABEL[content.craftFamily as CraftFamily] || "未选择"]},
    {cells:["来源", content.origin ? PATTERN_ORIGIN_LABEL[content.origin] : "未填"]},
    {cells:["来源说明", content.originNote || "未填"]},
    ...Object.entries(labels).filter(([f])=>f.startsWith(`${group}.`)).map(([f,label])=>({cells:[label,(content[group] as unknown as Record<string,string>)[f.split(".")[1]] || "未填"]})),
    {cells:["当时库存标记（本次仍须核对）", ({yes:"有库存",no:"没有库存",unknown:"还不知道","":"未填"})[content[group].inStock]]},
  ];
  for (const ref of content.references) {
    rows.push({cells:[`参考：${ref.sourceLabel || ref.label}`, `${ref.scope}；不参考：${ref.exclusions || "未注明"}`]});
    for (const field of ref.fields) {
      const [g,k] = field.split(".");
      rows.push({cells:[`参考${PATTERN_FIELDS[field]}`, `来源原值：${ref.sourceValues[field] || "未记录"}；本版值：${(content[g as "sweater"|"fabric"] as unknown as Record<string,string>)[k] || "未填"}`]});
    }
  }
  return rows;
}
