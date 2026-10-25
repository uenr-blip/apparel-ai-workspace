"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  Inbox,
  Shirt,
  Warehouse,
  Truck,
  Layers3,
  PencilRuler,
  Settings,
  UserRound,
  WalletCards,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/card";
import { BrandLockup, BrandMark } from "@/components/brand-mark";
import { ChromeControls } from "@/components/chrome-controls";
import { BRAND } from "@/lib/brand";
import { NAV_COLLAPSED_KEY, navCollapsedFromStorage, serverSafeNavCollapsed } from "@/lib/nav";
import type { SessionUser } from "@/lib/auth";
import { businessHref, visibleBusinessNav, type BusinessSection } from "@/lib/business-navigation";
import { NavigationProvider, useBusinessSection } from "@/components/navigation-scope";

const NAV_ICONS = { workspace: BriefcaseBusiness, intake: Inbox, development: PencilRuler, sales: Shirt, bulk: Layers3, production: Truck, finance: WalletCards, resources: Warehouse };
type NavItem = ReturnType<typeof visibleBusinessNav>[number];

const navListeners = new Set<() => void>();

function subscribeNav(listener: () => void) {
  navListeners.add(listener);
  return () => navListeners.delete(listener);
}

function readNavCollapsed() {
  return navCollapsedFromStorage(window.localStorage.getItem(NAV_COLLAPSED_KEY));
}

function writeNavCollapsed(next: boolean) {
  localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
  for (const listener of navListeners) listener();
}

export function AppShell(props: AppShellProps) {
  return <NavigationProvider><AppShellContent {...props} /></NavigationProvider>;
}

type AppShellProps = {
  user: SessionUser;
  avatarSrc?: string;
  aiModeLabel: string;
  pilotMode?: boolean;
  organizationName?: string;
  canOpenFinance?: boolean;
  children: ReactNode;
};

function AppShellContent({
  user,
  avatarSrc = "",
  aiModeLabel,
  pilotMode = false,
  organizationName,
  canOpenFinance = false,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const activeSection = useBusinessSection();
  const nav = visibleBusinessNav(user.role, canOpenFinance);
  const mobileHref = pathname === "/profile" || pathname === "/settings" ? pathname : activeSection ? businessHref(activeSection) : "";
  const router = useRouter();
  const collapsed = useSyncExternalStore(subscribeNav, readNavCollapsed, serverSafeNavCollapsed);

  function toggleRail() {
    writeNavCollapsed(!collapsed);
  }

  return (
    <div className="app-frame relative flex min-h-screen text-[var(--ink)]">
      <aside
        className={cn(
          "app-aside rail sticky top-0 z-30 hidden h-screen shrink-0 md:flex md:flex-col",
          collapsed ? "w-[52px]" : "w-[232px]",
        )}
      >
        {collapsed ? (
          <>
            <div className="relative flex justify-center pt-3">
              <RailToggle collapsed onClick={toggleRail} />
            </div>
            <nav aria-label="主要导航" className="relative flex flex-1 flex-col items-center gap-1 overflow-y-auto px-1 py-3">
              {nav.map((item) => (
                <IconNavLink key={item.href} item={item} active={activeSection === item.id} />
              ))}
            </nav>
            <div className="relative flex flex-col items-center px-1 pb-3">
              <AccountMenu user={user} avatarSrc={avatarSrc} placement="right" />
            </div>
          </>
        ) : (
          <>
            <div className="relative flex items-start justify-between gap-2 px-3 py-4">
              <Link href="/workspace" className="min-w-0">
                <BrandLockup compact />
              </Link>
              <RailToggle collapsed={false} onClick={toggleRail} />
            </div>
            <p className="relative px-4 pb-3 text-[11px] leading-5 text-[var(--ink-muted)]">{pilotMode ? "业务试用版 · 请核对实际业务资料" : BRAND.disclaimer}</p>
            <nav aria-label="主要导航" className="relative flex-1 space-y-3 overflow-y-auto px-2 pb-4">
              <NavGroup title="开始工作" activeSection={activeSection} items={nav.filter(item => item.group === "start")} />
              <NavGroup title="业务办理" activeSection={activeSection} items={nav.filter(item => item.group === "business")} />
              <NavGroup title="共用资料" activeSection={activeSection} items={nav.filter(item => item.group === "shared")} />
            </nav>
            <div className="relative px-2 pb-3">
              <AccountMenu user={user} avatarSrc={avatarSrc} showName placement="up" />
            </div>
          </>
        )}
      </aside>
      <div className="app-stage relative flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:flex-nowrap md:px-5">
          <div className="flex w-full min-w-0 items-center gap-2 md:hidden">
            <BrandMark size={28} />
            <label className="min-w-0 flex-1">
              <span className="sr-only">切换工作区</span>
              <select
                aria-label="切换工作区"
                value={mobileHref}
                onChange={(event) => router.push(event.target.value)}
                className="h-10 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-2 text-sm text-[var(--ink)]"
              >
                {!nav.some(item => item.href === mobileHref) && mobileHref !== "/profile" && mobileHref !== "/settings" ? <option value={mobileHref} disabled>选择工作区</option> : null}
                {nav.map((item) => (
                  <option key={item.href} value={item.href}>
                    {item.label}
                  </option>
                ))}
                <option value="/profile">个人资料</option>
                <option value="/settings">设置</option>
              </select>
            </label>
          </div>
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <Badge tone="ai">{aiModeLabel}</Badge>
            <Badge tone="neutral">{organizationName || (user.organizationId === "org-demo" ? "演示服装公司" : "当前公司")}</Badge>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-sm">
            <ChromeControls />
            <div className="md:hidden">
              <AccountMenu user={user} avatarSrc={avatarSrc} showName placement="down" />
            </div>
          </div>
        </header>
        <main className="relative flex w-full min-h-0 flex-1 flex-col px-4 pb-4 pt-4 md:px-6 md:pb-5 md:pt-5">{children}</main>
      </div>
    </div>
  );
}

function RailToggle({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={collapsed}
      aria-label={collapsed ? "展开功能栏" : "折叠功能栏"}
      title={collapsed ? "展开功能栏" : "折叠功能栏"}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--nav-hover)] hover:text-[var(--ink)]"
    >
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>
  );
}

function IconNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = NAV_ICONS[item.id];
  return (
    <Link
      href={item.href}
      title={`${item.label} · ${item.note}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg transition-all",
        active
          ? "bg-[var(--nav-active-bg)] text-[var(--brand-strong)] shadow-[var(--nav-active-shadow)]"
          : "text-[var(--ink)] hover:bg-[var(--nav-hover)]",
      )}
    >
      <Icon size={18} strokeWidth={1.6} />
      <span className="sr-only">{item.label}</span>
    </Link>
  );
}

function NavGroup({
  title,
  activeSection,
  items,
}: {
  title: string;
  activeSection: BusinessSection | null;
  items: NavItem[];
}) {
  return (
    <div>
      <p className="px-3 pb-2 text-[10px] font-medium tracking-[0.2em] text-[var(--ink-muted)]">{title}</p>
      <div className="space-y-0.5">
        {items.map((item) => {
          const active = activeSection === item.id;
          const Icon = NAV_ICONS[item.id];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]",
                active
                  ? "bg-[var(--nav-active-bg)] font-medium text-[var(--brand-strong)] shadow-[var(--nav-active-shadow)]"
                  : "text-[var(--ink)] hover:bg-[var(--nav-hover)]",
              )}
            >
              <Icon size={18} strokeWidth={1.6} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0"><span className="block leading-6">{item.label}</span><span className="block text-[11px] font-normal leading-4 text-[var(--ink-muted)]">{item.note}</span></span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function roleLabel(role: string) {
  if (role === "manager") return "经理";
  if (role === "factory") return "工厂协作员";
  return "业务员";
}

function AccountFace({
  name,
  avatarSrc,
  size,
}: {
  name: string;
  avatarSrc: string;
  size: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--brand)] font-semibold text-[var(--on-brand)]",
        size === "md" ? "h-8 w-8 text-xs" : "h-7 w-7 text-[10px]",
      )}
    >
      {avatarSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarSrc} alt="" data-no-zoom="true" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}

function AccountMenu({
  user,
  avatarSrc = "",
  showName = false,
  placement,
}: {
  user: SessionUser;
  avatarSrc?: string;
  showName?: boolean;
  placement: "up" | "right" | "down";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const role = roleLabel(user.role);
  const profileActive = pathname === "/profile" || pathname.startsWith("/profile/");
  const settingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${user.name}，${role}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center rounded-xl text-left hover:bg-[var(--nav-hover)]",
          showName ? "w-full gap-2.5 px-2 py-2" : "h-9 w-9 justify-center",
        )}
      >
        <AccountFace name={user.name} avatarSrc={avatarSrc} size={showName ? "md" : "sm"} />
        {showName ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-5">{user.name}</span>
              <span className="block truncate text-xs text-[var(--ink-muted)]">{role}</span>
            </span>
            <ChevronDown size={14} className={cn("shrink-0 text-[var(--ink-muted)]", open && "rotate-180")} />
          </>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute z-50 overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--menu-bg)] py-1 text-[var(--ink)] shadow-[var(--shadow-float)]",
            placement === "up" && "bottom-full left-0 right-0 mb-2",
            placement === "right" && "bottom-0 left-full ml-2 w-52",
            placement === "down" && "right-0 top-full mt-2 w-52",
          )}
        >
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <AccountFace name={user.name} avatarSrc={avatarSrc} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-[var(--ink-muted)]">{role}</p>
            </div>
          </div>
          <div className="my-1 border-t border-[var(--line)]" />
          <Link
            href="/profile"
            role="menuitem"
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--menu-hover)]",
              profileActive && "text-[var(--brand-strong)]",
            )}
            onClick={() => setOpen(false)}
          >
            <UserRound size={15} strokeWidth={1.6} />
            个人资料
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--menu-hover)]",
              settingsActive && "text-[var(--brand-strong)]",
            )}
            onClick={() => setOpen(false)}
          >
            <Settings size={15} strokeWidth={1.6} />
            设置
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--menu-hover)]"
            onClick={() => void logout()}
          >
            退出
          </button>
        </div>
      ) : null}
    </div>
  );
}
