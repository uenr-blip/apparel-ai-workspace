import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ingestInboxAttachment } from "@/server/services/inbox-attachment";
import { prepareCustomerIntake } from "@/server/services/customer-intake";
import { checkTradeOrigin } from "@/server/services/trade-http";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["salesperson", "manager"].includes(session.role)) return NextResponse.json({ error: "当前角色不能录入客户资料" }, { status: 403 });
  try { checkTradeOrigin(request); } catch { return NextResponse.json({error:"请求来源不匹配"},{status:403}); }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择 JPG、PNG、PDF、CSV 或 XLSX" }, { status: 400 });
  }
  try {
    const ingested = await ingestInboxAttachment({
      organizationId: session.organizationId,
      userId: session.id,
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      declaredMime: file.type,
    });
    if (!ingested.alreadyExisted) await prepareCustomerIntake({ organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId }, ingested.source.id, { useModel: form.get("useModel") === "true" });
    return NextResponse.json({
      sourceId: ingested.source.id,
      alreadyExisted: ingested.alreadyExisted,
      recognized: false,
      extractedBom: false,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "保存失败";
    const message = raw.includes("Unknown argument") || raw.includes("Invalid `") ? "保存失败，请刷新后重试" : raw;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
