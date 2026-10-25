"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export function SampleReceipt({ projectId, sampleId }: { projectId:string;sampleId:string }) {
  const [key]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[error,setError]=useState("");const router=useRouter();
  return <div className="space-y-2"><Button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{const r=await fetch(`/api/projects/${projectId}/pattern-workflow`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"receive_sample",sampleId,idempotencyKey:key})});const data=await r.json();if(!r.ok)throw new Error(data.error);router.refresh();}catch(e){setError(e instanceof Error?e.message:"未能确认收到");}finally{setBusy(false);}}}>我已收到这份打样要求</Button>{error&&<p role="alert">{error}</p>}</div>;
}
