const ACTION_TYPES: Record<string, string> = {
  create_order_draft: "创建订单草稿",
  create_style_version_draft: "创建资料版本草稿",
  create_development_project: "创建开发款式",
  save_pattern_sheet: "保存版单",
  apply_pattern_reference: "采用部分版单参考",
  save_order_merch: "保存销售样和大货",
  create_follow_sheet: "新建跟单",
  open_follow_order: "跟单开成生产订单",
  create_internal_task: "创建内部任务",
  complete_order_prep: "补齐订单资料",
  save_style_bom_draft: "写入款式面辅料草稿",
  create_style_master: "新建款式主档",
  save_style_process_draft: "写入工艺与版次草稿",
  attach_style_pattern: "上传版次附件",
  create_material_master: "新建材料主档",
  create_design_project: "创建设计草案",
  generate_design_image: "生成设计方案",
  adopt_design_draft: "采用设计转入开发",
  record_color_confirmation: "记录颜色确认",
  link_source: "关联资料",
  adopt_purchase_option: "采用采购方案",
  assign_order_factory: "指派工厂",
  record_production_qty: "登记产量",
  create_packing_draft: "保存装箱草稿",
  occupy_packing: "确认装箱占用",
  ship_packing: "确认出运",
  record_carton_weight: "录入箱重",
  generate_factory_recon: "生成对账草稿",
  release_to_production: "批准投产",
  issue_purchase_order: "下达采购",
  post_inventory: "过账库存",
  approve_bom: "批准资料版本",
};

const PARSE_STATUS: Record<string, string> = {
  queued: "排队中",
  succeeded: "已解析",
  failed: "解析失败",
  needs_review: "待审核",
  saved_without_vision: "已保存，未识款",
};

const PROPOSAL_STATUS: Record<string, string> = {
  preview: "待批准",
  executed: "已执行",
  rejected: "已拒绝",
  expired: "已过期",
};

const EXECUTION_STATUS: Record<string, string> = {
  succeeded: "已完成",
  failed: "失败",
};

const STYLE_STATUS: Record<string, string> = {
  approved: "已有批准资料",
  sales_sample: "销售样",
  development: "开发中",
  draft: "资料草稿",
};

const ORDER_STATUS: Record<string, string> = {
  draft: "草稿",
  confirmed: "已确认",
  completed: "已完成",
  in_production: "生产中",
};

const READINESS: Record<string, string> = {
  blocked_follow_change: "客户改单后待重新核对投产",
  blocked_factory_transfer: "转厂待交接与投产核对",
  blocked_incomplete_spec: "规格不全，不能投产",
  blocked_unapproved_spec: "资料已保存，罗纹规格待批准",
  spec_approved: "资料版本已批准，投产尚未开放",
  blocked_material: "材料未齐",
  blocked_color_approval: "颜色确认未通过",
  color_approved: "分色已确认，不能投产",
  ready_for_production: "可投产",
  shipped: "已出运",
  sales_sample: "销售样",
  leftover_usable: "余料可用",
  partial_shipped: "部分出运",
  development: "开发中",
};

const TASK_KIND: Record<string, string> = {
  follow_change_review: "客户改单影响待跟进",
  factory_transfer_handover: "转厂交接待核对",
  pattern_handoff_review: "回样交接资料待核对",
  missing_size_breakdown: "待补尺码",
  missing_rib_spec: "待确认罗纹",
  missing_delivery_year: "待确认交期年份",
  late_material_risk: "物料到货待核验",
  missing_approval: "关键批准缺失",
  material_test_pending: "材料试验未完成",
  design_draft_review: "核对设计草案",
  chain_over_use: "领用超本单需求",
  chain_transfer: "该调到厂",
  chain_consume: "已调未领",
  chain_collect: "核对本单收付",
};

const FIELD_KIND: Record<string, string> = {
  extracted: "原文摘出",
  inferred: "推断",
  unknown: "未知",
  conflict: "冲突",
};

const INTENT: Record<string, string> = {
  reorder: "翻单",
  material_dev: "材料开发",
  order_change: "订单补充",
  unknown: "未识别",
};

const PROJECT_STATUS: Record<string, string> = {
  open: "进行中",
  linked: "已关联款号",
};

const ORIGIN: Record<string, string> = {
  "inbox-paste": "粘贴客户邮件或消息",
  "inbox-upload": "上传图片或扫描件",
  "inbox-tabular": "上传表格",
  "inbox-pdf": "上传文字 PDF",
  "order-prep": "订单补资料",
  "order-amendment-paste": "客户补充消息",
  "oral-order": "口头建单",
  order_chain: "本单链上规则",
  design_studio: "AI设计工作台",
};

const ENTITY: Record<string, string> = {
  SalesOrder: "订单",
  SourceDocument: "资料",
  DevelopmentProject: "开发款式",
  DesignProject: "设计草案",
  Style: "款式",
  StyleVersion: "资料版本",
  ActionProposal: "操作提案",
  PackingPlan: "装箱方案",
  FactoryReconDraft: "对账草稿",
};

const CONFIRMATION_STATUS: Record<string, string> = {
  approved: "已批准",
  rejected: "已退回",
};

const MATERIAL_KIND: Record<string, string> = {
  fabric: "面料",
  yarn: "纱线",
  trim: "辅料",
};

const PARTY_KIND: Record<string, string> = {
  supplier: "供应商",
  factory: "工厂",
  warehouse: "原料库",
  customer: "客户",
};

const PRODUCTION_KIND: Record<string, string> = {
  transfer_in: "在制接收（接续）",
  transfer_out: "在制转出",
  started: "投产",
  scrapped: "报废",
  wip: "在制",
  good: "合格",
  shipped: "已发运",
  rework: "返工",
};

const PRODUCTION_STAGE: Record<string, string> = {
  not_started: "未投产",
  in_progress: "生产中",
  leftover_unshipped: "余货未发完",
  shipped: "已发运完",
};

const PACKING_STATUS: Record<string, string> = {
  draft: "装箱草稿",
  occupied: "已装箱占用",
  shipped: "已出运",
};

const RECON_STATUS: Record<string, string> = {
  draft: "对账草稿",
  needs_basis: "基准待核实",
};

const ROLE: Record<string, string> = {
  salesperson: "业务员",
  manager: "经理",
  factory: "工厂协作员",
};

const WEIGHT_STATUS: Record<string, string> = {
  pending: "待称重",
  estimated: "估算",
  measured: "实测",
};

function pick(map: Record<string, string>, value: string | null | undefined, fallback?: string) {
  if (!value) return fallback ?? "—";
  return map[value] ?? fallback ?? value;
}

export const labels = {
  actionType: (value: string) => pick(ACTION_TYPES, value),
  parseStatus: (value: string) => pick(PARSE_STATUS, value),
  proposalStatus: (value: string) => pick(PROPOSAL_STATUS, value),
  executionStatus: (value: string) => pick(EXECUTION_STATUS, value),
  orderStatus: (value: string) => pick(ORDER_STATUS, value),
  styleStatus: (value: string) => pick(STYLE_STATUS, value),
  readiness: (value: string) => pick(READINESS, value),
  taskKind: (value: string) => pick(TASK_KIND, value),
  fieldKind: (value: string) => pick(FIELD_KIND, value),
  intent: (value: string) => pick(INTENT, value),
  projectStatus: (value: string) => pick(PROJECT_STATUS, value),
  origin: (value: string) => pick(ORIGIN, value),
  entity: (value: string) => pick(ENTITY, value),
  materialKind: (value: string) => pick(MATERIAL_KIND, value),
  partyKind: (value: string) => pick(PARTY_KIND, value),
  confirmationStatus: (value: string) => pick(CONFIRMATION_STATUS, value),
  productionKind: (value: string) => pick(PRODUCTION_KIND, value),
  productionStage: (value: string) => pick(PRODUCTION_STAGE, value),
  packingStatus: (value: string) => pick(PACKING_STATUS, value),
  weightStatus: (value: string) => pick(WEIGHT_STATUS, value),
  reconStatus: (value: string) => pick(RECON_STATUS, value),
  role: (value: string) => pick(ROLE, value),
};
