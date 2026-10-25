import { requireSession } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/sheet";
import { getUserProfile } from "@/server/services/profile";
import { ProfileForm } from "./profile-form";

function roleLabel(role: string) {
  if (role === "manager") return "经理";
  if (role === "factory") return "工厂协作员";
  return "业务员";
}

export default async function ProfilePage() {
  const session = await requireSession();
  const profile = await getUserProfile(session.id, session.organizationId);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={BRAND.name}
        title="个人资料"
        description="只改自己的头像和显示名。邮箱和角色只读，设计师名单不是这个账号。"
      />
      <Tile className="max-w-xl space-y-5 p-5">
        <ProfileForm
          name={profile.name}
          email={profile.email}
          roleLabel={roleLabel(profile.role)}
          avatarSrc={profile.avatarSrc}
        />
      </Tile>
    </div>
  );
}
