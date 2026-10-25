import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sha256, sha256Bytes } from "@/lib/hash";
import { styleImageSrc } from "@/lib/style-image";
import { PATTERN_FIELDS, fieldValue, readPatternContent, type PatternContent, type PatternField } from "@/lib/pattern-workflow";
import type { PatternCatalogResults, PatternCatalogSource } from "@/lib/pattern-catalog";
import type { TradeActor } from "./trade-contract";
import { authorizePattern, PatternError } from "./pattern-workflow";
import { putPrivateFile, readPrivateFile } from "@/server/storage/local";

type Db = Prisma.TransactionClient;
const sheetImage = /^\/api\/sheet-images\/[\w-]{8,80}$/;
const displayDate = (date: Date) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
const activeImage = (c: PatternContent) => (c.craftFamily === "sweater" ? c.sweater : c.fabric).imagePath;
const technicalContent = (c: PatternContent) => {
  const clean = readPatternContent(c.craftFamily, "{}");
  for (const f of Object.keys(PATTERN_FIELDS) as PatternField[]) {
    const [group, key] = f.split(".");
    (clean[group as "sweater" | "fabric"] as unknown as Record<string, string>)[key] = fieldValue(c, f);
  }
  return clean;
};

export async function searchPatternCatalog(actor: TradeActor, query: string): Promise<PatternCatalogResults> {
  await authorizePattern(actor);
  const q = query.trim();
  if (q.length > 100) throw new PatternError("搜索内容请控制在100字内");
  const [projects, styles] = await Promise.all([
    prisma.developmentProject.findMany({ where: { organizationId: actor.organizationId, ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }, { style: { code: { contains: q } } }, { style: { name: { contains: q } } }] } : {}) }, include: { style: { select: { id: true, imagePath: true } }, patternRevisions: { orderBy: { number: "desc" }, take: 1 } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 21 }),
    prisma.style.findMany({ where: { organizationId: actor.organizationId, ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }] } : {}) }, include: { _count: { select: { versions: { where: { status: "approved" } } } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 21 }),
  ]);
  return { limited: projects.length > 20 || styles.length > 20, items: [
    ...projects.slice(0,20).map(p => { const r = p.patternRevisions[0]; const c = readPatternContent(r?.craftFamily ?? p.craftFamily, r?.sheetJson ?? p.sheetJson); return { id: `project:${p.id}`, label: `${p.code} ${p.name}`, imageSrc: activeImage(c) || (p.style ? styleImageSrc(p.style) : ""), description: r ? `开发版单 · 最近留档 V${r.number}` : c.craftFamily ? "开发版单 · 当前草稿，采用时固定快照" : "开发款式 · 版单尚未填写" }; }),
    ...styles.slice(0,20).map(s => ({ id: `style:${s.id}`, label: `${s.code} ${s.name}`, imageSrc: s.imagePath ? styleImageSrc(s) : "", description: s._count.versions ? "款式主档 · 可选资料版本与材料" : "款式主档 · 暂无已批准资料，可参考图片" })),
  ] };
}

// Only callers that have checked the actual user/organization may use this inside a transaction.
export async function loadPatternCatalogSource(db: Db, org: string, requestedId: string, materialId = ""): Promise<PatternCatalogSource> {
  const [kind, id, extra] = requestedId.split(":");
  if (!id || extra || id.length > 100) throw new PatternError("参考来源无效，请重新选择");
  if (kind === "project" || kind === "revision" || kind === "draft") {
    const revision = kind === "revision" ? await db.patternRevision.findFirst({ where: { id, project: { organizationId: org } } }) : null;
    if (kind === "revision" && !revision) throw new PatternError("来源版次不存在或无权查看");
    const p = await db.developmentProject.findFirst({ where: { id: revision?.projectId ?? id, organizationId: org }, include: { patternRevisions: { orderBy: { number: "desc" }, take: 30 } } });
    if (!p) throw new PatternError("来源开发款式不存在或无权查看");
    const r = revision ?? (kind === "project" ? p.patternRevisions[0] : undefined);
    const raw = readPatternContent(r?.craftFamily ?? p.craftFamily, r?.sheetJson ?? p.sheetJson);
    const sourceId = r ? `revision:${r.id}` : `draft:${p.id}`;
    const label = `${p.code} ${p.name} · ${r ? `版单 V${r.number}` : `草稿快照 ${displayDate(p.updatedAt)}（北京时间）`}`;
    const content = technicalContent(raw), imageSrc = activeImage(raw);
    const choices = p.patternRevisions.map(v => ({ id: `revision:${v.id}`, label: `版单 V${v.number} · ${v.reason}` }));
    choices.push({ id: `draft:${p.id}`, label: "当前草稿（未正式留档，采用时固定快照）" });
    return { sourceId, materialId: "", label, content, imageSrc, canAttachImage: sheetImage.test(imageSrc), choices, materials: [], notes: r ? ["只参考选中参数；原版单的报价、库存和其他参考关系不会带入。"] : ["来源尚未正式留档。本次保存会固定当时的资料快照，不会给原款新增版次，也不表示资料已批准。"], fields: (Object.keys(PATTERN_FIELDS) as PatternField[]).filter(f => f.startsWith(raw.craftFamily === "sweater" ? "sweater." : "fabric.") && !!fieldValue(content,f)), fingerprint: sha256(JSON.stringify({ sourceId, label, content, imageSrc, stamp: r?.createdAt ?? p.updatedAt })) };
  }
  if (kind !== "style" && kind !== "version") throw new PatternError("不支持的参考来源");
  const version = kind === "version" ? await db.styleVersion.findFirst({ where: { id, status: "approved", style: { organizationId: org } } }) : null;
  if (kind === "version" && !version) throw new PatternError("来源资料版本不存在、未批准或无权查看");
  const style = await db.style.findFirst({ where: { id: version?.styleId ?? id, organizationId: org }, include: { versions: { where: { status: "approved" }, orderBy: { versionNumber: "desc" }, take: 30, include: { bomLines: { include: { material: true }, orderBy: { id: "asc" } } } } } });
  if (!style) throw new PatternError("来源款式不存在或无权查看");
  const v = version ? style.versions.find(r => r.id === version.id) : style.versions[0];
  if (version && !v) throw new PatternError("该资料版本不在最近30版内，请先打开原款核对");
  const materials = [...new Map((v?.bomLines ?? []).filter(b => b.material.organizationId === org && ["fabric", "yarn"].includes(b.material.kind)).map(b => [b.material.id, b.material])).values()];
  const material = materialId ? materials.find(m => m.id === materialId) : materials.length === 1 ? materials[0] : undefined;
  if (materialId && !material) throw new PatternError("材料不属于所选款式资料版本");
  const content = readPatternContent(material?.kind === "yarn" ? "sweater" : "", "{}");
  if (material?.kind === "yarn") content.sweater.yarnComposition = material.composition;
  if (material?.kind === "fabric") Object.assign(content.fabric, { fabricComposition: material.composition, gsm: material.gsm, width: material.widthCm, spec: material.specSummary });
  const sourceId = v ? `version:${v.id}` : `style:${style.id}`;
  const label = `${style.code} ${style.name}${v ? ` · 资料 V${v.versionNumber}` : " · 主档图片"}${material ? ` · ${material.code} ${material.name}` : ""}`;
  const privateRaster = style.imagePath.startsWith(`styles/${org}/`) && /\.(jpg|png)$/i.test(style.imagePath);
  return { sourceId, materialId: material?.id ?? "", label, content, fields: (Object.keys(PATTERN_FIELDS) as PatternField[]).filter(f => !!fieldValue(content,f)), imageSrc: style.imagePath ? styleImageSrc(style) : "", canAttachImage: privateRaster, choices: style.versions.map(v => ({ id: `version:${v.id}`, label: `资料 V${v.versionNumber} · ${v.changeSummary}` })), materials: materials.map(m => ({ id: m.id, label: `${m.code} ${m.name}` })), notes: [materials.length > 1 && !material ? "这款有多种面料或纱线，请先选本次参考哪一种；系统不会猜哪块是大身或里布。" : "这里只带入材料主档明确记录的成分、克重、门幅和规格；未填写的参数保持本款原值。", "原资料批准状态、尺寸文字、工艺说明、供应商、报价和库存不自动套用。", ...(!privateRaster && style.imagePath ? ["该图仅供查看，如需放入发厂参考，请另外上传 JPG/PNG。"] : [])], fingerprint: sha256(JSON.stringify({ sourceId, label, content, imagePath: style.imagePath, materialId: material?.id ?? "", status: v?.status, approvedAt: v?.approvedAt })) };
}

export async function getPatternCatalogSource(actor: TradeActor, sourceId: string, materialId = "") {
  await authorizePattern(actor);
  return loadPatternCatalogSource(prisma, actor.organizationId, sourceId, materialId);
}

export async function snapshotCatalogImage(db: Db, org: string, source: PatternCatalogSource): Promise<string[]> {
  if (!source.canAttachImage) throw new PatternError("这张图片不能直接附入，请重新选择或上传参考图");
  if (sheetImage.test(source.imageSrc)) return [source.imageSrc];
  const [kind, id] = source.sourceId.split(":");
  const style = await db.style.findFirst({ where: { organizationId: org, ...(kind === "style" ? { id } : { versions: { some: { id } } }) } });
  if (!style || !style.imagePath.startsWith(`styles/${org}/`) || !/\.(jpg|png)$/i.test(style.imagePath)) throw new PatternError("来源图片已变化，请重新选择");
  const bytes = await readPrivateFile(style.imagePath);
  // Content-addressed copies remain stable when the style replaces/deletes its current photo.
  const imageId = `catalog-${sha256Bytes(bytes)}`;
  const ext = style.imagePath.toLowerCase().endsWith(".png") ? "png" : "jpg";
  await putPrivateFile(`sheets/${org}/${imageId}.${ext}`, bytes);
  return [`/api/sheet-images/${imageId}`];
}
