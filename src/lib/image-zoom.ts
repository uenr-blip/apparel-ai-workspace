export function shouldOpenImageZoom(target: EventTarget | null) {
  if (!(target instanceof HTMLImageElement)) return false;
  if (target.hasAttribute("data-no-zoom")) return false;
  if (target.closest("[data-no-zoom]")) return false;
  if (target.closest(".file-well")) return false;
  if (target.closest(".image-zoom-layer")) return false;
  const src = target.currentSrc || target.src;
  return Boolean(src);
}
