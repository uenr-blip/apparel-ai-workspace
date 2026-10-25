export function encodeMonoWav(samples: Float32Array, sampleRate = 16000) {
  if (!samples.length || samples.length > sampleRate * 31) throw new Error("录音最长30秒，请分段输入");
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for(let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  text(0,"RIFF"); view.setUint32(4,36+samples.length*2,true); text(8,"WAVE"); text(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,"data"); view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++) { const n=Math.max(-1,Math.min(1,samples[i])); view.setInt16(44+i*2,n<0?n*32768:n*32767,true); }
  return bytes;
}
