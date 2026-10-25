"use client";
import Image from "next/image";
import { FileText } from "lucide-react";
import { useState } from "react";

/** Document cover cards are labelled by type; they do not pretend to be rendered page contents. */
export function AttachmentThumbnail({ href, name, mime = "", caption }: { href: string; name: string; mime?: string; caption?: string }) {
  const [failed, setFailed] = useState(false);
  const isImage = !failed && (/^image\/(png|jpeg|webp|gif)$/.test(mime) || /\.(png|jpe?g|webp|gif)$/i.test(name));
  const ext = (name.split(".").pop() || "文件").slice(0, 8).toUpperCase();
  const downloadOnly = href.startsWith("blob:") && !["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime);
  return <a href={href} download={downloadOnly ? name : undefined} target="_blank" rel="noreferrer" className="attachment-thumbnail" aria-label={`打开 ${name}`}>
    {isImage ? <Image src={href} alt={name} width={72} height={72} unoptimized onError={() => setFailed(true)} className="attachment-thumbnail-image" /> : <span className="attachment-thumbnail-document" aria-hidden><FileText size={28} strokeWidth={1.4} /><span>{ext}</span></span>}
    <span className="attachment-thumbnail-copy"><span className="attachment-thumbnail-name">{name}</span><span className="attachment-thumbnail-caption">{caption || (isImage ? "点击放大查看" : "点击打开原文件")}</span></span>
  </a>;
}
