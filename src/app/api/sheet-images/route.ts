import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { storeSheetImage } from "@/server/services/sheet-image";
import { checkTradeOrigin } from "@/server/services/trade-http";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.role === "factory") return NextResponse.json({ error: "当前角色不能上传款式图" }, { status: 403 });
  try { checkTradeOrigin(request); } catch { return NextResponse.json({error:"请求来源不匹配"},{status:403}); }
  const stated=Number(request.headers.get("content-length")||0);if(stated>6*1024*1024)return NextResponse.json({error:"图片超过5MB"},{status:413});
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "请选择 JPG 或 PNG" }, { status: 400 });
  try {
    const result = await storeSheetImage(session.organizationId, Buffer.from(await file.arrayBuffer()),session.id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "图片没有传上" }, { status: 400 });
  }
}
