import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ProfileError, updateDisplayName } from "@/server/services/profile";

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  try {
    const profile = await updateDisplayName({
      userId: session.id,
      organizationId: session.organizationId,
      name: body?.name ?? "",
    });
    return NextResponse.json({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      avatarSrc: profile.avatarSrc,
    });
  } catch (error) {
    const message = error instanceof ProfileError ? error.message : "保存失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
