import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readStylePatternFile } from "@/server/services/style-process";

export async function GET(_request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, attachmentId } = await context.params;
  try {
    const file = await readStylePatternFile({
      organizationId: session.organizationId,
      styleId: id,
      attachmentId,
    });
    return new NextResponse(Uint8Array.from(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取失败";
    return NextResponse.json({ error: message }, { status: message.includes("不存在") ? 404 : 400 });
  }
}
