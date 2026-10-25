import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { leftoverNextStep } from "@/server/domain/leftover-next";
import { adoptedProposalTitle, evaluateChainProposals, explainChainProposalGap } from "@/server/domain/chain-proposals";
import { approveProposal } from "@/server/services/execution";
import { listOrderChainProposals, syncOrderChainProposals } from "@/server/services/chain-proposals";
import { resetDatabase } from "./helpers";

const leftoverA = leftoverNextStep({
  started: false,
  comparable: true,
  freeStock: "120",
  adopted: null,
});
const leftoverB = leftoverNextStep({
  started: false,
  comparable: true,
  freeStock: "0",
  adopted: null,
});
const leftoverHeld = leftoverNextStep({
  started: false,
  comparable: true,
  freeStock: "0",
  adopted: { optionCode: "A", status: "draft" },
});

const mat = {
  materialId: "mat-1",
  materialCode: "MAT-1",
  blocker: null as string | null,
  companyOnHand: "100",
  atFactory: "0",
  consumed: "0",
  remaining: "80",
  gross: "80",
};

describe("链上提案", () => {
  it("有可占余料只提案采用 A，不下达采购、不编效益", () => {
    const rows = evaluateChainProposals({
      orderId: "o1",
      started: false,
      shipped: false,
      leftover: leftoverA,
      leftoverSnapshot: "snap-a",
      leftoverMaterialId: "mat-1",
      cutLines: [{ ...mat, blocker: "未到料", remaining: "800", gross: "800" }],
      moneyOpen: [],
      gateReady: false,
      alreadyReleased: false,
    });
    expect(rows.map((row) => row.kind)).toEqual(["adopt_leftover"]);
    expect(rows[0]?.willNotChange.join(" ")).toContain("正式采购");
    expect(rows[0]?.risks.join(" ")).not.toContain("利润");
  });

  it("无可占余料时提案补购草稿 B；未调到厂提案调厂任务；超领和未结收付分开提案", () => {
    const rows = evaluateChainProposals({
      orderId: "o1",
      started: false,
      shipped: false,
      leftover: leftoverB,
      leftoverSnapshot: "snap-b",
      leftoverMaterialId: "mat-1",
      cutLines: [
        { ...mat, blocker: "未调到厂", companyOnHand: "100", atFactory: "0" },
        { ...mat, materialId: "mat-2", materialCode: "MAT-2", consumed: "90", gross: "80", remaining: "0" },
      ],
      moneyOpen: [{ currency: "USD", receivableOpen: "100.00", payableOpen: "0.00" }],
      gateReady: false,
      alreadyReleased: false,
    });
    expect(rows.map((row) => row.kind)).toEqual(["over_use", "transfer", "adopt_buy", "collect"]);
    expect(rows.find((row) => row.kind === "adopt_buy")?.willNotChange.join(" ")).toContain("正式采购");
    expect(rows.find((row) => row.kind === "collect")?.risks[0]?.impact).toContain("不是银行");
  });

  it("已出运不提案；已占余料不再催采用；门槛未齐不提案投产", () => {
    expect(
      evaluateChainProposals({
        orderId: "o1",
        started: false,
        shipped: true,
        leftover: leftoverA,
        leftoverSnapshot: "snap-a",
        leftoverMaterialId: "mat-1",
        cutLines: [mat],
        moneyOpen: [{ currency: "USD", receivableOpen: "10.00", payableOpen: "0.00" }],
        gateReady: true,
        alreadyReleased: false,
      }),
    ).toEqual([]);

    const held = evaluateChainProposals({
      orderId: "o1",
      started: false,
      shipped: false,
      leftover: leftoverHeld,
      leftoverSnapshot: "snap-a",
      leftoverMaterialId: "mat-1",
      cutLines: [mat],
      moneyOpen: [],
      gateReady: false,
      alreadyReleased: false,
    });
    expect(held.map((row) => row.kind)).not.toContain("adopt_leftover");

    const gated = evaluateChainProposals({
      orderId: "o1",
      started: false,
      shipped: false,
      leftover: leftoverHeld,
      leftoverSnapshot: "snap-a",
      leftoverMaterialId: "mat-1",
      cutLines: [mat],
      moneyOpen: [],
      gateReady: true,
      alreadyReleased: false,
    });
    expect(gated.map((row) => row.kind)).toEqual(["release"]);
  });

  it("没有待批提案时写清已占住、还不能比较、没有收付", () => {
    expect(
      explainChainProposalGap({
        shipped: false,
        leftover: leftoverHeld,
        comparable: true,
        hasOpenMoney: false,
        openKinds: [],
      }),
    ).toEqual(["余料已占住（方案 A），未下达采购", "没有未结收付"]);
    expect(
      explainChainProposalGap({
        shipped: false,
        leftover: leftoverNextStep({ started: false, comparable: false, freeStock: "0", adopted: null }),
        comparable: false,
        hasOpenMoney: false,
        openKinds: [],
      }).join(" "),
    ).toMatch(/还不能比较余料/);
    expect(adoptedProposalTitle("B")).toBe("已采用方案 B，采购草稿，未下达采购");
  });
});

describe("链上提案服务", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("缺料单同步出余料或补购提案；工厂不能批准；外组织看不到", async () => {
    const synced = await syncOrderChainProposals(IDS.orgDemo, IDS.orderShortage);
    expect(synced.length).toBeGreaterThan(0);
    expect(synced.every((row) => row.status === "preview")).toBe(true);
    expect(synced.some((row) => row.actionType === "adopt_purchase_option" || row.actionType === "create_internal_task")).toBe(true);
    expect(synced.every((row) => row.href.includes(IDS.orderShortage))).toBe(true);

    const adopt = synced.find((row) => row.actionType === "adopt_purchase_option");
    if (adopt) {
      await expect(
        approveProposal({
          organizationId: IDS.orgDemo,
          userId: IDS.userFactory,
          role: "factory",
          proposalId: adopt.id,
        }),
      ).rejects.toThrow(/无权/);
    }

    await expect(syncOrderChainProposals(IDS.orgIso, IDS.orderShortage)).rejects.toThrow(/不存在|组织/);
    expect(await syncOrderChainProposals(IDS.orgDemo, IDS.orderHistorical)).toEqual([]);
  });

  it("批准余料或补购后列出已采用草稿，不再给批准按钮", async () => {
    const preview = await syncOrderChainProposals(IDS.orgDemo, IDS.orderShortage);
    const adopt = preview.find((row) => row.actionType === "adopt_purchase_option");
    expect(adopt).toBeTruthy();
    await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: adopt!.id,
    });
    const listed = await listOrderChainProposals(IDS.orgDemo, IDS.orderShortage);
    const done = listed.proposals.find((row) => row.actionType === "adopt_purchase_option");
    expect(done?.status).toBe("executed");
    expect(done?.title).toMatch(/已采用方案 [AB]，采购草稿，未下达采购/);
    expect(listed.proposals.some((row) => row.actionType === "adopt_purchase_option" && row.status === "preview")).toBe(
      false,
    );
    const empty = await listOrderChainProposals(IDS.orgDemo, IDS.orderHistorical);
    expect(empty.proposals).toEqual([]);
    expect(empty.reasons.join(" ")).toMatch(/已出运|没有未结收付/);
  });
});
