const { deflateSync } = require("node:zlib");
function lzwLiteral(bytes) {
  const codes = [];
  for (const b of bytes) codes.push(256, b);
  codes.push(257);
  const out = Buffer.alloc(Math.ceil((codes.length * 9) / 8));
  let bit = 0;
  for (const code of codes)
    for (let i = 8; i >= 0; i--) {
      out[bit >> 3] |= ((code >> i) & 1) << (7 - (bit & 7));
      bit++;
    }
  return out;
}
module.exports = function makeTiff(
  width,
  height,
  { tiled = false, compression = 1, big = false, metadataPadding = 0 } = {},
) {
  const bw = tiled ? 256 : width,
    bh = tiled ? 256 : 32,
    nx = Math.ceil(width / bw),
    ny = Math.ceil(height / bh),
    chunks = [];
  for (let by = 0; by < ny; by++)
    for (let bx = 0; bx < nx; bx++) {
      const rows = tiled ? bh : Math.min(bh, height - by * bh),
        raw = Buffer.alloc(bw * rows * 3);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < bw; x++) {
          const gx = bx * bw + x,
            gy = by * bh + y;
          if (gx >= width || gy >= height) continue;
          const p = (y * bw + x) * 3;
          raw[p] = gx % 256;
          raw[p + 1] = gy % 256;
          raw[p + 2] = (gx + gy) % 256;
        }
      chunks.push(compression === 8 ? deflateSync(raw) : compression === 5 ? lzwLiteral(raw) : raw);
    }
  const n = chunks.length,
    count = tiled ? 11 : 10,
    header = big ? 16 : 8,
    countSize = big ? 8 : 2,
    entrySize = big ? 20 : 12,
    nextSize = big ? 8 : 4,
    ifd = header,
    bits = ifd + countSize + count * entrySize + nextSize,
    offsets = bits + 6 + metadataPadding,
    counts = offsets + n * 4,
    pixels = counts + n * 4;
  const buffer = Buffer.alloc(pixels + chunks.reduce((n, c) => n + c.length, 0));
  buffer.write("II");
  buffer.writeUInt16LE(big ? 43 : 42, 2);
  if (big) {
    buffer.writeUInt16LE(8, 4);
    buffer.writeBigUInt64LE(BigInt(ifd), 8);
    buffer.writeBigUInt64LE(BigInt(count), ifd);
  } else {
    buffer.writeUInt32LE(ifd, 4);
    buffer.writeUInt16LE(count, ifd);
  }
  const tags = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 3, bits],
    [259, 3, 1, compression],
    [262, 3, 1, 2],
    [277, 3, 1, 3],
    [284, 3, 1, 1],
    ...(tiled
      ? [
          [322, 4, 1, bw],
          [323, 4, 1, bh],
          [324, 4, n, n === 1 ? pixels : offsets],
          [325, 4, n, n === 1 ? chunks[0].length : counts],
        ]
      : [
          [273, 4, n, n === 1 ? pixels : offsets],
          [278, 4, 1, bh],
          [279, 4, n, n === 1 ? chunks[0].length : counts],
        ]),
  ].sort((a, b) => a[0] - b[0]);
  tags.forEach(([tag, type, amount, value], i) => {
    const p = ifd + countSize + i * entrySize;
    buffer.writeUInt16LE(tag, p);
    buffer.writeUInt16LE(type, p + 2);
    if (big) buffer.writeBigUInt64LE(BigInt(amount), p + 4);
    else buffer.writeUInt32LE(amount, p + 4);
    const data = p + (big ? 12 : 8);
    if (big && tag === 258) {
      [0, 2, 4].forEach((i) => buffer.writeUInt16LE(8, data + i));
    } else if (type === 3 && amount === 1) buffer.writeUInt16LE(value, data);
    else if (big && type === 4 && amount === 2) {
      buffer.writeUInt32LE(tag === 324 || tag === 273 ? pixels : chunks[0].length, data);
      buffer.writeUInt32LE(
        tag === 324 || tag === 273 ? pixels + chunks[0].length : chunks[1].length,
        data + 4,
      );
    } else buffer.writeUInt32LE(value, data);
  });
  [0, 2, 4].forEach((i) => buffer.writeUInt16LE(8, bits + i));
  let position = pixels;
  chunks.forEach((chunk, i) => {
    buffer.writeUInt32LE(position, offsets + i * 4);
    buffer.writeUInt32LE(chunk.length, counts + i * 4);
    chunk.copy(buffer, position);
    position += chunk.length;
  });
  return buffer;
};
