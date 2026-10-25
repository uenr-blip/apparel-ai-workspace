import { hashSync } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { IDS } from "../src/lib/constants";
import { seedStyleCatalog } from "../src/server/services/style-catalog";

const PASSWORD = "DemoPass!2026";

const STYLES = [
  { id: IDS.styleSt26018, code: "ST-26018", name: "圆领针织上衣", category: "针织上衣", silhouette: "圆领短袖", status: "approved", image: "/styles/st-26018.svg" },
  { id: "style-st-26001", code: "ST-26001", name: "重磅帽衫", category: "针织外套", silhouette: "连帽", status: "approved", image: "/styles/st-26001.svg" },
  { id: "style-st-26002", code: "ST-26002", name: "直筒牛仔裤", category: "裤装", silhouette: "直筒", status: "approved", image: "/styles/st-26002.svg" },
  { id: "style-st-26003", code: "ST-26003", name: "亚麻衬衫", category: "衬衫", silhouette: "直身", status: "development", image: "/styles/st-26003.svg" },
  { id: "style-st-26004", code: "ST-26004", name: "工装外套", category: "外套", silhouette: "宽松", status: "approved", image: "/styles/st-26004.svg" },
  { id: "style-st-26005", code: "ST-26005", name: "针织开衫", category: "针织外套", silhouette: "开襟", status: "approved", image: "/styles/st-26005.svg" },
  { id: "style-st-26006", code: "ST-26006", name: "西装外套", category: "正装", silhouette: "修身", status: "approved", image: "/styles/st-26006.svg" },
  { id: "style-st-26007", code: "ST-26007", name: "百褶裙", category: "裙装", silhouette: "A字", status: "approved", image: "/styles/st-26007.svg" },
  { id: "style-st-26008", code: "ST-26008", name: "运动长裤", category: "裤装", silhouette: "束口", status: "approved", image: "/styles/st-26008.svg" },
  { id: "style-st-26009", code: "ST-26009", name: "条纹T恤", category: "针织上衣", silhouette: "圆领", status: "sales_sample", image: "/styles/st-26009.svg" },
  { id: "style-st-26010", code: "ST-26010", name: "轻薄羽绒服", category: "外套", silhouette: "短款", status: "approved", image: "/styles/st-26010.svg" },
  { id: "style-st-26011", code: "ST-26011", name: "灯芯绒长裤", category: "裤装", silhouette: "锥形", status: "approved", image: "/styles/st-26011.svg" },
];

export async function seedDatabase(client: PrismaClient) {
  const passwordHash = hashSync(PASSWORD, 10);

  await client.organization.createMany({
    data: [
      { id: IDS.orgDemo, code: "DEMO", name: "演示服装公司", demoNote: "虚构主组织，不是真实客户", timezone: "Asia/Shanghai" },
      { id: IDS.orgIso, code: "ISO", name: "隔离测试组织", demoNote: "仅用于跨组织隔离测试", timezone: "Asia/Shanghai" },
    ],
  });

  await client.party.createMany({
    data: [
      { id: IDS.supplierQinghe, organizationId: IDS.orgDemo, kind: "supplier", code: "SUP-QH", name: "青禾面料", demoNote: "虚构供应商" },
      { id: IDS.factoryYunshan, organizationId: IDS.orgDemo, kind: "factory", code: "FAC-YS", name: "云杉服装工厂", demoNote: "虚构外协工厂" },
      { id: IDS.warehouse, organizationId: IDS.orgDemo, kind: "warehouse", code: "WH-01", name: "原料库", demoNote: "自有原料库，调拨到工厂不算领用" },
      { id: "party-tingzhou", organizationId: IDS.orgDemo, kind: "supplier", code: "SUP-TZ", name: "汀洲辅料", demoNote: "虚构辅料商" },
      { id: "party-wudao", organizationId: IDS.orgDemo, kind: "factory", code: "FAC-WD", name: "雾岛印绣", demoNote: "虚构印绣厂" },
      { id: "party-iso-factory", organizationId: IDS.orgIso, kind: "factory", code: "FAC-ISO", name: "隔离工厂", demoNote: "第二组织工厂" },
    ],
  });

  await client.user.createMany({
    data: [
      { id: IDS.userSales, organizationId: IDS.orgDemo, email: "salesperson@demo.local", name: "林清意", role: "salesperson", passwordHash, factoryId: null },
      { id: IDS.userManager, organizationId: IDS.orgDemo, email: "manager@demo.local", name: "周衡", role: "manager", passwordHash, factoryId: null },
      { id: IDS.userFactory, organizationId: IDS.orgDemo, email: "factory@demo.local", name: "云杉跟单", role: "factory", passwordHash, factoryId: IDS.factoryYunshan },
      { id: IDS.userIso, organizationId: IDS.orgIso, email: "isolated@iso.local", name: "隔离业务员", role: "salesperson", passwordHash, factoryId: null },
    ],
  });

  await client.customer.createMany({
    data: [
      { id: IDS.customerNorthshore, organizationId: IDS.orgDemo, code: "CUS-NB", name: "北岸服饰", demoNote: "虚构客户" },
      { id: "customer-qinglan", organizationId: IDS.orgDemo, code: "CUS-QL", name: "青岚进出口", demoNote: "虚构客户" },
      { id: "customer-nanyu", organizationId: IDS.orgDemo, code: "CUS-NY", name: "南屿零售", demoNote: "虚构客户" },
      { id: "customer-iso", organizationId: IDS.orgIso, code: "CUS-ISO", name: "隔离客户", demoNote: "第二组织客户" },
    ],
  });

  await client.season.createMany({
    data: [
      { id: IDS.seasonSs26, organizationId: IDS.orgDemo, code: "SS26", name: "2026春夏", sort: 1, demoNote: "演示季节关系，不是款号" },
      { id: IDS.seasonAw26, organizationId: IDS.orgDemo, code: "AW26", name: "2026秋冬", sort: 2, demoNote: "演示季节关系，不是款号" },
    ],
  });

  await client.designer.createMany({
    data: [
      { id: IDS.designerShen, organizationId: IDS.orgDemo, name: "沈予安" },
      { id: IDS.designerGu, organizationId: IDS.orgDemo, name: "顾晚晴" },
    ],
  });
  await seedStyleCatalog(client, IDS.orgDemo);
  await seedStyleCatalog(client, IDS.orgIso);

  await client.organizationPolicy.createMany({
    data: [
      { id: "policy-auto-task", organizationId: IDS.orgDemo, key: "auto_create_internal_tasks", enabled: true, note: "允许系统按阻塞自动创建内部待办" },
      {
        id: "policy-recon-basis",
        organizationId: IDS.orgDemo,
        key: "factory_recon_basis",
        enabled: true,
        note: "合格出运件数 × 12.50 元/件。对账草稿不是付款。",
        valueJson: JSON.stringify({ unitPriceYuan: "12.50", qtyKind: "shipped_good" }),
      },
    ],
  });

  await client.sizeScale.create({
    data: { id: "size-standard", organizationId: IDS.orgDemo, name: "标准五码", sizesJson: JSON.stringify(["XS", "S", "M", "L", "XL"]) },
  });

  const materials = Array.from({ length: 20 }, (_, index) => {
    const n = String(index + 1).padStart(3, "0");
    const special =
      index === 0
        ? { id: IDS.materialMat001, code: "MAT-001", name: "32支精棉汗布", kind: "fabric", specSummary: "海军蓝/灰色可染，单耗演示面料", unit: "m" }
        : index === 1
          ? { id: "material-yarn-01", code: "YARN-DEMO-01", name: "轻薄棉纱 A", kind: "yarn", specSummary: "开发候选纱，手感待测", unit: "kg" }
          : index === 2
            ? { id: "material-yarn-02", code: "YARN-DEMO-02", name: "轻薄棉纱 B", kind: "yarn", specSummary: "开发候选纱，缩水待测", unit: "kg" }
            : { id: `material-${n}`, code: `MAT-${n}`, name: `演示材料 ${n}`, kind: index % 3 === 0 ? "trim" : "fabric", specSummary: "虚构材料规格", unit: index % 3 === 0 ? "pcs" : "m" };
    return { ...special, organizationId: IDS.orgDemo, demoNote: "虚构材料" };
  });
  await client.material.createMany({ data: materials });
  await client.material.create({
    data: { id: "material-iso", organizationId: IDS.orgIso, code: "MAT-ISO", name: "隔离材料", kind: "fabric", specSummary: "第二组织", unit: "m", demoNote: "隔离" },
  });
  await client.material.create({
    data: {
      id: IDS.materialD06,
      organizationId: IDS.orgDemo,
      code: "MAT-D06",
      name: "调拨演示汗布",
      kind: "fabric",
      specSummary: "仅用于调拨≠领用，不进入采购比较",
      unit: "m",
      demoNote: "D06 演示材料",
    },
  });

  for (const style of STYLES) {
    await client.style.create({
      data: {
        id: style.id,
        organizationId: IDS.orgDemo,
        code: style.code,
        name: style.name,
        category: style.category,
        silhouette: style.silhouette,
        status: style.status,
        imagePath: style.image,
        demoNote: "虚构款式，示意图片非实拍",
        designerId: style.code === "ST-26018" ? IDS.designerShen : null,
        createdByUserId: IDS.userSales,
      },
    });
    const versionId = style.code === "ST-26018" ? IDS.versionSt26018V1 : `version-${style.code}-v1`;
    await client.styleVersion.create({
      data: {
        id: versionId,
        styleId: style.id,
        versionNumber: 1,
        status: "approved",
        cuffType: style.code === "ST-26018" ? "包边袖口" : "常规",
        changeSummary: "已批准技术资料 V1",
        approvedAt: new Date("2026-08-01T00:00:00+08:00"),
        approvedByName: "周衡",
      },
    });
    if (style.code === "ST-26018" || style.code === "ST-26001") {
      await client.bomLine.create({
        data: {
          id: `bom-${style.code.toLowerCase()}-v1-mat001`,
          styleVersionId: versionId,
          materialId: IDS.materialMat001,
          consumption: "1.5",
          unit: "m",
          includesAllowance: false,
          allowanceRate: "0.03",
          colorScope: "all",
          confirmed: true,
        },
      });
    }
  }

  const knitGroup = await client.styleOption.findFirst({
    where: { organizationId: IDS.orgDemo, kind: "category", name: "针织", parentId: null },
  });
  const knitTee = knitGroup
    ? await client.styleOption.findFirst({
        where: { organizationId: IDS.orgDemo, kind: "category", name: "短袖T恤", parentId: knitGroup.id },
      })
    : null;
  const innerType = await client.styleOption.findFirst({
    where: { organizationId: IDS.orgDemo, kind: "type", name: "内部" },
  });
  const year2026 = await client.styleOption.findFirst({
    where: { organizationId: IDS.orgDemo, kind: "year", name: "2026" },
  });
  if (knitTee && innerType && year2026) {
    await client.style.update({
      where: { id: IDS.styleSt26018 },
      data: {
        category: "针织 / 短袖T恤",
        categoryOptionId: knitTee.id,
        typeOptionId: innerType.id,
        yearOptionId: year2026.id,
      },
    });
  }

  await client.styleSeason.create({
    data: { id: "style-season-st26009-ss26", styleId: "style-st-26009", seasonId: IDS.seasonSs26 },
  });

  await client.style.create({
    data: {
      id: "style-iso-1",
      organizationId: IDS.orgIso,
      code: "ST-ISO-01",
      name: "隔离款",
      category: "针织",
      silhouette: "圆领",
      status: "approved",
      imagePath: "/styles/st-26018.svg",
      demoNote: "第二组织款式",
      createdByUserId: IDS.userIso,
    },
  });

  await client.supplierQuote.create({
    data: {
      id: "quote-mat001",
      organizationId: IDS.orgDemo,
      supplierId: IDS.supplierQinghe,
      materialId: IDS.materialMat001,
      unit: "m",
      unitPriceMinor: 2000,
      moq: "300",
      multiple: "10",
      validFrom: "2026-08-01",
      demoNote: "虚构报价 20.00 元/米",
    },
  });

  const historical = await client.salesOrder.create({
    data: {
      id: IDS.orderHistorical,
      organizationId: IDS.orgDemo,
      orderNo: "DEMO-ORD-001",
      customerId: IDS.customerNorthshore,
      factoryId: IDS.factoryYunshan,
      status: "completed",
      productionReadiness: "shipped",
      externalCustomerPo: "NB-PO-2025-088",
      requestedDeliveryText: "2026-06-30",
      requestedDeliveryDate: "2026-06-30",
      notes: "历史已完成翻单对照订单，PO 不得沿用",
      lines: {
        create: {
          id: "line-ord-001",
          styleId: IDS.styleSt26018,
          styleVersionId: IDS.versionSt26018V1,
          totalQuantity: 800,
          colors: {
            create: [
              { id: "color-ord-001-navy", colorName: "海军蓝", quantity: 500, sizes: { create: sizeRows("navy", [50, 100, 200, 100, 50]) } },
              { id: "color-ord-001-grey", colorName: "灰色", quantity: 300, sizes: { create: sizeRows("grey", [30, 60, 120, 60, 30]) } },
            ],
          },
        },
      },
    },
  });

  await client.salesOrder.create({
    data: {
      id: IDS.orderShortage,
      organizationId: IDS.orgDemo,
      orderNo: "DEMO-ORD-002",
      customerId: IDS.customerNorthshore,
      factoryId: IDS.factoryYunshan,
      status: "confirmed",
      productionReadiness: "blocked_material",
      externalCustomerPo: "NB-PO-2026-014",
      requestedDeliveryDate: "2026-10-15",
      requestedDeliveryText: "2026-10-15",
      notes: "缺料演示订单，材料需求日 2026-10-01",
      lines: {
        create: {
          id: "line-ord-002",
          styleId: "style-st-26001",
          styleVersionId: "version-ST-26001-v1",
          totalQuantity: 1000,
          colors: { create: [{ id: "color-ord-002-navy", colorName: "海军蓝", quantity: 1000 }] },
        },
      },
    },
  });

  const otherOrders = [
    { id: "order-demo-003", no: "DEMO-ORD-003", styleId: "style-st-26009", status: "draft", readiness: "sales_sample", customerId: "customer-qinglan", po: "QL-S-01", qty: 40, note: "销售样" },
    { id: "order-demo-006", no: "DEMO-ORD-006", styleId: "style-st-26004", status: "confirmed", readiness: "leftover_usable", customerId: "customer-nanyu", po: "NY-06", qty: 300, note: "余料可用" },
    { id: "order-demo-007", no: "DEMO-ORD-007", styleId: "style-st-26010", status: "draft", readiness: "development", customerId: IDS.customerNorthshore, po: null, qty: 120, note: "开发中关联订单草稿" },
    { id: "order-demo-008", no: "DEMO-ORD-008", styleId: "style-st-26007", status: "confirmed", readiness: "ready_for_production", customerId: "customer-qinglan", po: "QL-08", qty: 400, note: "待投产" },
  ];
  for (const item of otherOrders) {
    await client.salesOrder.create({
      data: {
        id: item.id,
        organizationId: IDS.orgDemo,
        orderNo: item.no,
        customerId: item.customerId,
        factoryId: IDS.factoryYunshan,
        status: item.status,
        productionReadiness: item.readiness,
        externalCustomerPo: item.po,
        notes: item.note,
        lines: {
          create: {
            id: `line-${item.id}`,
            styleId: item.styleId,
            styleVersionId: `version-${STYLES.find((row) => row.id === item.styleId)?.code}-v1`,
            totalQuantity: item.qty,
            colors: { create: [{ id: `color-${item.id}`, colorName: "本色", quantity: item.qty }] },
          },
        },
      },
    });
  }

  await client.salesOrder.create({
    data: {
      id: "order-demo-005",
      organizationId: IDS.orgDemo,
      orderNo: "DEMO-ORD-005",
      customerId: "customer-qinglan",
      factoryId: IDS.factoryYunshan,
      status: "in_production",
      productionReadiness: "partial_shipped",
      externalCustomerPo: "QL-26005",
      notes: "部分出运演示",
      lines: {
        create: {
          id: "line-order-demo-005",
          styleId: "style-st-26002",
          styleVersionId: `version-${STYLES.find((row) => row.id === "style-st-26002")?.code}-v1`,
          totalQuantity: 1020,
          colors: {
            create: [
              {
                id: "color-order-demo-005-navy",
                colorName: "海军蓝",
                quantity: 600,
                sizes: {
                  create: [
                    { id: "size-005-navy-s", sizeCode: "S", quantity: 150 },
                    { id: "size-005-navy-m", sizeCode: "M", quantity: 250 },
                    { id: "size-005-navy-l", sizeCode: "L", quantity: 200 },
                  ],
                },
              },
              {
                id: "color-order-demo-005-grey",
                colorName: "灰色",
                quantity: 420,
                sizes: {
                  create: [
                    { id: "size-005-grey-s", sizeCode: "S", quantity: 100 },
                    { id: "size-005-grey-m", sizeCode: "M", quantity: 180 },
                    { id: "size-005-grey-l", sizeCode: "L", quantity: 140 },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  });

  await client.salesOrder.create({
    data: {
      id: IDS.orderColorHold,
      organizationId: IDS.orgDemo,
      orderNo: "DEMO-ORD-004",
      customerId: "customer-nanyu",
      factoryId: IDS.factoryYunshan,
      status: "confirmed",
      productionReadiness: "blocked_color_approval",
      externalCustomerPo: null,
      notes: "待颜色确认",
      lines: {
        create: {
          id: "line-order-demo-004",
          styleId: "style-st-26003",
          styleVersionId: "version-ST-26003-v1",
          totalQuantity: 600,
          colors: {
            create: [
              { id: "color-order-demo-004-navy", colorName: "海军蓝", quantity: 350 },
              { id: "color-order-demo-004-grey", colorName: "灰色", quantity: 250 },
            ],
          },
        },
      },
    },
  });

  await client.salesOrder.create({
    data: {
      id: "order-iso-1",
      organizationId: IDS.orgIso,
      orderNo: "ISO-ORD-001",
      customerId: "customer-iso",
      status: "confirmed",
      productionReadiness: "ready_for_production",
      notes: "隔离组织订单",
      lines: { create: { id: "line-iso-1", styleId: "style-iso-1", totalQuantity: 10, colors: { create: [{ id: "color-iso-1", colorName: "黑", quantity: 10 }] } } },
    },
  });

  await client.inventoryLot.createMany({
    data: [
      {
        id: "lot-mat001-oh",
        organizationId: IDS.orgDemo,
        materialId: IDS.materialMat001,
        locationId: IDS.supplierQinghe,
        ownerKind: "company",
        colorName: "海军蓝",
        qtyOnHand: "170",
        qtyAllocated: "50",
        qtyInbound: "0",
        qualityStatus: "qualified",
        availableFrom: "2026-09-01",
        demoNote: "在库 170，其中 50 已被其他订单占用，可分配 120",
      },
      {
        id: IDS.lotD06Wh,
        organizationId: IDS.orgDemo,
        materialId: IDS.materialD06,
        locationId: IDS.warehouse,
        ownerKind: "company",
        colorName: "本色",
        qtyOnHand: "200",
        qtyAllocated: "0",
        qtyInbound: "0",
        qualityStatus: "qualified",
        availableFrom: "2026-09-01",
        demoNote: "原料库 200 米，调拨到工厂不算领用",
      },
      {
        id: "lot-mat001-inb",
        organizationId: IDS.orgDemo,
        materialId: IDS.materialMat001,
        locationId: IDS.supplierQinghe,
        ownerKind: "company",
        colorName: "海军蓝",
        qtyOnHand: "0",
        qtyAllocated: "0",
        qtyInbound: "200",
        qualityStatus: "qualified",
        availableFrom: "2026-09-28",
        inboundEta: "2026-09-28",
        inboundNo: "DEMO-PO-MAT-002",
        demoNote: "在途 200 米，规划时可抵扣，未收货不是现货",
      },
    ],
  });
  await client.inventoryAllocation.create({
    data: { id: "alloc-ord002", lotId: "lot-mat001-oh", orderId: "order-demo-005", qty: "50", status: "held" },
  });

  await client.productionQty.createMany({
    data: [
      { id: "pq-start", orderId: "order-demo-005", kind: "started", quantity: 1020, idempotencyKey: "start-005", note: "投产" },
      { id: "pq-scrap", orderId: "order-demo-005", kind: "scrapped", quantity: 10, idempotencyKey: "scrap-005", note: "报废" },
      { id: "pq-wip", orderId: "order-demo-005", kind: "wip", quantity: 15, idempotencyKey: "wip-005", note: "在制" },
      { id: "pq-good", orderId: "order-demo-005", kind: "good", quantity: 995, idempotencyKey: "good-005", note: "合格" },
      { id: "pq-ship", orderId: "order-demo-005", kind: "shipped", quantity: 980, idempotencyKey: "ship-005", note: "已发运" },
    ],
  });

  await client.packingPlan.create({
    data: {
      id: "pack-plan-005-shipped",
      organizationId: IDS.orgDemo,
      orderId: "order-demo-005",
      status: "shipped",
      totalQty: 980,
      idempotencyKey: "pack-shipped-005-980",
      note: "已出运混装，未称重",
      cartons: {
        create: [
          {
            id: "pack-carton-005-1",
            cartonNo: "C-980-1",
            weightStatus: "pending",
            lines: {
              create: [
                { id: "pack-line-005-1-navy-s", colorName: "海军蓝", sizeCode: "S", quantity: 80 },
                { id: "pack-line-005-1-navy-m", colorName: "海军蓝", sizeCode: "M", quantity: 120 },
                { id: "pack-line-005-1-grey-s", colorName: "灰色", sizeCode: "S", quantity: 50 },
                { id: "pack-line-005-1-grey-m", colorName: "灰色", sizeCode: "M", quantity: 70 },
              ],
            },
          },
          {
            id: "pack-carton-005-2",
            cartonNo: "C-980-2",
            weightStatus: "pending",
            lines: {
              create: [
                { id: "pack-line-005-2-navy-m", colorName: "海军蓝", sizeCode: "M", quantity: 100 },
                { id: "pack-line-005-2-navy-l", colorName: "海军蓝", sizeCode: "L", quantity: 90 },
                { id: "pack-line-005-2-grey-m", colorName: "灰色", sizeCode: "M", quantity: 80 },
                { id: "pack-line-005-2-grey-l", colorName: "灰色", sizeCode: "L", quantity: 70 },
              ],
            },
          },
          {
            id: "pack-carton-005-3",
            cartonNo: "C-980-3",
            weightStatus: "pending",
            lines: {
              create: [
                { id: "pack-line-005-3-navy-s", colorName: "海军蓝", sizeCode: "S", quantity: 40 },
                { id: "pack-line-005-3-navy-m", colorName: "海军蓝", sizeCode: "M", quantity: 80 },
                { id: "pack-line-005-3-navy-l", colorName: "海军蓝", sizeCode: "L", quantity: 80 },
                { id: "pack-line-005-3-grey-s", colorName: "灰色", sizeCode: "S", quantity: 50 },
                { id: "pack-line-005-3-grey-l", colorName: "灰色", sizeCode: "L", quantity: 70 },
              ],
            },
          },
        ],
      },
    },
  });

  await client.taskItem.createMany({
    data: [
      { id: "task-color-004", organizationId: IDS.orgDemo, title: "ST-26003 灰色确认被退回", kind: "missing_approval", status: "open", blocking: true, relatedOrderId: "order-demo-004", relatedStyleId: "style-st-26003", note: "关键批准缺失" },
      { id: "task-material-002", organizationId: IDS.orgDemo, title: "MAT-001 在途日期需核验", kind: "late_material_risk", status: "open", blocking: true, relatedOrderId: IDS.orderShortage, note: "物料到货变化待评估" },
    ],
  });

  await client.confirmationRecord.createMany({
    data: [
      { id: "conf-navy", orderId: IDS.orderHistorical, colorName: "海军蓝", round: 1, status: "approved", evidence: "历史确认单 V1" },
      {
        id: "conf-navy-004",
        orderId: IDS.orderColorHold,
        materialId: IDS.materialMat001,
        colorName: "海军蓝",
        round: 1,
        status: "approved",
        evidence: "色样第一轮通过",
      },
      {
        id: "conf-grey",
        orderId: IDS.orderColorHold,
        materialId: IDS.materialMat001,
        colorName: "灰色",
        round: 1,
        status: "rejected",
        evidence: "手感不符退回",
      },
    ],
  });

  await client.salesOrder.updateMany({
    where: { organizationId: IDS.orgDemo },
    data: { createdByUserId: IDS.userSales },
  });
  await client.salesOrder.updateMany({
    where: { organizationId: IDS.orgIso },
    data: { createdByUserId: IDS.userIso },
  });

  await client.auditEvent.create({
    data: {
      id: "audit-seed",
      organizationId: IDS.orgDemo,
      actorType: "system",
      action: "seed.completed",
      entityType: "Organization",
      entityId: IDS.orgDemo,
      summary: "已载入虚构演示数据",
      payloadJson: JSON.stringify({ historicalOrderId: historical.id, passwordHint: "见 README" }),
    },
  });
}

function sizeRows(prefix: string, qtys: number[]) {
  const sizes = ["XS", "S", "M", "L", "XL"];
  return sizes.map((size, index) => ({
    id: `size-${prefix}-${size}`,
    sizeCode: size,
    quantity: qtys[index] ?? 0,
  }));
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    console.log("Seed completed. Demo password: DemoPass!2026");
  } finally {
    await prisma.$disconnect();
  }
}

const invoked = process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts");
if (invoked) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
