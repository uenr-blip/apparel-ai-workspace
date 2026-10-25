/** @vitest-environment jsdom */
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
import { BusinessSearchInput } from "@/components/business-search-input";
const {push}=vi.hoisted(()=>({push:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push})}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);push.mockClear();});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function type(value:string){const input=host.querySelector("input")!;await act(()=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});return input;}
const response=(q:string)=>({ok:true,json:async()=>({query:q,items:[{id:q,kind:"project",code:q,name:"匹配开发款",detail:"",href:`/projects/${q}`}],counts:{project:1},total:1,page:1,pageCount:1,pageSize:6})});
it("输入一个字显示候选；中文组词期间不查；方向键和回车打开原记录",async()=>{
 const network=vi.fn(async(url:string)=>response(new URL(url,"http://local").searchParams.get("q")!));vi.stubGlobal("fetch",network);
 await act(()=>root.render(createElement(BusinessSearchInput,{})));
 const input=host.querySelector("input")!;
 await act(()=>{input.focus();input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));});await type("m");await act(()=>vi.advanceTimersByTimeAsync(200));expect(network).not.toHaveBeenCalled();
 await type("毛");await act(()=>input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"毛"})));await act(()=>vi.advanceTimersByTimeAsync(200));
 expect(host.textContent).toContain("毛 匹配开发款");expect(network).toHaveBeenCalledTimes(1);
 await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})));await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})));
 expect(push).toHaveBeenCalledWith("/projects/毛");expect(host.querySelector('[role="listbox"]')).toBeNull();
});
it("快速输入时旧请求晚到不能覆盖新结果；清空或退出后不残留候选",async()=>{
 let resolveOld!:(r:ReturnType<typeof response>)=>void;
 const network=vi.fn((url:string)=>url.endsWith("DEV-0")?new Promise(r=>{resolveOld=r;}):Promise.resolve(response("DEV-02")));vi.stubGlobal("fetch",network);
 await act(()=>root.render(createElement(BusinessSearchInput,{})));
 await type("DEV-0");await act(()=>vi.advanceTimersByTimeAsync(200));const input=await type("DEV-02");await act(()=>vi.advanceTimersByTimeAsync(200));
 await act(async()=>{resolveOld(response("DEV-0"));});expect(host.textContent).toContain("DEV-02 匹配开发款");expect(host.textContent).not.toContain("DEV-0 匹配开发款");
 await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(host.querySelector('[role="listbox"]')).toBeNull();await type("");await act(()=>vi.advanceTimersByTimeAsync(200));expect(network).toHaveBeenCalledTimes(2);
});
