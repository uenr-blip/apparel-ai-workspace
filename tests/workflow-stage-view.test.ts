import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowStagePanel } from "@/components/workflow-stage-panel";
import type { StageWorkspace } from "@/server/services/workflow-stage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const board: StageWorkspace = {
  target: { followRowId: "sample-row" }, stamp: "stamp", stageId: "stage", kind: "sales_sample", locked: false, canTransfer: true,
  label: "验证款", styleId: "style", ownerId: "owner", customerId: "customer", seasonCode: "SS27", rows: [], seedReferences: [], revisionId: "latest",
  seedImageBaseUrl: undefined, initialNotice: "", owners: [{ id: "owner", name: "接手人" }], customers: [], factories: [], materials: [], patterns: [], sources: [],
  history: [
    { id: "latest", number: 2, reason: "交接后改版", createdAt: "2026-09-28T00:00:00Z", createdBy: "接手人", rows: [], references: [] },
    { id: "frozen", number: 1, reason: "交接当时", createdAt: "2026-09-27T00:00:00Z", createdBy: "跟单员", rows: [{ key: "fabric", group: "fabric", name: "交接棉布", fields: { composition: "100%棉" } }], references: [] },
  ],
  transfers: [{ id: "handoff", outgoing: false, kind: "开发", batchKey: "首批", href: "/projects/project?stageRevision=frozen#stage-materials", sourceRevisionId: "frozen", versionLabel: "头版（V1） · 用料第 1 次记录", basis: "客户邮件已核对", actor: "跟单员", createdAt: "2026-09-27T00:00:00Z" }], events: [], order: null,
};
describe("交接来源历史视图", () => {
  it("指定原版时展示当时资料、正确项数与版次，不能误操作最新版本", () => {
    const html = renderToStaticMarkup(createElement(WorkflowStagePanel, { board, initialRevisionId: "frozen" }));
    expect(html).toContain("查看历史资料"); expect(html).toContain("交接棉布"); expect(html).toContain("1 项 · 第 1 次记录");
    expect(html).toContain("返回当前资料"); expect(html).not.toContain("编辑本阶段用料"); expect(html).not.toContain("转大货草稿");
    expect(html).toContain("来源"); expect(html).toContain("客户邮件已核对"); expect(html).toContain("stageRevision=frozen");
  });
  it("默认显示当前资料，未知版次明确提示；归档不可继续交接", () => {
    const current = renderToStaticMarkup(createElement(WorkflowStagePanel, { board }));
    expect(current).toContain("转大货草稿"); expect(current).not.toContain("查看历史资料");
    const missing = renderToStaticMarkup(createElement(WorkflowStagePanel, { board, initialRevisionId: "missing" }));
    expect(missing).toContain("未找到链接指定的用料记录");
    const archived = renderToStaticMarkup(createElement(WorkflowStagePanel, { board: { ...board, locked: true, canTransfer: false } }));
    expect(archived).not.toContain("转大货草稿"); expect(archived).not.toContain("编辑本阶段用料");
  });
});
