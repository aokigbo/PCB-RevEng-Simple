"use strict";
importScripts("../vendor/geotiff-3.0.4.js", "image-source.js");
const OpenSources = new Map(),
  Jobs = new Map(),
  Blocks = new Map(),
  Persistence = new Map(),
  CacheEpoch = new Map();
let blockBytes = 0,
  blockActive = 0,
  blockLimit = 3,
  active = 0,
  persistTimer = null,
  persisting = null;
const blockWaiters = [],
  pool = new GeoTIFF.Pool(
    Math.min(3, imageDecodeSlots(0, navigator.hardwareConcurrency, navigator.deviceMemory)),
  ),
  BLOCK_TARGET = 96 * 1024 * 1024;
const stats = (values) => self.postMessage({ stats: values });
function cancelled(signal) {
  if (signal?.aborted) throw new DOMException("Image request cancelled.", "AbortError");
}
async function writeFile(dir, name, data) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try {
    await w.write(data);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
}
async function scanDir(root, id) {
  return (await root.getDirectoryHandle("images")).getDirectoryHandle("scan-" + id);
}
async function sourceFor(root, epoch, scan) {
  const key = epoch + "/" + scan.id,
    dir = await scanDir(root, scan.id),
    manifest = JSON.parse(
      await (await (await dir.getFileHandle("manifest.json")).getFile()).text(),
    ),
    file = await (await dir.getFileHandle("source.tif")).getFile();
  if (
    file.size !== manifest.sourceSize ||
    (manifest.sourceLastModified && file.lastModified !== manifest.sourceLastModified)
  ) {
    OpenSources.delete(key);
    let current = "unreadable TIFF metadata";
    try {
      const { metadata } = await tiffMetadata(file);
      current = metadata.width + " × " + metadata.height + " pixels";
    } catch {}
    throw new Error(
      "Scan source changed unexpectedly: " +
        scan.name +
        " (" +
        current +
        "). Restore source.tif or add it as a new scan; derived cache has been ignored.",
    );
  }

  if (
    manifest.width !== scan.width ||
    manifest.height !== scan.height ||
    manifest.source !== "source.tif" ||
    manifest.cacheVersion !== IMAGE_CACHE_VERSION ||
    manifest.complete !== true
  )
    throw new Error("Invalid source manifest for " + scan.name);
  let opened = OpenSources.get(key);
  if (!opened) {
    opened = { dir, file, manifest, images: new Map(), key };
    OpenSources.set(key, opened);
  }
  OpenSources.delete(key);
  OpenSources.set(key, opened);
  for (const [old, item] of OpenSources) {
    if (OpenSources.size <= 3) break;
    if (!item.users) {
      OpenSources.delete(old);
      for (const [k, b] of Blocks)
        if (k.startsWith(old + "/")) {
          Blocks.delete(k);
          blockBytes -= b.bytes;
        }
    }
  }
  return opened;
}
async function imageFor(opened, address) {
  const imageKey = address.offset ? "sub" + address.offset : "page" + (address.page || 0);
  if (opened.images.has(imageKey)) return opened.images.get(imageKey);
  // Keep parsed TIFF/image objects alive; block reuse is bounded separately below.
  const promise = (async () => {
    opened.source ||= await GeoTIFF.fromBlob(opened.file);
    const image = address.offset
        ? new GeoTIFF.GeoTIFFImage(
            await opened.source.parser.parseFileDirectoryAt(address.offset),
            opened.source.littleEndian,
            false,
            opened.source.source,
          )
        : await opened.source.getImage(address.page || 0),
      meta = checkTiffImage(image),
      original = image.getTileOrStrip.bind(image);
    blockLimit = Math.min(
      blockLimit,
      imageDecodeSlots(meta.blockBytes, navigator.hardwareConcurrency, navigator.deviceMemory),
    );
    image.getTileOrStrip = async (x, y, sample, decoder, signal) => {
      cancelled(signal);
      const key = opened.key + "/" + imageKey + "/" + x + "/" + y + "/" + sample;
      if (Blocks.has(key) && Blocks.get(key).signal?.aborted && !Blocks.get(key).complete) {
        const old = Blocks.get(key);
        Blocks.delete(key);
        blockBytes -= old.bytes;
      }
      if (Blocks.has(key)) {
        const hit = Blocks.get(key);
        Blocks.delete(key);
        Blocks.set(key, hit);
        return hit.result;
      }
      while (blockActive >= blockLimit) {
        await new Promise((resolve) => blockWaiters.push(resolve));
        cancelled(signal);
      }
      // Another adjacent request may have decoded the block while this one waited.
      if (Blocks.has(key)) return Blocks.get(key).result;
      blockActive++;
      const result = (async () => {
        const fd = image.getFileDirectory(),
          nx = Math.ceil(image.getWidth() / image.getTileWidth()),
          ny = Math.ceil(image.getHeight() / image.getTileHeight()),
          index = (image.planarConfiguration === 2 ? sample * nx * ny : 0) + y * nx + x,
          count = Number(
            await fd.loadValueIndexed(image.isTiled ? "TileByteCounts" : "StripByteCounts", index),
          );
        if (!Number.isSafeInteger(count) || count < 0 || count > MAX_TIFF_BLOCK)
          throw new Error(
            "A compressed TIFF block is too large to decode safely. Export with smaller strips or tiles.",
          );
        const start = performance.now(),
          value = await original(x, y, sample, decoder, signal);
        stats({ decodeMs: performance.now() - start });
        return value;
      })();
      const entry = { result, bytes: meta.blockBytes, signal, complete: false };
      Blocks.set(key, entry);
      blockBytes += entry.bytes;
      while (blockBytes > BLOCK_TARGET && Blocks.size > 1) {
        const oldest = Blocks.keys().next().value,
          b = Blocks.get(oldest);
        Blocks.delete(oldest);
        blockBytes -= b.bytes;
      }
      try {
        const value = await result;
        entry.complete = true;
        return value;
      } catch (e) {
        if (Blocks.get(key) === entry) {
          Blocks.delete(key);
          blockBytes -= entry.bytes;
        }
        throw e;
      } finally {
        blockActive--;
        blockWaiters.splice(0).forEach((resolve) => resolve());
      }
    };
    return image;
  })();
  opened.images.set(imageKey, promise);
  try {
    return await promise;
  } catch (e) {
    opened.images.delete(imageKey);
    throw e;
  }
}
async function pixels(opened, scan, spec, signal) {
  const geom = tileGeometry(scan, spec.level, spec.x, spec.y),
    overview =
      spec.level === 0
        ? null
        : opened.manifest.sourceOverviews.filter((o) => o.level <= spec.level).at(-1),
    image = await imageFor(opened, overview || { page: opened.manifest.baseImage || 0 }),
    sx = image.getWidth() / scan.width,
    sy = image.getHeight() / scan.height,
    left = geom.left * sx,
    top = geom.top * sy,
    right = Math.min(scan.width, geom.left + geom.width * geom.factor) * sx,
    bottom = Math.min(scan.height, geom.top + geom.height * geom.factor) * sy,
    rgba = new Uint8ClampedArray(geom.width * geom.height * 4);
  const start = performance.now();
  if (spec.level === 0) {
    const rgb = await image.readRGB({
      window: [
        geom.left,
        geom.top,
        Math.min(scan.width, geom.left + geom.width),
        Math.min(scan.height, geom.top + geom.height),
      ],
      pool,
      interleave: true,
      signal,
    });
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      rgba[j] = rgb[i];
      rgba[j + 1] = rgb[i + 1];
      rgba[j + 2] = rgb[i + 2];
      rgba[j + 3] = 255;
    }
  } else {
    // GeoTIFF.js allocates the source window before resampling. Bound every window
    // rather than requesting a gigabyte-sized full-board raster for one overview.
    const dx = (right - left) / geom.width,
      dy = (bottom - top) / geom.height,
      cw = Math.max(1, Math.min(geom.width, Math.floor(1022 / Math.max(dx, 1)))),
      ch = Math.max(1, Math.min(geom.height, Math.floor(1022 / Math.max(dy, 1))));
    for (let oy = 0; oy < geom.height; oy += ch)
      for (let ox = 0; ox < geom.width; ox += cw) {
        cancelled(signal);
        const w = Math.min(cw, geom.width - ox),
          h = Math.min(ch, geom.height - oy),
          x0 = Math.floor(left + ox * dx),
          y0 = Math.floor(top + oy * dy),
          x1 = Math.min(image.getWidth(), Math.floor(left + (ox + w - 1) * dx) + 2),
          y1 = Math.min(image.getHeight(), Math.floor(top + (oy + h - 1) * dy) + 2),
          rgb = await image.readRGB({ window: [x0, y0, x1, y1], pool, interleave: true, signal }),
          rw = x1 - x0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const fx = left + (ox + x) * dx - x0,
              fy = top + (oy + y) * dy - y0,
              ix = Math.floor(fx),
              iy = Math.floor(fy),
              ax = fx - ix,
              ay = fy - iy,
              j = ((oy + y) * geom.width + ox + x) * 4;
            for (let c = 0; c < 3; c++) {
              const a = rgb[(iy * rw + ix) * 3 + c],
                b = rgb[(iy * rw + Math.min(ix + 1, rw - 1)) * 3 + c],
                d = rgb[(Math.min(iy + 1, y1 - y0 - 1) * rw + ix) * 3 + c],
                e = rgb[(Math.min(iy + 1, y1 - y0 - 1) * rw + Math.min(ix + 1, rw - 1)) * 3 + c];
              rgba[j + c] = (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
            }
            rgba[j + 3] = 255;
          }
      }
    stats({ resampleMs: performance.now() - start });
  }
  cancelled(signal);
  stats({ sourceReadMs: performance.now() - start, sourceMisses: 1 });
  const canvas = new OffscreenCanvas(geom.width, geom.height);
  canvas.getContext("2d").putImageData(new ImageData(rgba, geom.width, geom.height), 0, 0);
  return canvas;
}
function schedulePersistence() {
  if (persistTimer || !Persistence.size) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (!Persistence.size) return;
    if (active || persisting) {
      schedulePersistence();
      return;
    }
    const [key, job] = Persistence.entries().next().value;
    Persistence.delete(key);
    const write = (async () => {
      if (job.signal.aborted || CacheEpoch.get(job.opened.key) !== job.cacheEpoch) return;
      try {
        let start = performance.now();
        const blob = await job.canvas.convertToBlob({ type: "image/png" });
        stats({ encodeMs: performance.now() - start });
        if (job.signal.aborted || CacheEpoch.get(job.opened.key) !== job.cacheEpoch) return;
        const cache = await job.opened.dir.getDirectoryHandle("cache-v1", { create: true }),
          level = await cache.getDirectoryHandle("L" + job.spec.level, { create: true });
        start = performance.now();
        await writeFile(level, job.spec.x + "_" + job.spec.y + ".png", blob);
        stats({ diskWriteMs: performance.now() - start });
      } catch {
        self.postMessage({
          warning:
            "Derived image cache could not be written. Viewing continues from the source TIFF and memory cache.",
        });
      }
    })();
    persisting = { key: job.opened.key, promise: write, controller: job.signalController };
    await write;
    persisting = null;
    schedulePersistence();
  }, 75);
}
self.onmessage = async ({ data }) => {
  const { type, requestId } = data;
  if (type === "viewport") {
    for (const c of Jobs.values()) if (c.tile) c.abort();
    for (const j of Persistence.values()) j.signalController?.abort();
    persisting?.controller?.abort();
    Persistence.clear();
    return;
  }
  if (type === "cancel") {
    Jobs.get(requestId)?.abort();
    return;
  }
  const controller = new AbortController();
  controller.tile = type === "tile";
  Jobs.set(requestId, controller);
  const signal = controller.signal;
  let opened, bitmap;
  try {
    if (type === "validate") {
      await sourceFor(data.root, data.epoch, data.scan);
      self.postMessage({ requestId });
    } else if (type === "inspect") {
      const dir = await scanDir(data.root, data.scanId),
        file = await (await dir.getFileHandle("source.tif")).getFile(),
        { metadata } = await tiffMetadata(file);
      cancelled(signal);
      const { blockBytes: _, ...meta } = metadata;
      self.postMessage({
        requestId,
        manifest: {
          schema: "pcb-reveng-scan-v1",
          complete: true,
          source: "source.tif",
          sourceName: data.sourceName,
          sourceSize: file.size,
          sourceLastModified: file.lastModified,
          ...meta,
          tileSize: 512,
          maxLogicalLevel: Math.max(
            0,
            Math.ceil(Math.log2(Math.max(meta.width, meta.height) / 512)),
          ),
          cacheVersion: IMAGE_CACHE_VERSION,
        },
      });
    } else if (type === "clear") {
      const key = data.epoch + "/" + data.scan.id;
      CacheEpoch.set(key, (CacheEpoch.get(key) || 0) + 1);
      for (const [k, j] of Persistence) if (j.opened.key === key) Persistence.delete(k);
      if (persisting?.key === key) await persisting.promise;
      const dir = await scanDir(data.root, data.scan.id);
      try {
        await dir.removeEntry("cache-v1", { recursive: true });
      } catch (e) {
        if (e.name !== "NotFoundError") throw e;
      }
      self.postMessage({ requestId });
    } else if (type === "tile") {
      active++;
      opened = await sourceFor(data.root, data.epoch, data.scan);
      opened.users = (opened.users || 0) + 1;
      cancelled(signal);
      const cacheEpoch = CacheEpoch.get(opened.key) || 0;
      CacheEpoch.set(opened.key, cacheEpoch);
      try {
        const cache = await opened.dir.getDirectoryHandle("cache-v1"),
          level = await cache.getDirectoryHandle("L" + data.spec.level),
          file = await (
            await level.getFileHandle(data.spec.x + "_" + data.spec.y + ".png")
          ).getFile();
        bitmap = await createImageBitmap(file);
        const g = tileGeometry(data.scan, data.spec.level, data.spec.x, data.spec.y);
        if (bitmap.width !== g.width || bitmap.height !== g.height) {
          bitmap.close();
          bitmap = null;
          throw new Error("Invalid cache dimensions.");
        }
        stats({ diskHits: 1 });
      } catch {
        /* Missing or damaged derived tiles regenerate from source. */
      }
      if (bitmap) {
        cancelled(signal);
        self.postMessage({ requestId, bitmap }, [bitmap]);
        bitmap = null;
      } else {
        const canvas = await pixels(opened, data.scan, data.spec, signal);
        bitmap = await createImageBitmap(canvas);
        cancelled(signal);
        self.postMessage({ requestId, bitmap }, [bitmap]);
        bitmap = null;
        // Delivery precedes PNG encoding and persistence. Keep only a bounded backlog.
        if (Persistence.size < 8)
          Persistence.set(data.spec.key, {
            opened,
            spec: data.spec,
            canvas,
            signal,
            signalController: controller,
            cacheEpoch,
          });
        schedulePersistence();
      }
    }
  } catch (e) {
    bitmap?.close();
    self.postMessage({
      requestId,
      error:
        e.name === "NotFoundError"
          ? "Source TIFF or manifest is missing. Copper remains available."
          : e.message,
      errorName: e.name,
    });
  } finally {
    if (type === "tile") active--;
    if (opened) opened.users--;
    Jobs.delete(requestId);
    schedulePersistence();
  }
};
