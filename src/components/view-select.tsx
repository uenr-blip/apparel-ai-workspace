"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
export function ViewSelect({label,value,options}:{label:string;value:string;options:Array<{href:string;label:string}>}) {
  const router=useRouter(),[pending,startTransition]=useTransition();
  return <label className="inline-flex items-center gap-2 text-sm"><span className="text-[var(--ink-muted)]">{label}</span><select aria-label={label} value={value} disabled={pending} onChange={e=>{const href=e.target.value;if(options.some(o=>o.href===href))startTransition(()=>router.push(href,{scroll:false}));}} className="max-w-full rounded-lg border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2">{options.map(o=><option key={o.href} value={o.href}>{o.label}</option>)}</select>{pending?<span role="status" className="text-xs">更新中…</span>:null}</label>;
}
