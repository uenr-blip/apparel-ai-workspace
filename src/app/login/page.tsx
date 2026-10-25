import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLockup, BrandWordmarkEn } from "@/components/brand-mark";
import { ChromeControls } from "@/components/chrome-controls";
import { BRAND } from "@/lib/brand";
import { getLoginPresentation } from "@/lib/login-policy";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const mode = getLoginPresentation();
  const demo = mode === "demo";
  return (
    <div className="relative min-h-screen">
      <div className="absolute right-4 top-4 z-20 md:right-6 md:top-6">
        <ChromeControls />
      </div>
      <div className="grid min-h-screen items-center gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:px-12 xl:px-16">
        <section className="relative max-w-2xl">
          <BrandLockup />
          <p className="mt-4 text-sm tracking-[0.08em] text-[var(--ink-muted)]">{BRAND.product}</p>
          <p className="mt-10 font-[family-name:var(--font-display)] text-[2.6rem] font-normal leading-[1.18] tracking-[-0.04em] text-[var(--ink)] md:text-[3.4rem]">
            {BRAND.tagline}
          </p>
          <p className="mt-6 max-w-md text-sm leading-7 text-[var(--ink-muted)]">
            {BRAND.description}
          </p>
          <p className="mt-10 text-[11px] tracking-[0.14em] text-[var(--ink-muted)]">
            {mode === "pilot" ? "业务试用版 · 业务流程仍需实际验证" : `${BRAND.disclaimer} · 不是生产系统`}
          </p>
        </section>
        <section className="relative lg:justify-self-stretch">
          <div className="vitrine relative mx-auto w-full max-w-md p-8 md:p-10 lg:mx-0 lg:max-w-none">
            <p className="text-[11px] tracking-[0.22em] text-[var(--ink-muted)]">{mode === "pilot" ? "业务试用" : "内部验证"}</p>
            <h1 className="mt-3 flex items-center gap-3 font-[family-name:var(--font-display)] text-3xl font-normal tracking-[0.14em]">
              {BRAND.name}
              <BrandWordmarkEn className="h-4 w-[72px] shrink-0" />
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
              {demo ? "本地演示账号使用虚构资料。" : mode === "pilot" ? "请使用分配给你的试用账号。每人的操作分别记录，请勿共用账号。" : "登录尚未配置完成，请联系试用负责人。"}
            </p>
            <form action={loginAction} className="mt-8 space-y-4">
              <label className="block text-sm">
                邮箱
                <Input className="mt-1.5" type="email" name="email" defaultValue={demo ? "salesperson@demo.local" : ""} maxLength={254} required autoComplete="username" />
              </label>
              <label className="block text-sm">
                密码
                <Input className="mt-1.5" type="password" name="password" defaultValue={demo ? "DemoPass!2026" : ""} maxLength={72} required autoComplete="current-password" />
              </label>
              {params.error ? <p className="text-sm text-[var(--danger)]">{params.error}</p> : null}
              <Button type="submit" disabled={mode === "disabled"} className="mt-2 w-full">
                进入工作台
              </Button>
            </form>
            {demo ? <div className="mt-7 space-y-1 text-xs text-[var(--ink-muted)]">
              <p>业务员 salesperson@demo.local</p>
              <p>经理 manager@demo.local</p>
              <p>工厂 factory@demo.local</p>
              <p>密码均为 DemoPass!2026</p>
            </div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
