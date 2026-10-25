import { d } from "@/server/domain/procurement";

export type LeftoverNextKind = "blocked" | "ready" | "adopted" | "stale";

export type LeftoverNext = {
  kind: LeftoverNextKind;
  label: string;
  recommend: "A" | "B" | null;
  blockers: string[];
};

export function leftoverNextStep(input: {
  started: boolean;
  comparable: boolean;
  freeStock: string;
  adopted: { optionCode: string; status: string } | null;
}): LeftoverNext {
  if (input.adopted?.status === "stale") {
    return {
      kind: "stale",
      label: "余料方案已过期，需按当前供给重新采用",
      recommend: d(input.freeStock).gt(0) ? "A" : "B",
      blockers: ["余料方案过期"],
    };
  }
  if (input.adopted?.status === "issued") {
    return {
      kind: "adopted",
      label: `方案 ${input.adopted.optionCode} 已下达采购，未收料，未付款`,
      recommend: null,
      blockers: [],
    };
  }
  if (input.adopted && input.adopted.status !== "stale") {
    const occupied = input.adopted.optionCode === "A";
    return {
      kind: "adopted",
      label: occupied
        ? "余料已占住（方案 A），未下达采购"
        : `已采用方案 ${input.adopted.optionCode}，采购草稿，未下达采购`,
      recommend: null,
      blockers: [],
    };
  }
  if (input.started) {
    return { kind: "adopted", label: "已开裁，余料方案不再挡开裁", recommend: null, blockers: [] };
  }
  if (!input.comparable) {
    return {
      kind: "blocked",
      label: "还不能比较余料",
      recommend: null,
      blockers: [],
    };
  }
  if (d(input.freeStock).gt(0)) {
    return {
      kind: "ready",
      label: "下一步：采用余料方案 A（占住可分配库存，补购差额）",
      recommend: "A",
      blockers: ["余料未占"],
    };
  }
  return {
    kind: "ready",
    label: "下一步：确认补购方案 B（当前无可占余料）",
    recommend: "B",
    blockers: ["余料未占"],
  };
}
