import { beforeEach,expect,it,vi } from "vitest";
vi.mock("@/lib/auth",()=>({getSession:vi.fn()}));
vi.mock("@/server/services/craft-sheet",()=>({savePatternSheet:vi.fn()}));
import { getSession } from "@/lib/auth";
import { savePatternSheet } from "@/server/services/craft-sheet";
import { POST } from "@/app/api/projects/[id]/pattern-sheet/route";
const session={id:"actor",organizationId:"org",role:"salesperson",factoryId:null,name:"经办人",email:"test@example.local"};
const ctx={params:Promise.resolve({id:"project"})};
const body={expectedUpdatedAt:"2026-09-24T00:00:00Z",idempotencyKey:"test-pattern",craftFamily:"sweater"};
const request=(data:object,origin="http://localhost:3100")=>new Request("http://localhost:3100/api/projects/project/pattern-sheet",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(data)});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(getSession).mockResolvedValue(session);});
it("未登录、跨站、伪造经办人及超长请求不会保存版单",async()=>{
 vi.mocked(getSession).mockResolvedValue(null);expect((await POST(request(body),ctx)).status).toBe(401);
 vi.mocked(getSession).mockResolvedValue(session);expect((await POST(request(body,"https://outside.example"),ctx)).status).toBe(403);
 expect((await POST(request({...body,userId:"someone-else"}),ctx)).status).toBe(400);
 expect((await POST(request({...body,originNote:"a".repeat(61000)}),ctx)).status).toBe(413);
 expect(savePatternSheet).not.toHaveBeenCalled();
});
it("经办人来自当前会话，数据库错误细节不返回浏览器",async()=>{
 vi.mocked(savePatternSheet).mockRejectedValue(new Error("Prisma SELECT secret path"));
 const result=await POST(request(body),ctx);expect(result.status).toBe(503);expect(await result.text()).not.toMatch(/Prisma|SELECT|secret/);
 expect(savePatternSheet).toHaveBeenCalledWith(expect.objectContaining({userId:"actor",organizationId:"org",role:"salesperson"}));
});
