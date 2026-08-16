// Pack assets/icon-{16,24,32,48,64,128,256}.png into a single .ico
// (PNG-compressed entries; fully supported on Windows Vista+ / 11).
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../assets/', import.meta.url).pathname.replace(/^\/([A-Za-z]):\//, '$1:/').replace(/\//g, '/');
const sizes = [16, 24, 32, 48, 64, 128, 256];

const bufs = sizes.map((s) => readFileSync(`${dir}icon-${s}.png`));
const headerSize = 6 + 16 * bufs.length;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(bufs.length, 4);

let offset = headerSize;
bufs.forEach((b, i) => {
  const o = 6 + 16 * i;
  header.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], o); // width (0 => 256)
  header.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], o + 1); // height
  header.writeUInt8(0, o + 2); // palette
  header.writeUInt8(0, o + 3); // reserved
  header.writeUInt16LE(1, o + 4); // planes
  header.writeUInt16LE(32, o + 6); // bpp
  header.writeUInt32LE(b.length, o + 8); // bytes in image
  header.writeUInt32LE(offset, o + 12); // offset
  offset += b.length;
});

const ico = Buffer.concat([header, ...bufs]);
const out = `${dir}icon.ico`;
writeFileSync(out, ico);
console.log(`wrote ${out}  (${ico.length} bytes, ${bufs.length} sizes)`);
