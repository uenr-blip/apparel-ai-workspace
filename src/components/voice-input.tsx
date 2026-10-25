"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { encodeMonoWav } from "@/lib/audio-wav";
import { microphoneAvailability, microphoneFailure, type MicrophoneIssue } from "@/lib/microphone";

type Phase = "idle" | "permission" | "recording" | "transcribing";

export function VoiceInput({ disabled=false,onApply }:{disabled?:boolean;onApply:(text:string)=>void}) {
  const [phase,setPhase]=useState<Phase>("idle"),[error,setError]=useState("");
  const [issue,setIssue]=useState<MicrophoneIssue|null>(null),[notice,setNotice]=useState(""),[help,setHelp]=useState(false),[pageUrl,setPageUrl]=useState("");
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const alive=useRef(true),operation=useRef(0),active=useRef(false),abort=useRef<AbortController|null>(null);

  const release=useCallback(()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;},[]);
  const stopResources=useCallback(()=>{abort.current?.abort();abort.current=null;if(recorder.current?.state==="recording")recorder.current.stop();recorder.current=null;release();},[release]);
  useEffect(()=>{alive.current=true;const requests=operation;return()=>{alive.current=false;++requests.current;active.current=false;stopResources();};},[stopResources]);
  function cancel(){++operation.current;active.current=false;stopResources();setPhase("idle");setNotice("已取消，没有上传录音。");}

  async function start(checkOnly=false){
    if(active.current||disabled)return;
    active.current=true;
    const token=++operation.current,isCurrent=()=>alive.current&&operation.current===token;
    setError("");setIssue(null);setNotice("");setPhase("permission");
    const unavailable=microphoneAvailability(!checkOnly);
    if(unavailable){active.current=false;setPhase("idle");setIssue(unavailable);setHelp(true);return;}
    try{
      // Keep the permission request in the click's user activation.
      const media=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!isCurrent()){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;
      if(checkOnly){release();active.current=false;setPhase("idle");setNotice("麦克风已可用。检测已结束，没有录音或上传；可以点“语音输入”开始说话。");return;}
      const rec=new MediaRecorder(media),parts:Blob[]=[];recorder.current=rec;
      rec.ondataavailable=e=>{if(isCurrent()&&e.data.size)parts.push(e.data);};
      rec.onerror=()=>{
        if(!isCurrent())return;
        ++operation.current;active.current=false;stopResources();setPhase("idle");setError("录音中断，请检查麦克风后重试。");
      };
      rec.onstop=async()=>{
        if(!isCurrent())return;
        release();recorder.current=null;setPhase("transcribing");
        try{
          if(!parts.length)throw new Error("没有录到声音，请重试。");
          const decoder=new AudioContext();let audio:AudioBuffer;
          try{audio=await decoder.decodeAudioData(await new Blob(parts,{type:rec.mimeType}).arrayBuffer());}finally{await decoder.close();}
          if(!isCurrent())return;
          if(audio.duration>31)throw new Error("录音最长30秒，请分段输入");
          if(!audio.duration)throw new Error("没有录到声音，请重试。");
          const offline=new OfflineAudioContext(1,Math.ceil(audio.duration*16000),16000),source=offline.createBufferSource();
          source.buffer=audio;source.connect(offline.destination);source.start();const pcm=await offline.startRendering();
          if(!isCurrent())return;
          abort.current=new AbortController();
          const response=await fetch("/api/agents/transcribe",{method:"POST",headers:{"Content-Type":"audio/wav"},body:encodeMonoWav(pcm.getChannelData(0)),signal:abort.current.signal});
          const data=await response.json();if(!response.ok)throw new Error(data.error||"转写未完成，请重试。");
          if(typeof data.text!=="string"||!data.text.trim())throw new Error("没有识别到清晰语音，请重录或打字。");
          if(isCurrent()){
            onApply(data.text.trim());
            setNotice("语音文字已填入上方输入框，请核对款号、数量和日期后再提交。");
          }
        }catch(e){if(isCurrent())setError(e instanceof Error?e.message:"转写未完成");}
        finally{if(isCurrent()){active.current=false;abort.current=null;setPhase("idle");}}
      };
      rec.start();setPhase("recording");timer.current=setTimeout(()=>{if(isCurrent()&&rec.state==="recording")rec.stop();},30000);
    }catch(e){
      if(!isCurrent())return;
      release();
      const diagnosis=await microphoneFailure(e);
      if(isCurrent()){active.current=false;setPhase("idle");setIssue(diagnosis);setHelp(true);}
    }
  }

  async function copyAddress(){
    const url=window.location.href;setPageUrl(url);
    try{await navigator.clipboard.writeText(url);setNotice("网址已复制。请粘贴到 Safari 或 Chrome 的地址栏打开。");}
    catch{setNotice("请选中下方网址复制，再到 Safari 或 Chrome 打开。");}
  }
  const recording=phase==="recording",busy=phase!=="idle"&&!recording;
  return <div className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled||busy} onClick={()=>recording?recorder.current?.stop():void start()}>{recording?<Square size={14}/>:<Mic size={14}/>} {recording?"停止并转文字":phase==="permission"?"等待麦克风授权…":phase==="transcribing"?"正在转写…":"语音输入"}</Button>
      {phase==="permission"||recording?<Button type="button" variant="ghost" size="sm" onClick={cancel}>{recording?"取消录音":"取消等待"}</Button>:null}
      <button type="button" className="text-xs text-[var(--ink-muted)] underline underline-offset-4" aria-expanded={help} onClick={()=>setHelp(!help)}>麦克风设置与检测</button>
    </div>
    <p className="text-xs text-[var(--ink-muted)]">最长30秒。录音发送至百炼转文字，结果直接填入上方输入框，可修改后再提交。</p>
    {issue?<p role="alert" className="text-[var(--danger)]">{issue.message}</p>:null}
    {help?<div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--field-solid)] p-3 text-xs leading-relaxed">
      <p className="font-medium">开启麦克风后，回来重新检测</p>
      <ol className="list-decimal space-y-1 pl-4">
        <li>Mac：系统设置 → 隐私与安全性 → 麦克风，开启当前使用的应用。在 Codex 内打开时检查 Codex；在浏览器中打开时检查对应浏览器。系统提示重新打开应用时，先保存手头内容再重开。</li>
        <li>浏览器：在地址栏的网站权限中，把当前网站的麦克风改为“允许”。页面弹出申请时选择“允许”。</li>
        <li>如果内置窗口没有权限入口，或开启系统权限后仍被拦截，把当前网址复制到 Safari 或 Chrome 打开，再按提示允许麦克风。</li>
      </ol>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" disabled={disabled||phase!=="idle"} onClick={()=>void start(true)}>重新检测麦克风</Button><Button type="button" variant="outline" size="sm" onClick={()=>void copyAddress()}>复制当前网址</Button></div>
      <p className="text-[var(--ink-muted)]">检测只短暂打开麦克风后立即关闭，不录制、不上传，也不调用语音模型。</p>
      {pageUrl?<input aria-label="当前页面网址" readOnly value={pageUrl} onFocus={e=>e.currentTarget.select()} className="w-full rounded border border-[var(--line)] bg-[var(--field-solid)] p-2"/>:null}
    </div>:null}
    {notice?<p role="status" className="text-xs text-[var(--ink-muted)]">{notice}</p>:null}
    {error?<p role="alert" className="text-[var(--danger)]">{error}</p>:null}
  </div>;
}
