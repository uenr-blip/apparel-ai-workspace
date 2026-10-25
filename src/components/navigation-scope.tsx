"use client";

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { businessSectionForRoute } from "@/lib/business-navigation";

type Scope = { route: string; section: "sales" | "bulk" } | null;
const NavigationContext = createContext<{ scope: Scope; setScope: Dispatch<SetStateAction<Scope>> } | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>(null);
  return <NavigationContext.Provider value={{ scope, setScope }}>{children}</NavigationContext.Provider>;
}

// The server page already loads and authorizes the record; do not fetch another copy for navigation.
export function FollowNavigationScope({ kind }: { kind: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const route = `${pathname}?${params.toString()}`;
  const setScope = useContext(NavigationContext)?.setScope;
  useEffect(() => {
    if (!setScope || !["sales_sample", "sales", "bulk"].includes(kind)) return;
    const next: Scope = { route, section: kind === "sales_sample" || kind === "sales" ? "sales" : "bulk" };
    setScope(next);
    return () => setScope(current => current === next ? null : current);
  }, [route, kind, setScope]);
  return null;
}

export function useBusinessSection() {
  const pathname = usePathname();
  const params = useSearchParams();
  const context = useContext(NavigationContext);
  const route = `${pathname}?${params.toString()}`;
  return businessSectionForRoute(pathname, params, context?.scope?.route === route ? context.scope.section : undefined);
}
