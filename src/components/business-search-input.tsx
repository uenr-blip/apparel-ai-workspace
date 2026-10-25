"use client";
import { useEffect,useId,useRef,useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SEARCH_KINDS,SEARCH_LABELS,searchHref,searchQuery,type SearchResult } from "@/lib/business-search";

export function BusinessSearchInput({defaultValue="",placeholder="名称或编号，输入一个字也能找",label="检索",className="",name="q"}:{defaultValue?:string;placeholder?:string;label?:string;className?:string;name?:string}) {
 const router=useRouter(),id=useId(),root=useRef<HTMLDivElement>(null),generation=useRef(0);
 const [value,setValue]=useState(defaultValue),[open,setOpen]=useState(false),[composing,setComposing]=useState(false),[result,setResult]=useState<SearchResult|null>(null),[error,setError]=useState(""),[selected,setSelected]=useState(-1);
 const query=searchQuery(value),shown=result?.query===query&&!composing?result:null;
 const ordered=SEARCH_KINDS.flatMap(kind=>shown?.items.filter(i=>i.kind===kind) || []);
 useEffect(()=>{
  const controller=new AbortController(),seq=++generation.current;
  if(!query||composing||!open)return()=>controller.abort();
  const timer=setTimeout(()=>{void fetch(`/api/search?q=${encodeURIComponent(query)}`,{signal:controller.signal,cache:"no-store"}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||"查询失败");if(seq===generation.current){setResult(data);setError("");}}).catch(e=>{if(seq===generation.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:"暂时查不到，请重试");});},180);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,composing,open]);
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener("pointerdown",outside);return()=>document.removeEventListener("pointerdown",outside);},[]);
 const expanded=open&&!!query&&!composing;
 return <div ref={root} className={`relative min-w-0 ${className}`}>
  <label className="block text-sm"><span className="mb-1 block text-xs text-[var(--ink-muted)]">{label}</span><input role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`} aria-activedescendant={selected>=0&&ordered[selected]?`${id}-item-${selected}`:undefined} aria-label={label} name={name} value={value} maxLength={100} autoComplete="off" placeholder={placeholder} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm" onFocus={()=>setOpen(true)} onChange={e=>{setValue(e.target.value);setSelected(-1);setError("");setOpen(true);}} onCompositionStart={()=>{setComposing(true);setSelected(-1);}} onCompositionEnd={e=>{setComposing(false);setValue(e.currentTarget.value);}} onKeyDown={e=>{
    if(e.nativeEvent.isComposing||composing)return;
    if(e.key==="Escape"){setOpen(false);setSelected(-1);e.preventDefault();}
    if(expanded&&ordered.length&&(e.key==="ArrowDown"||e.key==="ArrowUp")){e.preventDefault();setSelected(n=>e.key==="ArrowDown"?(n+1)%ordered.length:(n-1+ordered.length)%ordered.length);}
    if(e.key==="Enter"&&expanded&&selected>=0&&ordered[selected]){e.preventDefault();setOpen(false);router.push(ordered[selected].href);}
    if(e.key==="Tab")setOpen(false);
  }}/></label>
  {expanded&&<div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[min(65vh,480px)] overflow-y-auto overscroll-contain rounded-xl border border-[var(--line)] bg-[var(--field-solid)] p-2 shadow-xl">
   {!shown&&!error&&<p role="status" className="p-2 text-sm text-[var(--ink-muted)]">正在查找…</p>}{error&&<p role="status" className="p-2 text-sm text-[var(--danger)]">{error}</p>}
   <div role="listbox" aria-label="匹配的业务资料" id={`${id}-results`}>{SEARCH_KINDS.map(kind=>{const items=shown?.items.filter(i=>i.kind===kind)||[];if(!items.length)return null;return <div role="group" aria-label={SEARCH_LABELS[kind]} key={kind} className="mb-2"><p className="px-2 py-1 text-xs text-[var(--ink-muted)]">{SEARCH_LABELS[kind]} · {shown?.counts[kind] || 0} 条</p>{items.map(item=>{const index=ordered.indexOf(item);return <button key={`${kind}-${item.id}`} id={`${id}-item-${index}`} role="option" aria-selected={selected===index} type="button" className={`block w-full rounded-lg p-2 text-left text-sm hover:bg-[var(--brand-soft)] ${selected===index?"bg-[var(--brand-soft)]":""}`} onMouseDown={e=>e.preventDefault()} onClick={()=>{setOpen(false);router.push(item.href);}}><span className="font-medium">{item.code} {item.name}</span>{item.detail&&<span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{item.detail}</span>}</button>;})}</div>;})}</div>
   {shown?.total===0&&<p className="p-2 text-sm text-[var(--ink-muted)]">没有匹配的可见资料，可继续输入或换个字。</p>}
   {shown&&<Link className="block border-t border-[var(--line)] px-2 py-3 text-sm text-[var(--brand-strong)]" href={searchHref(query)} onClick={()=>setOpen(false)}>查看全部匹配 · {shown.total} 条 →</Link>}
  </div>}
 </div>;
}
