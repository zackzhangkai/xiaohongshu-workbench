// Store-mode ZIP writer (UTF-8 names, no third-party dependency), mirroring
// the browser-side builder in src/publish-download.js. Generated images are
// already-compressed formats, so storing without deflate keeps bytes stable.
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
/** @param {{ name: string, bytes: Uint8Array }[]} entries */
export function createZipBuffer(entries) {
  const parts = [], directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'), bytes = Buffer.from(entry.bytes);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    parts.push(local, bytes);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    directory.push(central);
    offset += local.length + bytes.length;
  }
  const length = directory.reduce((n, part) => n + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}
