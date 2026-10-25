export const DESIGN_WORKFLOWS = [
  {
    id: "recolor",
    intent: "recolor",
    kicker: "改色",
    title: "定向改色",
    body: "只改口袋、领口或指定部位的颜色，其余结构保持。一次出一组色路。",
    hint: "只改袋鼠口袋成可可红，帽兜和领保持原色",
  },
  {
    id: "reference",
    intent: "reference",
    kicker: "参考",
    title: "参考生成",
    body: "用草图、款图或色卡生成能看的方案。不必先有正式款号。",
    hint: "宽松卫衣，干净背景，保留原结构",
  },
  {
    id: "edit",
    intent: "edit",
    kicker: "改款",
    title: "定向修改",
    body: "改口袋、袖口、领型。选定一版再往下改，上一轮图留着比较。",
    hint: "口袋加深，领口保持，袖口略收",
  },
  {
    id: "onbody",
    intent: "onbody",
    kicker: "上身",
    title: "上身看款",
    body: "把款穿到人身上看。不是版型终审，只是把想法说清楚。",
    hint: "正面上身，自然光，全身可见",
  },
] as const;

export const DESIGN_PARTS = ["全身", "帽兜", "领", "主体", "袖", "袋鼠口袋", "下摆"] as const;

export const DESIGN_COLORWAYS = [
  { id: "ivory", label: "米白", swatch: "#f4efe6" },
  { id: "chartreuse", label: "嫩绿", swatch: "#c5d36a" },
  { id: "cocoa", label: "可可红", swatch: "#b44a3a" },
  { id: "cream", label: "奶油", swatch: "#efe4c8" },
  { id: "dusty", label: "雾蓝", swatch: "#8aa4b8" },
  { id: "brown", label: "暖棕", swatch: "#8a5a3a" },
] as const;
