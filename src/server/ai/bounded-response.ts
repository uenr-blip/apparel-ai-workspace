export async function responseBytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length") || 0)>max) throw new Error("服务返回内容超过限制");
  const reader=response.body?.getReader(); if(!reader) throw new Error("服务未返回内容");
  const parts: Uint8Array[]=[]; let size=0;
  try { for(;;) {const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max){await reader.cancel();throw new Error("服务返回内容超过限制");}parts.push(r.value);} } finally {reader.releaseLock();}
  return Buffer.concat(parts);
}
