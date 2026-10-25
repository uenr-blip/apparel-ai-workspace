/** @vitest-environment jsdom */
import { Blob as NodeBlob } from "node:buffer";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceInput } from "@/components/voice-input";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import { OrderAssistantForm } from "@/app/(app)/orders/order-assistant-form";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()})}));
vi.mock("@/components/catalog-compose",()=>({CatalogCompose:({children}:{children:ReactNode})=>createElement("div",null,children)}));
import { microphoneAvailability, microphoneFailure } from "@/lib/microphone";

let root:Root,host:HTMLDivElement;
const getUserMedia=vi.fn(),query=vi.fn(),network=vi.fn(),apply=vi.fn();
class Recorder {
  static instances:Recorder[]=[];
  state="inactive";mimeType="audio/webm";
  ondataavailable:((event:{data:Blob})=>void)|null=null;
  onstop:(()=>void)|null=null;
  onerror:(()=>void)|null=null;
  constructor(){Recorder.instances.push(this);}
  start(){this.state="recording";}
  stop(){this.state="inactive";this.ondataavailable?.({data:new Blob(["test audio"])});this.onstop?.();}
}
function media(){const stop=vi.fn();return {getTracks:()=>[{stop}],stop};}
async function click(text:string){const button=[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===text)!;expect(button,`button ${text}`).toBeTruthy();await act(async()=>{button.click();});}
beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("isSecureContext",true);
  vi.stubGlobal("navigator",{mediaDevices:{getUserMedia},permissions:{query}});
  vi.stubGlobal("MediaRecorder",Recorder);vi.stubGlobal("Blob",NodeBlob);vi.stubGlobal("fetch",network);
  getUserMedia.mockReset();query.mockReset().mockResolvedValue({state:"denied"});network.mockReset();apply.mockReset();Recorder.instances=[];
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(()=>root.render(createElement(VoiceInput,{onApply:apply})));
});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});

it("拒绝权限后给出恢复入口；重新检测只开关麦克风，不录音、不上传、不提交",async()=>{
  getUserMedia.mockRejectedValueOnce(new DOMException("blocked","NotAllowedError"));
  await click("语音输入");expect(host.textContent).toContain("当前浏览器或系统拦截");expect(host.textContent).toContain("隐私与安全性");
  const stream=media();getUserMedia.mockResolvedValueOnce(stream);await click("重新检测麦克风");
  expect(stream.stop).toHaveBeenCalledOnce();expect(host.textContent).toContain("麦克风已可用");expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(Recorder.instances).toHaveLength(0);expect(network).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
  expect([...host.querySelectorAll("button")].every(b=>b.type==="button")).toBe(true);
});

it("取消等待后晚到的授权立即释放，不启动录音也不覆盖新一次请求",async()=>{
  let resolveOld!:(value:ReturnType<typeof media>)=>void;
  getUserMedia.mockReturnValueOnce(new Promise(resolve=>{resolveOld=resolve;}));
  await click("语音输入");expect(host.textContent).toContain("等待麦克风授权");await click("取消等待");
  const current=media();getUserMedia.mockResolvedValueOnce(current);await click("语音输入");
  const late=media();await act(async()=>{resolveOld(late);});
  expect(late.stop).toHaveBeenCalledOnce();expect(current.stop).not.toHaveBeenCalled();expect(Recorder.instances).toHaveLength(1);
  expect(host.textContent).toContain("停止并转文字");await click("取消录音");expect(current.stop).toHaveBeenCalledOnce();expect(network).not.toHaveBeenCalled();
});

it("关闭入口后才获授权也释放设备，不在后台录音",async()=>{
  let resolve!:(value:ReturnType<typeof media>)=>void;getUserMedia.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
  await click("语音输入");await act(()=>root.render(null));const stream=media();await act(async()=>{resolve(stream);});
  expect(stream.stop).toHaveBeenCalledOnce();expect(Recorder.instances).toHaveLength(0);expect(network).not.toHaveBeenCalled();
});

it.each(["workspace","order"] as const)("%s 语音直接进入原输入框，保留边录边打的文字，手动点击才请求业务",async(kind)=>{
  const stream=media();getUserMedia.mockResolvedValue(stream);
  vi.stubGlobal("AudioContext",class {decodeAudioData=async()=>({duration:1});close=async()=>{};});
  vi.stubGlobal("OfflineAudioContext",class {destination={};createBufferSource=()=>({buffer:null,connect:()=>{},start:()=>{}});startRendering=async()=>({getChannelData:()=>new Float32Array([0,.1])});});
  let finishTranscription!:(value:unknown)=>void;
  network.mockImplementation((url:string)=>url==="/api/agents/transcribe"
    ? new Promise(resolve=>{finishTranscription=resolve;})
    : Promise.resolve({ok:true,json:async()=>({label:"测试配置"})}));
  await act(async()=>root.render(kind==="workspace"?createElement(BusinessAgentEntry,{module:"workspace"}):createElement(OrderAssistantForm)));
  async function edit(value:string){const input=host.querySelector("textarea")!;await act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
  await edit("给北岸建单");await click("语音输入");await click("停止并转文字");
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  await edit("给北岸建单，数量二十件");
  await act(async()=>{finishTranscription({ok:true,json:async()=>({text:"交期是十月二十日"})});});
  expect(host.querySelectorAll("textarea")).toHaveLength(1);
  expect(host.querySelector("textarea")!.value).toBe("给北岸建单，数量二十件\n交期是十月二十日");
  expect(host.textContent).not.toContain("核对后替换输入框内容");
  expect(host.textContent).toContain("语音文字已填入上方输入框");
  expect(network.mock.calls.filter(([,options])=>options?.method==="POST").map(([url])=>url)).toEqual(["/api/agents/transcribe"]);
  await edit("给北岸建单，数量二十件，交期改为十月二十一日");
  network.mockReturnValueOnce(new Promise(()=>{}));await click(kind==="workspace"?"开始核对":"找客户历史资料");
  const [url,options]=network.mock.calls.at(-1)!;
  expect(url).toBe(kind==="workspace"?"/api/agents":"/api/orders/assistant");
  expect(JSON.parse(options.body).text).toBe("给北岸建单，数量二十件，交期改为十月二十一日");
  expect(stream.stop).toHaveBeenCalledOnce();
});

it("设备缺失和占用各自提示，不误报未授权",async()=>{
  expect((await microphoneFailure(new DOMException("missing","NotFoundError"))).kind).toBe("device");
  expect((await microphoneFailure(new DOMException("busy","NotReadableError"))).kind).toBe("busy");
  query.mockResolvedValue({state:"granted"});expect((await microphoneFailure(new DOMException("system","NotAllowedError"))).message).toContain("网站已获许可");
  query.mockRejectedValue(new TypeError("unsupported permission"));expect((await microphoneFailure(new DOMException("denied","NotAllowedError"))).kind).toBe("permission");
});

it("不安全地址和窗口策略限制提前说明，不能靠伪造授权绕过",async()=>{
  vi.stubGlobal("isSecureContext",false);await click("语音输入");expect(host.textContent).toContain("HTTPS");expect(getUserMedia).not.toHaveBeenCalled();
  vi.stubGlobal("isSecureContext",true);
  Object.defineProperty(document,"permissionsPolicy",{configurable:true,value:{allowsFeature:()=>false}});
  try{expect(microphoneAvailability(true)?.kind).toBe("policy");}finally{Reflect.deleteProperty(document,"permissionsPolicy");}
});
