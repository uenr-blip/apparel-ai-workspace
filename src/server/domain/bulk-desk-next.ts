export type BulkDeskNext = {
  who: string;
  action: string;
  availability: "now" | "unbuilt" | "waiting";
  availabilityLabel: string;
  href: string | null;
  hrefLabel: string | null;
};

type Check = { id: string; passed: boolean; evidence: string };

export function bulkDeskNext(input: {
  orderId: string;
  orderNo: string;
  alreadyReleased: boolean;
  alreadyDone: boolean;
  checks: Check[];
  cutBlockers: string[];
  material: {
    materialCode: string;
    unit: string;
    gross: string | null;
    companyOnHand: string;
    atFactory: string;
  } | null;
  purchase: { optionCode: string; qty: string; status: string } | null;
  inboundOpen?: string | null;
  receivedQty?: string | null;
}): BulkDeskNext {
  const orderHref = (hash: string) => `/orders/${input.orderId}#${hash}`;
  const now = (who: string, action: string, href: string | null, hrefLabel: string | null): BulkDeskNext => ({
    who,
    action,
    availability: "now",
    availabilityLabel: "现在能做",
    href,
    hrefLabel,
  });
  const unbuilt = (who: string, action: string, href: string | null, hrefLabel: string | null): BulkDeskNext => ({
    who,
    action,
    availability: "unbuilt",
    availabilityLabel: "这一步还没开",
    href,
    hrefLabel,
  });

  if (input.alreadyDone) {
    return now(
      "跟单",
      "看出货件数和工厂结算草稿。这单已经出运，不能再批准投产。付款这一步还没开。",
      `/finance?tab=reconciliation&q=${encodeURIComponent(input.orderNo)}`,
      "看工厂结算草稿",
    );
  }

  if (input.alreadyReleased) {
    return now(
      "工厂记产量，跟单装箱出货",
      "到进度台按本单色尺登记产量，再装箱、占用、出运。没称重就是待称重。工厂结算先留对账草稿，付款这一步还没开。",
      "/delivery",
      "去进度台",
    );
  }

  const spec = input.checks.find((item) => item.id === "spec");
  if (spec && !spec.passed) {
    if (spec.evidence === "色尺未齐") {
      return now("业务员或经理", "把本单颜色和尺码件数补齐，再批资料。", orderHref("sizes"), "去对色尺");
    }
    if (spec.evidence === "罗纹规格待批准") {
      return now("业务员或经理", "把规格写进本单资料再批准。已批准的旧版保持不动。", orderHref("prep"), "去补资料");
    }
    return now(
      "业务员或经理",
      "先把本单资料批了。色尺要和件数对上。批了资料，还要等分色和厂里有料，才会开裁。",
      orderHref("prep"),
      "去补资料",
    );
  }

  const color = input.checks.find((item) => item.id === "color");
  if (color && !color.passed) {
    if (color.evidence === "还没有本单颜色") {
      return now("业务员或经理", "先补本单颜色，再按色确认。", orderHref("sizes"), "去补色尺");
    }
    return now(
      "业务员或经理",
      "按本单每个颜色做确认。工厂不能批分色。分色过了，还要等厂里有料，经理才批准投产。",
      orderHref("color-confirm"),
      "去分色",
    );
  }

  const materialCheck = input.checks.find((item) => item.id === "factory_material");
  if (materialCheck && !materialCheck.passed) {
    const blockers = input.cutBlockers.length ? input.cutBlockers : [materialCheck.evidence];
    const counts = materialCounts(input.material);
    if (blockers.some((item) => item.includes("没有面辅料"))) {
      return now(
        "业务员或经理",
        "把该款已批准资料里的面辅料引用到本单。引用只建关联，不会采购。",
        orderHref("material-supply"),
        "看本单料况",
      );
    }
    if (blockers.some((item) => item === "单耗未确认" || item === "毛需求未知")) {
      return now("业务员或经理", "先把单耗确认下来。单耗没确认，还不能判断够不够开裁。", orderHref("prep"), "去补资料");
    }
    if (blockers.includes("未到料")) {
      const unit = input.material?.unit ?? "米";
      const transfer = blockers.includes("未调到厂") ? "公司有的合格料可以先调到本单工厂，调拨不是领用。" : "未占用的合格在库可以调到本单工厂，调拨不是领用。";
      const draftHref = orderHref("leftover-plan");
      const draft = input.purchase && input.purchase.status !== "stale"
        ? `方案 ${input.purchase.optionCode} 采购草稿 ${input.purchase.qty} ${unit} 还在草稿。`
        : "";
      const shortfall = "还差的米数要等正式下单，这一步还没开。";
      if (input.purchase?.status === "issued") {
        const received = positiveQty(input.receivedQty) ? `在途已收 ${input.receivedQty} ${unit}。` : "";
        return {
          who: "仓管",
          action: `${counts}${received}方案 ${input.purchase.optionCode} 已下达采购 ${input.purchase.qty} ${unit}。布还没到，到了再按实收登记。采购单不是到料，也不是付款。`,
          availability: "waiting",
          availabilityLabel: "等布到了再收",
          href: "/resources/material-ledger",
          hrefLabel: "布到了再收",
        };
      }
      if (input.purchase?.status === "stale") {
        return now(
          "经理",
          `${counts}采购草稿已过期，按现在的供给重新采用。${transfer}正式下单这一步还没开。`,
          draftHref,
          "看余料方案",
        );
      }
      if (positiveQty(input.inboundOpen)) {
        return now(
          "仓管",
          `${counts}在途 ${input.inboundOpen} ${unit} 还没收，不能当现货。仓管先按送货收这批。${transfer}${draft}${shortfall}`,
          "/resources/material-ledger",
          "去收料",
        );
      }
      if (positiveQty(input.receivedQty)) {
        return unbuilt(
          "仓管",
          `${counts}在途已收 ${input.receivedQty} ${unit}。${draft}${shortfall}`,
          draftHref,
          "看采购草稿",
        );
      }
      if (input.purchase) {
        return unbuilt(
          "仓管",
          `${counts}在途没收不能当现货。${draft}${transfer}正式下单这一步还没开，草稿不会变成到料。`,
          draftHref,
          "看采购草稿",
        );
      }
      return now(
        "业务员或经理",
        `${counts}厂里料不够开裁。先看余料能不能用，不够就留下采购草稿。${transfer}正式下单这一步还没开。`,
        draftHref,
        "看余料方案",
      );
    }
    if (blockers.includes("未调到厂")) {
      return now(
        "仓管",
        `${counts}合格在库还在公司，要调到本单工厂才能开裁。调拨不是领用。`,
        "/resources?view=today",
        "去今日仓",
      );
    }
    return now("仓管", `${counts}${materialCheck.evidence}。厂里有可用料之后，经理才批准投产。`, orderHref("material-supply"), "看本单料况");
  }

  return now("经理", "资料、分色、厂里可用料都齐了，可以批准投产。批完到进度台按色尺记产量。", null, null);
}

function positiveQty(value: string | null | undefined) {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function materialCounts(
  material: { materialCode: string; unit: string; gross: string | null; companyOnHand: string; atFactory: string } | null,
) {
  if (!material?.gross) return "";
  return `${material.materialCode} 毛需求 ${material.gross} ${material.unit}，公司在手 ${material.companyOnHand} ${material.unit}，厂里 ${material.atFactory} ${material.unit}。`;
}
