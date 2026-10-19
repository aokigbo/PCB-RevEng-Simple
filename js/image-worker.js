"use strict";
importScripts("image-pyramid.js", "../vendor/geotiff-3.0.4.js");
async function writeFile(dir, name, data) {
  const h = await dir.getFileHandle(name, { create: true }),
    w = await h.createWritable();
  try {
    await w.write(data);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
}
async function normalImageSize(file) {
  const b = new Uint8Array(await file.slice(0, 1048576).arrayBuffer()),
    v = new DataView(b.buffer);
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71)
    return [v.getUint32(16), v.getUint32(20)];
  if (b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 255) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      i += 2;
      if (marker === 216 || marker === 217) continue;
      const n = v.getUint16(i);
      if ([192, 193, 194].includes(marker)) return [v.getUint16(i + 5), v.getUint16(i + 3)];
      if (n < 2) break;
      i += n;
    }
  }
  throw new Error("Use an 8-bit RGB TIFF, PNG or JPEG image.");
}
self.onmessage = async ({ data: { file, id, root } }) => {
  let pool, bitmap;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer()),
      tiff = (head[0] === 73 && head[1] === 73) || (head[0] === 77 && head[1] === 77);
    let width, height, read;
    if (tiff) {
      const source = await GeoTIFF.fromBlob(file),
        image = await source.getImage(),
        fd = image.getFileDirectory();
      width = image.getWidth();
      height = image.getHeight();
      if (
        Array.from(fd.getValue("BitsPerSample") || []).some((n) => n !== 8) ||
        ![0, 1, 2, 3].includes(fd.getValue("PhotometricInterpretation"))
      )
        throw new Error("This TIFF is not a supported 8-bit RGB/grayscale/palette scan.");
      const block = image.getTileWidth() * image.getTileHeight() * image.getSamplesPerPixel();
      const stripe =
        image.getTileWidth() * Math.max(image.getTileHeight(), 512) * image.getSamplesPerPixel();
      if (Math.max(block, stripe) > 128 * 1024 * 1024)
        throw new Error(
          "This TIFF uses oversized strips/tiles. Re-save it as a tiled TIFF or with shorter strips (under 128 MiB decoded per block).",
        );
      const compressed = fd.getValue("TileByteCounts") || fd.getValue("StripByteCounts") || [];
      if (Array.from(compressed).some((n) => n > 128 * 1024 * 1024))
        throw new Error(
          "A compressed TIFF block exceeds the 128 MiB import limit. Re-save with smaller strips or tiles.",
        );
      pool = new GeoTIFF.Pool(2);
      read = async (x, y, w, h) => {
        const rgb = await image.readRGB({ window: [x, y, x + w, y + h], pool, interleave: true });
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
          rgba[j] = rgb[i];
          rgba[j + 1] = rgb[i + 1];
          rgba[j + 2] = rgb[i + 2];
          rgba[j + 3] = 255;
        }
        return new ImageData(rgba, w, h);
      };
    } else {
      [width, height] = await normalImageSize(file);
      if (width * height * 4 > 128 * 1024 * 1024)
        throw new Error(
          "For scans above 32 megapixels, use TIFF so import can read small windows.",
        );
      bitmap = await createImageBitmap(file, { imageOrientation: "none" });
      read = async (x, y, w, h) => {
        const c = new OffscreenCanvas(w, h),
          ctx = c.getContext("2d");
        ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h);
      };
    }
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 1e7 ||
      height > 1e7
    )
      throw new Error("Invalid scan dimensions.");
    const levels = pyramidLevels(width, height),
      images = await root.getDirectoryHandle("images", { create: true }),
      dir = await images.getDirectoryHandle("scan-" + id, { create: true });
    const total = levels.reduce(
      (n, l) => n + Math.ceil(l.width / 512) * Math.ceil(l.height / 512),
      0,
    );
    let done = 0;
    const levelDirs = [];
    for (const l of levels) {
      const dest = await dir.getDirectoryHandle("L" + l.level, { create: true });
      levelDirs.push(dest);
      for (let ty = 0; ty < Math.ceil(l.height / 512); ty++)
        for (let tx = 0; tx < Math.ceil(l.width / 512); tx++) {
          const w = Math.min(512, l.width - tx * 512),
            h = Math.min(512, l.height - ty * 512),
            c = new OffscreenCanvas(w, h),
            ctx = c.getContext("2d");
          if (l.level === 0) {
            ctx.putImageData(await read(tx * 512, ty * 512, w, h), 0, 0);
          } else {
            const prev = levels[l.level - 1];
            for (let dy = 0; dy < 2; dy++)
              for (let dx = 0; dx < 2; dx++) {
                const x = tx * 2 + dx,
                  y = ty * 2 + dy;
                if (x * 512 >= prev.width || y * 512 >= prev.height) continue;
                const fh = await levelDirs[l.level - 1].getFileHandle(x + "_" + y + ".png"),
                  img = await createImageBitmap(await fh.getFile());
                ctx.drawImage(img, dx * 256, dy * 256, img.width / 2, img.height / 2);
                img.close();
              }
          }
          await writeFile(
            dest,
            tx + "_" + ty + ".png",
            await c.convertToBlob({ type: "image/png" }),
          );
          done++;
          self.postMessage({ message: "Preparing L" + l.level, done, total });
        }
    }
    const manifest = { complete: true, width, height, tileSize: 512, levels };
    await writeFile(dir, "manifest.json", JSON.stringify(manifest));
    self.postMessage({ done: true, manifest });
  } catch (e) {
    self.postMessage({ error: e.message });
  } finally {
    pool?.destroy();
    bitmap?.close();
  }
};
