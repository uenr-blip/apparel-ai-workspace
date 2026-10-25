export function styleImageSrc(style: { id: string; imagePath: string }) {
  if (style.imagePath.startsWith("/")) return style.imagePath;
  const file = style.imagePath.split("/").pop() ?? "image";
  const stamp = file.replace(/\.[^.]+$/, "").split("-").pop() ?? "v";
  return `/api/styles/${style.id}/image?v=${stamp}`;
}
