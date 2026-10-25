/** @vitest-environment jsdom */
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { PatternWorkspace } from "@/app/(app)/projects/pattern-workspace";
import { emptyFeedback,emptyQuote,readPatternContent,type PatternBoard } from "@/lib/pattern-workflow";
import type { PatternCatalogSource } from "@/lib/pattern-catalog";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
function board():PatternBoard {const content=readPatternContent("sweater",JSON.stringify({sweater:{yarnComposition:"羊毛",yarnCount:"2/48"}}));return{projectId:"target",code:"DEV-target",name:"测试版单",updatedAt:"2026-09-24T00:00:00.000Z",contextStamp:"rules",content,factories:[],samples:[],revisions:[{id:"v1",number:1,parentId:null,createdAt:"2026-09-24T00:00:00Z",createdByName:"当时负责人",reason:"第一版",content}]};}
it("每条候选右侧直接删除，不清空已填内容、不关闭列表；保存才提交本人设置",async()=>{
 const initial=board();initial.choices={"sweater.yarnCount":[{value:"2/48",source:"已保存版单"}]};
 const network=vi.fn(async()=>({ok:true,json:async()=>initial}));vi.stubGlobal("fetch",network);
 await act(()=>root.render(createElement(PatternWorkspace,{initial,currentUserId:"owner",assignees:[]})));
 const input=host.querySelector<HTMLInputElement>('[aria-label="纱线支数"]')!;
 const button=(label:string)=>host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
 await act(()=>button("选择纱线支数").click());expect(host.querySelector('[role="grid"]')?.textContent).toContain("2/48");
 expect(host.textContent).not.toContain("整理候选");expect(host.textContent).not.toContain("返回选择");
 await act(()=>button("删除候选：2/48").click());
 expect(host.querySelector('[role="grid"]')?.textContent).not.toContain("2/48");expect(input.value).toBe("2/48");
 expect(input.getAttribute("aria-expanded")).toBe("true");
 await act(()=>button("清空纱线支数").click());expect(input.value).toBe("");
 expect(network).not.toHaveBeenCalled();
 await act(()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="保存版单草稿")!.click());
 const body=JSON.parse(String((network.mock.calls as unknown as [string,RequestInit][])[0][1].body));
 expect(body.sweater.yarnCount).toBe("");
 expect(body.choiceVisibility).toEqual([{field:"sweater.yarnCount",value:"2/48",hidden:true,expectedHidden:false}]);
});
it.each(["重新输入", "普通保存", "重填后又删除"])("删除过的候选：%s，按最终操作提交，不用恢复入口",async(mode)=>{
 const initial=board();initial.choices={"sweater.yarnCount":[{value:"2",source:"历史",hidden:true},{value:"2/48",source:"历史",hidden:true}]};
 const network=vi.fn(async()=>({ok:true,json:async()=>initial}));vi.stubGlobal("fetch",network);
 await act(()=>root.render(createElement(PatternWorkspace,{initial,currentUserId:"owner",assignees:[]})));
 const input=host.querySelector<HTMLInputElement>('[aria-label="纱线支数"]')!;
 if(mode!=="普通保存") {
  for(const value of ["2","2/48"]) await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
  expect(host.querySelector('[role="grid"]')?.textContent).toContain("2/48");
  if(mode==="重填后又删除") await act(()=>host.querySelector<HTMLButtonElement>('[aria-label="删除候选：2/48"]')!.click());
 }
 expect(network).not.toHaveBeenCalled();
 await act(()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="保存版单草稿")!.click());
 const body=JSON.parse(String((network.mock.calls as unknown as [string,RequestInit][])[0][1].body));
 expect(body.sweater.yarnCount).toBe("2/48");
 expect(body.choiceVisibility).toEqual(mode==="重新输入"?[{field:"sweater.yarnCount",value:"2/48",hidden:false,expectedHidden:true}]:[]);
});
it("供应商点选后可修改，价格只列本供应商历史值；选择使旧确认失效且不自动保存",async()=>{
 const network=vi.fn();vi.stubGlobal("fetch",network);
 const initial=board();initial.content.sweater.yarnPrice="本款原价";
 initial.choices={"sweater.yarnSupplier":[{value:"甲供应商",source:"供应商主档"},{value:"乙供应商",source:"已保存版单"}],"sweater.yarnPrice":[{value:"CNY 60/kg",source:"历史填写 · 待核对",supplier:"甲供应商",detail:"DEV-A · 100%棉"},{value:"USD 15/kg",source:"历史填写 · 待核对",supplier:"乙供应商"}]};
 await act(()=>root.render(createElement(PatternWorkspace,{initial,currentUserId:"owner",assignees:[]})));
 const confirmation=host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;await act(()=>confirmation.click());
 await act(()=>host.querySelector<HTMLButtonElement>('[aria-label="选择纱线供应商（内部）"]')!.click());
 expect(host.querySelector('[role="grid"]')?.textContent).toContain("供应商主档");
 await act(()=>[...host.querySelectorAll<HTMLButtonElement>('[role="gridcell"] button')].find(b=>b.textContent?.includes("甲供应商"))!.click());
 expect(confirmation.checked).toBe(false);
 const supplier=host.querySelector<HTMLInputElement>('[aria-label="纱线供应商（内部）"]')!;
 const price=host.querySelector<HTMLInputElement>('[aria-label="纱线价格（内部）"]')!;
 expect(supplier.value).toBe("甲供应商");expect(price.value).toBe("本款原价");
 await act(()=>price.focus());
 expect(host.querySelector('[role="grid"]')?.textContent).toContain("CNY 60/kg");
 expect(host.querySelector('[role="grid"]')?.textContent).not.toContain("USD 15/kg");
 await act(()=>{supplier.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(supplier,"自填新供应商");supplier.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(supplier.value).toBe("自填新供应商");expect(host.textContent).toContain("没有匹配项，可直接输入");
 expect(network).not.toHaveBeenCalled();expect(price.value).toBe("本款原价");
});
it("支数候选支持筛选和键盘选择，中文输入法回车不提前采用；自由输入随原保存提交",async()=>{
 const initial=board();initial.choices={"sweater.yarnCount":[{value:"2/32",source:"示例"},{value:"2/48",source:"历史"}]};
 const refreshed={...initial,updatedAt:"2026-09-27T01:00:00.000Z",content:{...initial.content,sweater:{...initial.content.sweater,yarnCount:"自定义3/68"}}};
 const network=vi.fn(async(_url:string,options?:RequestInit)=>({ok:true,json:async()=>options?{message:"已保存"}:refreshed}));vi.stubGlobal("fetch",network);
 Element.prototype.scrollIntoView=vi.fn();
 await act(()=>root.render(createElement(PatternWorkspace,{initial,currentUserId:"owner",assignees:[]})));
 const input=host.querySelector<HTMLInputElement>('[aria-label="纱线支数"]')!;
 await act(()=>input.focus());
 await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})));
 await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,isComposing:true})));
 expect(input.value).toBe("2/48");expect(input.getAttribute("aria-expanded")).toBe("true");
 await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
 expect(input.value).toBe("2/32");expect(input.getAttribute("aria-expanded")).toBe("false");
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"自定义3/68");input.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(network).not.toHaveBeenCalled();
 await act(()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="保存版单草稿")!.click());
 expect(network).toHaveBeenCalledTimes(2);
 const body=JSON.parse(String(network.mock.calls[0][1]!.body));
 expect(body.sweater.yarnCount).toBe("自定义3/68");expect(body.contextStamp).toBe("rules");expect(body.idempotencyKey).toBeTruthy();
 expect(input.value).toBe("自定义3/68");expect(host.textContent).toContain("草稿已与保存记录对齐");
});
it("查旧版不写入，改版单类型会撤销已勾选确认",async()=>{
 const network=vi.fn();vi.stubGlobal("fetch",network);
 await act(()=>root.render(createElement(PatternWorkspace,{initial:board(),currentUserId:"owner",assignees:[]})));
 expect(host.textContent).toContain("当时负责人");expect(host.textContent).toContain("2/48");
 const confirmation=host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;await act(()=>confirmation.click());expect(confirmation.checked).toBe(true);
 const family=host.querySelector<HTMLSelectElement>('select[aria-label="版单类型"]')!;
 await act(()=>{family.value="knit";family.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(confirmation.checked).toBe(false);expect(host.textContent).toContain("有未保存修改");expect(network).not.toHaveBeenCalled();
});
it("他人的打样记录可核对，但不能因当前角色身份替他发厂",async()=>{
 const initial=board();initial.samples=[{id:"sample",revisionId:"v1",revisionNumber:1,factoryId:"f1",factoryName:"A厂",round:1,quantity:1,dueDate:"",requirements:"领口核对",quote:emptyQuote(),feedback:emptyFeedback(),internalOpinion:"",updatedAt:initial.updatedAt,ownerId:"actual-owner",ownerName:"实际负责人",issuedAt:null,receivedAt:null}];
 await act(()=>root.render(createElement(PatternWorkspace,{initial,currentUserId:"another-account",assignees:[]})));
 const issue=[...host.querySelectorAll("button")].find(b=>b.textContent?.includes("在系统内发给工厂"))!;
 expect(issue.disabled).toBe(true);expect(host.textContent).toContain("负责人：实际负责人");expect(host.textContent).not.toContain("交接负责人");
});

it("从款式库选择、取消部分字段、确认带入原表格；保留未选字段且不提前提交业务",async()=>{
 const original=board();original.content.sweater.bodyStructure="本款组织";
 const source:PatternCatalogSource={sourceId:"draft:source",materialId:"",label:"DEV-021 参考毛衣 · 草稿快照",fingerprint:"a".repeat(64),content:readPatternContent("sweater",JSON.stringify({sweater:{yarnComposition:"来源羊绒",yarnCount:"2/32"}})),fields:["sweater.yarnComposition","sweater.yarnCount"],imageSrc:"",canAttachImage:false,choices:[],materials:[],notes:[]};
 const network=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes("source=")?source:{items:[{id:"project:source",label:"DEV-021 参考毛衣",imageSrc:"",description:"当前草稿"}],limited:false}}));vi.stubGlobal("fetch",network);
 vi.spyOn(window,"scrollTo").mockImplementation(()=>{});
 await act(()=>root.render(createElement(PatternWorkspace,{initial:original,currentUserId:"owner",assignees:[]})));
 const button=(text:string)=>[...document.querySelectorAll("button")].find(b=>b.textContent===text)!;
 await act(()=>button("参考已有款").click());
 await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 await act(()=>[...document.querySelectorAll("button")].find(b=>b.textContent?.includes("DEV-021 参考毛衣"))!.click());
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("来源羊绒");
 const composition=document.querySelector<HTMLInputElement>('[aria-label="带入纱线成分"]')!;expect(composition.checked).toBe(true);
 await act(()=>composition.click());
 const confirm=[...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(e=>e.parentElement?.textContent?.includes("我已核对来源、参考范围和替换内容"))!;
 expect(button("带入 1 项到版单").disabled).toBe(true);await act(()=>confirm.click());
 await act(()=>button("带入 1 项到版单").click());
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(host.querySelector<HTMLInputElement>('[aria-label="纱线成分"]')!.value).toBe("羊毛");
 expect(host.querySelector<HTMLInputElement>('[aria-label="纱线支数"]')!.value).toBe("2/32");
 expect(host.querySelector<HTMLInputElement>('[aria-label="大身组织"]')!.value).toBe("本款组织");
 expect(host.textContent).toContain("来源原值");expect(host.textContent).toContain("有未保存修改");
 expect(network.mock.calls.every(([url])=>url.startsWith("/api/projects/pattern-catalog"))).toBe(true);
 vi.restoreAllMocks();
});
