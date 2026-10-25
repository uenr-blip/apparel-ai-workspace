import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { sha256 } from "@/lib/hash";
import { COMMON_PATTERN_CHOICES, PATTERN_CHOICE_FIELDS, PATTERN_PRICE_FIELDS, choiceIdentity, choiceKey, isPatternChoiceField, type PatternChoice, type PatternChoiceField, type PatternChoices } from "@/lib/pattern-choices";
import { readPatternSheet } from "@/server/domain/craft-sheet";
import type { PatternContent } from "@/lib/pattern-workflow";
import type { TradeActor } from "./trade-contract";

const prefix = "pattern:entry-choice:";
const visibilityPrefix = (userId: string) => `pattern:choice-visibility:${sha256(userId)}:`;
const VisibilitySchema = z.array(z.object({ field: z.enum(PATTERN_CHOICE_FIELDS), value: z.string().trim().min(1).max(400), supplier: z.string().max(400).optional(), hidden: z.boolean(), expectedHidden: z.boolean() }).strict()).max(100);

/** Personal, reversible candidate visibility; never deletes a supplier, old sheet or shared value. */
export async function savePatternChoiceVisibility(db: Prisma.TransactionClient, actor: TradeActor, projectId: string, input: unknown, basisAuditId: string) {
  const changes = VisibilitySchema.parse(input ?? []);
  if (!changes.length) return;
  const choices = await listPatternChoices(db, actor.organizationId, actor.userId);
  const processed = new Set<string>();
  for (const change of changes) {
    const identity = choiceIdentity(change.field, change);
    if (processed.has(identity)) throw new Error("同一候选不能重复提交，请重新核对");
    processed.add(identity);
    if (!choices[change.field]?.some(row => choiceIdentity(change.field, row) === identity)) throw new Error("候选来源已变化，请刷新后重新核对");
    const key = `${visibilityPrefix(actor.userId)}${sha256(identity)}`;
    const previous = await db.organizationPolicy.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key } } });
    const before = previous?.enabled ?? false;
    if (before !== change.expectedHidden) throw new Error("候选设置已变化，请刷新后重新核对");
    if (before === change.hidden) continue;
    const id = `pattern-visibility-${sha256(`${actor.organizationId}:${key}`)}`;
    const data = { enabled: change.hidden, valueJson: JSON.stringify({ field: change.field, value: change.value, supplier: change.supplier ?? "" }) };
    await db.organizationPolicy.upsert({ where: { organizationId_key: { organizationId: actor.organizationId, key } }, create: { id, organizationId: actor.organizationId, key, note: "个人版单候选显示设置，可恢复，不改变业务记录", ...data }, update: data });
    await db.auditEvent.create({ data: { id: `${basisAuditId}:visibility:${sha256(identity)}`, organizationId: actor.organizationId, actorUserId: actor.userId, actorType: "user", entityType: "PatternChoiceVisibility", entityId: previous?.id ?? id, action: "development.pattern_choice_visibility", summary: change.hidden ? "移出我的版单候选" : "恢复我的版单候选", payloadJson: JSON.stringify({ before: { hidden: before }, after: { hidden: change.hidden }, choice: data.valueJson, basis: { projectId, patternAuditId: basisAuditId } }) } });
  }
}
type StoredChoice = PatternChoice & { field: PatternChoiceField; specification?: string[] };
function entries(content: ReturnType<typeof readPatternSheet>, code: string, date: string): StoredChoice[] {
  const group = content.craftFamily === "sweater" ? "sweater" : content.craftFamily ? "fabric" : null;
  if (!group) return [];
  const supplier = group === "sweater" ? content.sweater.yarnSupplier : content.fabric.supplier;
  const specification = group === "sweater"
    ? [content.sweater.yarnComposition, content.sweater.yarnCount, content.sweater.bodyStructure]
    : [content.fabric.fabricComposition, content.fabric.spec, content.fabric.gsm, content.fabric.width];
  return PATTERN_CHOICE_FIELDS.filter(field => field.startsWith(`${group}.`)).flatMap(field => {
    const key = field.split(".")[1];
    const value = (content[group] as unknown as Record<string, string>)[key]?.trim();
    if (!value) return [];
    const price = PATTERN_PRICE_FIELDS.includes(field);
    return [{ field, value, source: price ? "历史填写 · 待核对" : "已保存版单", detail: [code, date.slice(0, 10), ...(price ? [supplier || "未记供应商", ...specification.filter(Boolean)] : [])].join(" · "), ...(price ? { supplier, specification } : {}) }];
  });
}

/** Called only inside the authorized, locked pattern-save transaction. No independent save endpoint. */
export async function rememberPatternChoices(db: Prisma.TransactionClient, actor: TradeActor, project: { id: string; code: string }, content: PatternContent, basisAuditId: string, sourceDate = new Date().toISOString()) {
  for (const row of entries(content, project.code, sourceDate)) {
    const price = PATTERN_PRICE_FIELDS.includes(row.field);
    const key = `${prefix}${row.field}:${sha256(JSON.stringify([choiceKey(row.value), choiceKey(row.supplier ?? ""), price ? row.specification?.map(choiceKey) : ""]))}`;
    const existing = await db.organizationPolicy.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key } } });
    if (existing) continue;
    const id = `pattern-choice-${sha256(`${actor.organizationId}:${key}`)}`;
    await db.organizationPolicy.create({ data: { id, organizationId: actor.organizationId, key, note: "版单填写历史候选，不是业务规则、供应商建档或有效报价", valueJson: JSON.stringify(row) } });
    await db.auditEvent.create({ data: { id: `${id}-created`, organizationId: actor.organizationId, actorUserId: actor.userId, actorType: "user", entityType: "PatternFieldChoice", entityId: id, action: "development.pattern_choice_remembered", summary: "随版单保存填写候选", payloadJson: JSON.stringify({ before: null, after: row, basis: { projectId: project.id, patternAuditId: basisAuditId } }) } });
  }
}

/** Read after authorizePattern; factory views never receive these internal supplier/price choices. */
export async function listPatternChoices(db: Prisma.TransactionClient, organizationId: string, userId?: string): Promise<PatternChoices> {
  const [saved, suppliers, materials, drafts, visibility] = await Promise.all([
    db.organizationPolicy.findMany({ where: { organizationId, key: { startsWith: prefix }, enabled: true }, select: { valueJson: true } }),
    db.party.findMany({ where: { organizationId, kind: "supplier", archivedAt: null }, select: { code: true, name: true }, orderBy: { name: "asc" } }),
    db.material.findMany({ where: { organizationId, archivedAt: null }, select: { code: true, name: true, kind: true, composition: true, specSummary: true, gsm: true, widthCm: true }, orderBy: { code: "asc" }, take: 500 }),
    db.developmentProject.findMany({ where: { organizationId, archivedAt: null, craftFamily: { in: ["sweater", "knit", "woven"] } }, select: { code: true, craftFamily: true, sheetJson: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
    userId ? db.organizationPolicy.findMany({ where: { organizationId, key: { startsWith: visibilityPrefix(userId) }, enabled: true }, select: { key: true, valueJson: true } }) : Promise.resolve([]),
  ]);
  const result: PatternChoices = {}, seen = new Map<string, Set<string>>();
  function add(field: PatternChoiceField, choice: PatternChoice) {
    if (!choice.value.trim()) return;
    const key = JSON.stringify([choiceKey(choice.value), choiceKey(choice.supplier ?? ""), PATTERN_PRICE_FIELDS.includes(field) ? choice.detail : ""]);
    const keys = seen.get(field) ?? new Set<string>();
    if (keys.has(key)) return;
    keys.add(key); seen.set(field, keys); (result[field] ??= []).push(choice);
  }
  function addEntry(row: StoredChoice) {
    add(row.field, row);
    if (row.field === "sweater.yarnSupplier") add("fabric.supplier", row);
    if (row.field === "fabric.supplier") add("sweater.yarnSupplier", row);
  }
  for (const supplier of suppliers) {
    const row = { value: supplier.name, source: "供应商主档", detail: supplier.code };
    add("sweater.yarnSupplier", row); add("fabric.supplier", row);
  }
  for (const draft of drafts) for (const row of entries(readPatternSheet(draft.craftFamily, draft.sheetJson), draft.code, draft.updatedAt.toISOString())) addEntry(row);
  for (const record of saved) {
    try {
      const row: StoredChoice = JSON.parse(record.valueJson);
      if (isPatternChoiceField(row.field) && typeof row.value === "string" && typeof row.source === "string" && (!row.detail || typeof row.detail === "string") && (row.supplier === undefined || typeof row.supplier === "string")) addEntry(row);
    } catch { /* Invalid legacy metadata cannot become a suggestion. */ }
  }
  for (const material of materials) {
    const row = (value: string): PatternChoice => ({ value, source: "面辅料库", detail: `${material.code} ${material.name}` });
    if (material.kind === "yarn") add("sweater.yarnComposition", row(material.composition));
    if (material.kind === "fabric") {
      add("fabric.fabricComposition", row(material.composition)); add("fabric.gsm", row(material.gsm));
      add("fabric.width", row(material.widthCm)); add("fabric.spec", row(material.specSummary));
    }
    if (material.kind === "trim") add("fabric.trims", row(material.name));
  }
  for (const field of PATTERN_CHOICE_FIELDS) for (const row of COMMON_PATTERN_CHOICES[field] ?? []) add(field, row);
  // Keep removed items available for restoration, even if the source is later archived.
  const hidden = new Set(visibility.map(row => row.key));
  for (const record of visibility) {
    try {
      const row: StoredChoice = JSON.parse(record.valueJson);
      if (isPatternChoiceField(row.field) && typeof row.value === "string" && typeof row.supplier === "string" && !result[row.field]?.some(choice => choiceIdentity(row.field, choice) === choiceIdentity(row.field, row))) add(row.field, { value: row.value, supplier: row.supplier, source: "已移出的候选" });
    } catch { /* Ignore malformed historical preferences. */ }
  }
  for (const field of PATTERN_CHOICE_FIELDS) result[field] = result[field]?.map(row => ({ ...row, hidden: hidden.has(`${visibilityPrefix(userId ?? "")}${sha256(choiceIdentity(field, row))}`) }));
  return result;
}
