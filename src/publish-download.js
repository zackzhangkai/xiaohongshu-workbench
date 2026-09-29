const encoder = new TextEncoder();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// ZIP store mode, UTF-8 names, no third-party dependency or network upload.
export function createZip(entries) {
  const parts = [], directory = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), bytes = entry.bytes;
    const crc = crc32(bytes), local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    parts.push(local, bytes);
    const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
    directory.push(central); offset += local.length + bytes.length;
  }
  const length = directory.reduce((n, p) => n + p.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, length, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function imageBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('图片读取失败，请检查素材是否仍存在');
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif)(?:;|$)/i.test(blob.type)) throw new Error('素材不是支持的图片文件');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const valid = (bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10)
    || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || /^GIF8[79]a$/.test(ascii(0, 6)) || (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP');
  if (!valid) throw new Error('图片文件已损坏或格式不匹配');
  return bytes;
}
export const imageName = (url, index) => `${String(index + 1).padStart(2, '0')}-${index === 0 ? '封面' : '配图'}.${url.split('.').pop()}`;
