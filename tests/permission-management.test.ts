import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { listPermissionAssignments, setUserPermission } from "@/server/services/user-permissions";
import { resetDatabase } from "./helpers";
const input = { organizationId: IDS.orgDemo, managerId: IDS.userManager, targetUserId: IDS.userSales, action: "inventory_transfer", enabled: true };
describe("权限下发管理", () => {
  beforeEach(resetDatabase);
  it("经理授权与撤权留痕，重复提交不重复写审计", async () => {
    await setUserPermission(input);
    await setUserPermission(input);
    expect(await prisma.auditEvent.count({ where: { action: "permission.granted" } })).toBe(1);
    expect((await listPermissionAssignments(IDS.orgDemo, IDS.userManager)).users.find(user => user.id === IDS.userSales)?.actions.find(action => action.action === input.action)?.enabled).toBe(true);
    await setUserPermission({ ...input, enabled: false });
    expect(await prisma.auditEvent.count({ where: { action: "permission.revoked" } })).toBe(1);
  });
  it("员工不能自授权，不能授权外组织，不能开放付款", async () => {
    await expect(setUserPermission({ ...input, managerId: IDS.userSales })).rejects.toThrow(/经理/);
    await expect(setUserPermission({ ...input, targetUserId: IDS.userIso })).rejects.toThrow(/不存在/);
    await expect(setUserPermission({ ...input, action: "pay_factory" })).rejects.toThrow(/尚未开放/);
  });
  it("不能给工厂下发全公司财务查阅能力", async () => {
    await expect(setUserPermission({ ...input, targetUserId: IDS.userFactory, action: "generate_factory_recon" })).rejects.toThrow(/隔离/);
    await setUserPermission({ ...input, targetUserId: IDS.userFactory, action: "inventory_consume" });
  });
});
