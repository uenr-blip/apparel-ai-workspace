import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ExecutionError } from "@/server/services/execution";
import { readSheetImage } from "@/server/services/sheet-image";
import { canFactorySeeSheetImage } from "@/server/services/pattern-workflow";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    if(!await canFactorySeeSheetImage({organizationId:session.organizationId,userId:session.id,role:session.role,factoryId:session.factoryId},id))return NextResponse.json({error:"图片不存在或未分配给本厂"},{status:404});
    const image = await readSheetImage(session.organizationId, id);
    return new NextResponse(Uint8Array.from(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof ExecutionError ? error.message : "读取失败";
    return NextResponse.json({ error: message }, { status: message.includes("不存在") ? 404 : 400 });
  }
}
