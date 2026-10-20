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
  { tiled = false, compression = 1, big = false, metadataPadding = 0, rowsPerStrip = 32 } = {},
) {
  const bw = tiled ? 256 : width,
    bh = tiled ? 256 : rowsPerStrip,
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
// Compose standard TIFF pages, rebasing only TIFF offsets (not pixel values).
module.exports.withPages = function (pages, { subIFDs = false } = {}) {
  const buffers = pages.map(([w, h]) =>
    module.exports(w, h, { compression: 8, metadataPadding: 8192 }),
  );
  const starts = [];
  let size = 0;
  for (const b of buffers) {
    starts.push(size);
    size += b.length;
  }
  for (let page = 0; page < buffers.length; page++) {
    const b = buffers[page],
      delta = starts[page],
      count = b.readUInt16LE(8);
    for (let i = 0; i < count; i++) {
      const p = 10 + i * 12,
        tag = b.readUInt16LE(p),
        type = b.readUInt16LE(p + 2),
        amount = b.readUInt32LE(p + 4),
        inline = (type === 3 ? 2 : 4) * amount <= 4;
      if (tag === 273 || tag === 324) {
        if (inline) b.writeUInt32LE(b.readUInt32LE(p + 8) + delta, p + 8);
        else {
          const table = b.readUInt32LE(p + 8);
          for (let n = 0; n < amount; n++)
            b.writeUInt32LE(b.readUInt32LE(table + n * 4) + delta, table + n * 4);
        }
      }
      if (!inline) b.writeUInt32LE(b.readUInt32LE(p + 8) + delta, p + 8);
    }
    b.writeUInt32LE(page + 1 < buffers.length ? starts[page + 1] + 8 : 0, 10 + count * 12);
  }
  if (subIFDs) {
    // Add one inline SubIFD to the first page in padding, copying its IFD there.
    const first = buffers[0],
      n = first.readUInt16LE(8),
      newIfd = 512;
    first.copy(first, newIfd, 8, 10 + n * 12);
    first.writeUInt16LE(n + 1, newIfd);
    const p = newIfd + 2 + n * 12;
    first.writeUInt16LE(330, p);
    first.writeUInt16LE(4, p + 2);
    first.writeUInt32LE(1, p + 4);
    first.writeUInt32LE(starts[1] + 8, p + 8);
    first.writeUInt32LE(0, p + 12);
    first.writeUInt32LE(newIfd, 4);
  }
  return Buffer.concat(buffers);
};
