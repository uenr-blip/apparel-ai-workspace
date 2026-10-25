import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ProfileError, readAvatar, replaceAvatar } from "@/server/services/profile";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const image = await readAvatar(session.id, session.organizationId);
    return new NextResponse(Uint8Array.from(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof ProfileError ? error.message : "读取失败";
    const status = message.includes("还没有") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择 JPG 或 PNG" }, { status: 400 });
  }
  try {
    const profile = await replaceAvatar({
      userId: session.id,
      organizationId: session.organizationId,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({
      name: profile.name,
      avatarSrc: profile.avatarSrc,
    });
  } catch (error) {
    const message = error instanceof ProfileError ? error.message : "保存失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
