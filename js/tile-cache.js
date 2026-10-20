"use strict";
class WeightedLRU {
  constructor(target = 512 * 1024 * 1024, hard = 1024 * 1024 * 1024) {
    this.target = Math.min(target, hard);
    this.hard = hard;
    this.bytes = 0;
    this.entries = new Map();
  }
  get(key) {
    const e = this.entries.get(key);
    if (!e) return null;
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value;
  }
  set(key, value, bytes, retain = 0) {
    this.delete(key);
    if (bytes > this.hard || bytes > this.target) {
      value.close?.();
      return false;
    }
    this.entries.set(key, { value, bytes, retain });
    this.bytes += bytes;
    while (this.bytes > this.target) {
      const victim =
        [...this.entries].find(([, e]) => !e.retain) || this.entries.entries().next().value;
      this.delete(victim[0]);
    }
    return true;
  }
  delete(key) {
    const e = this.entries.get(key);
    if (e) {
      this.bytes -= e.bytes;
      e.value.close?.();
      this.entries.delete(key);
    }
  }
  clear() {
    for (const key of this.entries.keys()) this.delete(key);
  }
}
function prioritizeTileJobs(specs) {
  const out = [];
  for (const priority of [...new Set(specs.map((s) => s.priority || 0))].sort((a, b) => a - b)) {
    const groups = new Map();
    for (const spec of specs.filter((s) => (s.priority || 0) === priority)) {
      if (!groups.has(spec.scanId)) groups.set(spec.scanId, []);
      groups.get(spec.scanId).push(spec);
    }
    for (const group of groups.values())
      group.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const group of groups.values())
        if (group.length) {
          out.push(group.shift());
          remaining = true;
        }
    }
  }
  return out;
}
class TileLoader {
  constructor(load, onReady, options = {}) {
    this.cache = new WeightedLRU(options.target, options.hard);
    this.load = load;
    this.onReady = onReady;
    this.concurrency = options.concurrency || 3;
    this.maxQueue = 64;
    this.generation = 0;
    this.signature = "";
    this.wanted = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.unavailable = new Set();
    this.attempted = new Set();
    this.retries = new Map();
    this.active = 0;
    this.idleTimer = null;
    this.idleReady = false;
  }
  view(specs, viewToken = "") {
    const unique = new Map();
    for (const s of specs)
      if (!unique.has(s.key) || (s.priority || 0) < (unique.get(s.key).priority || 0))
        unique.set(s.key, s);
    const signature = viewToken + "|" + [...unique.keys()].join("|");
    if (signature !== this.signature) {
      this.signature = signature;
      this.generation++;
      this.attempted.clear();
      this.retries.clear();
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
      this.idleReady = false;
      for (const p of this.pending.values()) p.controller.abort();
      this.onView?.([...unique.values()]);
    }
    this.wanted = unique;
    this.pump();
  }
  pump() {
    const queue = prioritizeTileJobs(
      [...this.wanted.values()].filter(
        (s) =>
          !this.unavailable.has(s.scanId) &&
          !this.cache.entries.has(s.key) &&
          !this.pending.has(s.key) &&
          !this.failed.has(s.key) &&
          !this.attempted.has(s.key),
      ),
    ).slice(0, this.maxQueue);
    if (queue.length && queue[0].priority === 4 && !this.idleReady) {
      if (!this.active && !this.idleTimer)
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null;
          this.idleReady = true;
          this.pump();
        }, 250);
      return;
    }
    while (this.active < this.concurrency && queue.length) {
      const spec = queue.shift(),
        gen = this.generation,
        controller = new AbortController(),
        pending = { gen, controller };
      this.pending.set(spec.key, pending);
      this.attempted.add(spec.key);
      this.active++;
      Promise.resolve()
        .then(() => this.load(spec, controller.signal))
        .then(
          (img) => {
            if (
              gen !== this.generation ||
              this.unavailable.has(spec.scanId) ||
              controller.signal.aborted ||
              !this.wanted.has(spec.key)
            )
              img.close?.();
            else this.cache.set(spec.key, img, img.width * img.height * 4, spec.retain ? 1 : 0);
          },
          (e) => {
            if (
              gen === this.generation &&
              e.name === "AbortError" &&
              !controller.signal.aborted &&
              (this.retries.get(spec.key) || 0) < 2
            ) {
              this.retries.set(spec.key, (this.retries.get(spec.key) || 0) + 1);
              this.attempted.delete(spec.key);
            }
            if (gen === this.generation && e.name !== "AbortError") {
              if (this.failed.size >= 256) this.failed.clear();
              this.failed.add(spec.key);
              this.onError?.(spec, e);
            }
          },
        )
        .finally(() => {
          if (this.pending.get(spec.key) === pending) this.pending.delete(spec.key);
          this.active--;
          this.pump();
          if (gen === this.generation) this.onReady();
        });
    }
  }
  clear() {
    this.generation++;
    this.signature = "";
    this.wanted.clear();
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.idleReady = false;
    for (const p of this.pending.values()) p.controller.abort();
    this.failed.clear();
    this.unavailable.clear();
    this.attempted.clear();
    this.retries.clear();
    this.cache.clear();
    this.onView?.();
  }
}
function tileSpec(scan, level, x, y, priority = 0, distance = 0) {
  return {
    scanId: scan.id,
    level,
    x,
    y,
    key: `${ProjectFile.epoch}/${scan.id}/${level}/${x}/${y}`,
    factor: 2 ** level,
    priority,
    distance,
    retain: level >= scanMaxLevel(scan) - 1,
  };
}
function visibleTileSpecs(scan, ring = 0) {
  const max = scanMaxLevel(scan),
    level = Math.min(
      max,
      Math.max(0, Math.floor(Math.log2(1 / (View.zoom * scan.transform.scale)))),
    ),
    factor = 2 ** level,
    l = pyramidLevels(scan.width, scan.height)[level],
    viewport = [
      [0, 0],
      [View.width, 0],
      [0, View.height],
      [View.width, View.height],
    ].map(([x, y]) => worldToImage(scan, screenToWorld(x, y))),
    b = bounds(viewport),
    center = worldToImage(scan, screenToWorld(View.width / 2, View.height / 2)),
    x0 = Math.max(0, Math.floor(b.minX / factor / 512) - ring),
    y0 = Math.max(0, Math.floor(b.minY / factor / 512) - ring),
    x1 = Math.min(Math.ceil(l.width / 512) - 1, Math.floor(b.maxX / factor / 512) + ring),
    y1 = Math.min(Math.ceil(l.height / 512) - 1, Math.floor(b.maxY / factor / 512) + ring),
    specs = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      specs.push(
        tileSpec(
          scan,
          level,
          x,
          y,
          ring ? 2 : 0,
          Math.hypot((x + 0.5) * 512 * factor - center.x, (y + 0.5) * 512 * factor - center.y),
        ),
      );
  return specs;
}
function imageContributions(scans, blend) {
  return scans
    .map((scan, i) => ({ scan, alpha: scans.length === 1 ? 1 : i === 0 ? 1 - blend : blend }))
    .filter((s) => s.alpha > 0);
}
function planTileRequests(contributions) {
  const specs = [];
  for (const { scan } of contributions) {
    const visible = visibleTileSpecs(scan),
      max = scanMaxLevel(scan);
    specs.push(...visible, ...visibleTileSpecs(scan, 1));
    for (const s of visible)
      for (const level of new Set([Math.min(max, s.level + 2), max]))
        if (level > s.level) {
          const divisor = 2 ** (level - s.level);
          specs.push(
            tileSpec(
              scan,
              level,
              Math.floor(s.x / divisor),
              Math.floor(s.y / divisor),
              1,
              s.distance,
            ),
          );
        }
    // Warm only the highest two logical levels, never sweep detailed levels.
    for (let level = Math.max(1, max - 1); level <= max; level++) {
      const factor = 2 ** level;
      for (let y = 0; y < Math.ceil(scan.height / factor / 512); y++)
        for (let x = 0; x < Math.ceil(scan.width / factor / 512); x++)
          specs.push(tileSpec(scan, level, x, y, 4));
    }
  }
  return specs;
}
const Tiles = new TileLoader(
  async (s, signal) => {
    const scan = State.scans.find((scan) => scan.id === s.scanId);
    if (!scan) throw new Error("Scan is no longer available.");
    if (scan.assetMode === "tiff-source") return ImageEngine.tile(s, signal);
    const dir = await scanDirectory(s.scanId),
      level = await dir.getDirectoryHandle("L" + s.level),
      h = await level.getFileHandle(s.x + "_" + s.y + ".png");
    return createImageBitmap(await h.getFile());
  },
  () => requestRender(),
);
Tiles.onView = (specs = []) => {
  if (typeof ImageEngine === "undefined") return;
  ImageEngine.viewport();
  for (const id of new Set(specs.map((s) => s.scanId))) {
    const scan = State.scans.find((s) => s.id === id);
    if (scan?.assetMode === "tiff-source") ImageEngine.verifySource(scan);
  }
};
Tiles.onError = (spec, error) => {
  const scan = State.scans.find((s) => s.id === spec.scanId);
  if (scan?.assetMode === "tiff-source") {
    Tiles.unavailable.add(scan.id);
    for (const key of Tiles.cache.entries.keys())
      if (key.startsWith(ProjectFile.epoch + "/" + scan.id + "/")) Tiles.cache.delete(key);
  }
  if (scan && !ProjectFile.assetWarnings.has(scan.id)) {
    ProjectFile.assetWarnings.add(scan.id);
    notify(
      "Image unavailable in " + scan.name + ": " + error.message + " Copper remains available.",
      true,
    );
  }
};
function parentTileFallback(cache, scan, spec) {
  for (let level = spec.level + 1; level <= scanMaxLevel(scan); level++) {
    const divisor = 2 ** (level - spec.level),
      x = Math.floor(spec.x / divisor),
      y = Math.floor(spec.y / divisor),
      parent = tileSpec(scan, level, x, y),
      img = cache.get(parent.key);
    if (img)
      return { img, factor: parent.factor, x: x * 512 * parent.factor, y: y * 512 * parent.factor };
  }
  return null;
}
function renderScanTiles(ctx, scan, alpha, specs) {
  if (!scan || alpha <= 0 || Tiles.unavailable.has(scan.id)) return;
  ctx.save();
  const t = scan.transform;
  ctx.globalAlpha = alpha;
  ctx.translate(t.tx, t.ty);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale * (scan.flipX ? -1 : 1), t.scale * (scan.flipY ? -1 : 1));
  ctx.imageSmoothingEnabled = View.zoom * t.scale < 1;
  for (const spec of specs) {
    const img = Tiles.cache.get(spec.key),
      x = spec.x * 512 * spec.factor,
      y = spec.y * 512 * spec.factor,
      w = Math.min(512 * spec.factor, scan.width - x),
      h = Math.min(512 * spec.factor, scan.height - y);
    if (img) {
      TileStats.memoryHits++;
      ctx.drawImage(img, x, y, w, h);
    } else {
      const p = parentTileFallback(Tiles.cache, scan, spec);
      if (p)
        ctx.drawImage(
          p.img,
          (x - p.x) / p.factor,
          (y - p.y) / p.factor,
          w / p.factor,
          h / p.factor,
          x,
          y,
          w,
          h,
        );
    }
  }
  ctx.restore();
}
