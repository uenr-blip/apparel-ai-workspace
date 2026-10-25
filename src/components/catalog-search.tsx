"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BusinessSearchInput } from "@/components/business-search-input";
import { buildCatalogHref } from "@/lib/catalog-query";

export function CatalogSearch({
  action,
  q,
  placeholder,
  extras = {},
}: {
  action: string;
  q: string;
  placeholder: string;
  extras?: Record<string, string>;
}) {
  const router = useRouter();
  const clearHref = buildCatalogHref(action, extras, "");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQ = String(new FormData(event.currentTarget).get("q") ?? "");
    router.replace(buildCatalogHref(action, extras, nextQ), { scroll: false });
  }

  return (
    <form action={action} method="get" onSubmit={onSubmit} className="flex flex-wrap items-end gap-2" role="search">
      {Object.entries(extras).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <BusinessSearchInput key={q} defaultValue={q} placeholder={placeholder} className="min-w-[min(220px,100%)] flex-1"/>
      <Button type="submit" size="sm">
        检索
      </Button>
      {q ? (
        <Link href={clearHref} scroll={false} className="mb-1 text-sm text-[var(--brand-strong)]">
          清除
        </Link>
      ) : null}
    </form>
  );
}
