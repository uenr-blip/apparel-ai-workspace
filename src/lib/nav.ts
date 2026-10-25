export const NAV_COLLAPSED_KEY = "yiju-nav-collapsed";

export function serverSafeNavCollapsed(): boolean {
  return false;
}

export function navCollapsedFromStorage(value: string | null | undefined): boolean {
  return value === "1";
}
