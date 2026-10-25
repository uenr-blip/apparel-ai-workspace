export type ProductionGateCheckId = "spec" | "color" | "factory_material";

export type ProductionGateCheck = {
  id: ProductionGateCheckId;
  label: string;
  passed: boolean;
  evidence: string;
};

export type ProductionGate = {
  ready: boolean;
  alreadyReleased: boolean;
  alreadyDone: boolean;
  label: string;
  blockers: string[];
  checks: ProductionGateCheck[];
  facts: string[];
};

export function evaluateProductionGate(input: {
  status: string;
  productionReadiness: string;
  sizesAligned: boolean;
  specApproved: boolean;
  specTaskOpen: boolean;
  hasColors: boolean;
  colorsLatestApproved: boolean;
  canCut: boolean;
  cutLabel: string;
  cutBlockers: string[];
}): ProductionGate {
  const alreadyReleased = input.productionReadiness === "ready_for_production";
  const alreadyDone = input.status === "completed" || input.productionReadiness === "shipped";

  const specPassed = input.specApproved && input.sizesAligned && !input.specTaskOpen;
  const specEvidence = !input.specApproved
    ? "资料未批准"
    : !input.sizesAligned
      ? "色尺未齐"
      : input.specTaskOpen
        ? "罗纹规格待批准"
        : "资料已批准，色尺已齐";

  const colorPassed = input.hasColors && input.colorsLatestApproved;
  const colorEvidence = !input.hasColors
    ? "还没有本单颜色"
    : input.colorsLatestApproved
      ? "各色最新一轮已批准"
      : "分色未齐";

  const materialPassed = input.canCut;
  const materialEvidence = input.cutBlockers.length ? input.cutBlockers.join(" · ") : input.cutLabel;

  const checks: ProductionGateCheck[] = [
    { id: "spec", label: "资料批准", passed: specPassed, evidence: specEvidence },
    { id: "color", label: "分色确认", passed: colorPassed, evidence: colorEvidence },
    { id: "factory_material", label: "厂里有可用料", passed: materialPassed, evidence: materialEvidence },
  ];

  const facts = [
    "批准资料和分色不会自动投产。",
    "色、手感、版型不由普通图片识别替代。",
    "厂里有可用料才算可开裁，调拨不是领用。",
    "余料未占不挡投产。正式采购未下达。",
  ];

  if (alreadyDone) {
    return {
      ready: false,
      alreadyReleased: false,
      alreadyDone: true,
      label: "已出运，不能再批准投产",
      blockers: ["已出运"],
      checks,
      facts,
    };
  }

  if (alreadyReleased) {
    return {
      ready: true,
      alreadyReleased: true,
      alreadyDone: false,
      label: "可投产",
      blockers: [],
      checks,
      facts,
    };
  }

  const blockers = checks.filter((item) => !item.passed).map((item) => item.evidence);
  const ready = specPassed && colorPassed && materialPassed;
  return {
    ready,
    alreadyReleased: false,
    alreadyDone: false,
    label: ready ? "门槛已齐，可批准投产" : blockers.join(" · "),
    blockers,
    checks,
    facts,
  };
}
