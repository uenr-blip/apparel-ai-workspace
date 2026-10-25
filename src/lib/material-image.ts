export function materialImageSrc(material: { id: string; imagePath: string }) {
  if (!material.imagePath) return "";
  if (material.imagePath.startsWith("/")) return material.imagePath;
  const file = material.imagePath.split("/").pop() ?? "image";
  const stamp = file.replace(/\.[^.]+$/, "").split("-").pop() ?? "v";
  return `/api/materials/${material.id}/image?v=${stamp}`;
}
