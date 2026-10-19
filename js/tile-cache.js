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
  set(key, value, bytes) {
    this.delete(key);
    if (bytes > this.hard || bytes > this.target) {
      value.close?.();
      return false;
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.target) this.delete(this.entries.keys().next().value);
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
class TileLoader {
  constructor(load, onReady, options = {}) {
    this.cache = new WeightedLRU(options.target, options.hard);
    this.load = load;
    this.onReady = onReady;
    this.concurrency = options.concurrency || 4;
    this.maxQueue = 64;
    this.generation = 0;
    this.signature = "";
    this.wanted = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.attempted = new Set();
    this.active = 0;
  }
  view(specs) {
    const signature = specs.map((s) => s.key).join("|");
    if (signature !== this.signature) {
      this.signature = signature;
      this.generation++;
      this.attempted.clear();
    }
    this.wanted = new Map(specs.map((s) => [s.key, s]));
    this.pump();
  }
  pump() {
    const queue = [...this.wanted.values()]
      .filter(
        (s) =>
          !this.cache.entries.has(s.key) &&
          !this.pending.has(s.key) &&
          !this.failed.has(s.key) &&
          !this.attempted.has(s.key),
      )
      .slice(0, this.maxQueue);
    while (this.active < this.concurrency && queue.length) {
      const spec = queue.shift(),
        gen = this.generation;
      this.pending.set(spec.key, gen);
      this.attempted.add(spec.key);
      this.active++;
      Promise.resolve()
        .then(() => this.load(spec))
        .then(
          (img) => {
            if (gen !== this.generation || !this.wanted.has(spec.key)) img.close?.();
            else this.cache.set(spec.key, img, img.width * img.height * 4);
          },
          (e) => {
            if (gen === this.generation) {
              if (this.failed.size >= 256) this.failed.clear();
              this.failed.add(spec.key);
              this.onError?.(spec, e);
            }
          },
        )
        .finally(() => {
          this.pending.delete(spec.key);
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
    this.failed.clear();
    this.attempted.clear();
    this.cache.clear();
  }
}
function visibleTileSpecs(scan) {
  const level = Math.min(
      scan.levels - 1,
      Math.max(0, Math.floor(Math.log2(1 / (View.zoom * scan.transform.scale)))),
    ),
    factor = 2 ** level,
    l = pyramidLevels(scan.width, scan.height)[level];
  const viewport = [
    screenToWorld(0, 0),
    screenToWorld(View.width, 0),
    screenToWorld(0, View.height),
    screenToWorld(View.width, View.height),
  ].map((p) => worldToImage(scan, p));
  const b = bounds(viewport),
    x0 = Math.max(0, Math.floor(b.minX / factor / 512)),
    y0 = Math.max(0, Math.floor(b.minY / factor / 512)),
    x1 = Math.min(Math.ceil(l.width / 512) - 1, Math.floor(b.maxX / factor / 512)),
    y1 = Math.min(Math.ceil(l.height / 512) - 1, Math.floor(b.maxY / factor / 512));
  const specs = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      specs.push({
        scanId: scan.id,
        level,
        x,
        y,
        key: `${ProjectFile.epoch}/${scan.id}/${level}/${x}/${y}`,
        factor,
      });
  return specs;
}
const Tiles = new TileLoader(
  async (s) => {
    const root = ProjectFile.root;
    if (!root) throw new Error("No project folder.");
    const dir = await scanDirectory(s.scanId),
      level = await dir.getDirectoryHandle("L" + s.level),
      h = await level.getFileHandle(s.x + "_" + s.y + ".png");
    return createImageBitmap(await h.getFile());
  },
  () => requestRender(),
);
Tiles.onError = (spec) => {
  const scan = State.scans.find((s) => s.id === spec.scanId);
  if (scan && !ProjectFile.assetWarnings.has(scan.id)) {
    ProjectFile.assetWarnings.add(scan.id);
    notify(
      "Missing or unreadable image tile in " + scan.name + ". Copper remains available.",
      true,
    );
  }
};
function renderScanTiles(ctx, scan, alpha, specs) {
  if (!scan || alpha <= 0) return;
  ctx.save();
  const t = scan.transform;
  ctx.globalAlpha = alpha;
  ctx.translate(t.tx, t.ty);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale * (scan.flipX ? -1 : 1), t.scale * (scan.flipY ? -1 : 1));
  ctx.imageSmoothingEnabled = View.zoom * t.scale < 1;
  for (const spec of specs) {
    const img = Tiles.cache.get(spec.key);
    if (img)
      ctx.drawImage(
        img,
        spec.x * 512 * spec.factor,
        spec.y * 512 * spec.factor,
        img.width * spec.factor,
        img.height * spec.factor,
      );
  }
  ctx.restore();
}
