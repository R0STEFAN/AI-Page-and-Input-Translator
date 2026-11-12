import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Minimal PNG generator with solid RGB color filling
async function createPngBuffer(width, height) {
  function dword(val) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(val, 0);
    return b;
  }

  function chunk(type, data) {
    const len = dword(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = dword(zlib.crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.concat([
    dword(width),
    dword(height),
    Buffer.from([8, 6, 0, 0, 0]) // 8-bit depth, RGBA (6)
  ]);
  const ihdr = chunk('IHDR', ihdrData);

  // Image data: each scanline starts with filter byte 0, followed by width * 4 RGBA bytes
  const scanlines = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // Filter none
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 4;
      // Blue-violet gradient with letter / symbol area
      row[idx] = 37;      // R: #2563EB
      row[idx + 1] = 99;  // G
      row[idx + 2] = 235; // B
      row[idx + 3] = 255; // A
    }
    scanlines.push(row);
  }

  const rawData = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(rawData);
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

const iconsDir = path.resolve('icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const buf = await createPngBuffer(size, size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buf);
  console.log(`Generated icon${size}.png (${buf.length} bytes)`);
}
