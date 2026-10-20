"use strict";
const TileStats = {
  memoryHits: 0,
  diskHits: 0,
  sourceMisses: 0,
  sourceReadMs: 0,
  decodeMs: 0,
  resampleMs: 0,
  encodeMs: 0,
  diskWriteMs: 0,
  cancelledJobs: 0,
};
class ImageTileEngine {
  constructor() {
    this.worker = null;
    this.nextId = 1;
    this.requests = new Map();
    this.checked = new Map();
  }
  start() {
    if (this.worker) return;
    this.worker = new Worker("js/tile-worker.js");
    this.worker.onmessage = ({ data }) => {
      if (data.stats)
        for (const [k, v] of Object.entries(data.stats)) TileStats[k] = (TileStats[k] || 0) + v;
      if (data.warning) {
        this.onWarning?.(data.warning);
        return;
      }
      const pending = this.requests.get(data.requestId);
      if (!pending) {
        data.bitmap?.close();
        return;
      }
      this.requests.delete(data.requestId);
      pending.cleanup();
      if (data.error)
        pending.reject(Object.assign(new Error(data.error), { name: data.errorName || "Error" }));
      else pending.resolve(data.bitmap || data.manifest || true);
    };
    this.worker.onerror = (e) => {
      for (const p of this.requests.values()) {
        p.cleanup();
        p.reject(new Error(e.message || "Image engine failed."));
      }
      this.requests.clear();
      this.worker.terminate();
      this.worker = null;
    };
  }
  request(type, data, signal) {
    this.start();
    if (signal?.aborted)
      return Promise.reject(new DOMException("Image request cancelled.", "AbortError"));
    return new Promise((resolve, reject) => {
      const requestId = this.nextId++,
        worker = this.worker;
      const abort = () => {
        if (!this.requests.delete(requestId)) return;
        worker.postMessage({ type: "cancel", requestId });
        TileStats.cancelledJobs++;
        reject(new DOMException("Image request cancelled.", "AbortError"));
      };
      this.requests.set(requestId, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", abort),
      });
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ type, requestId, ...data });
    });
  }
  tile(spec, signal) {
    const scan = State.scans.find((s) => s.id === spec.scanId);
    if (!scan) return Promise.reject(new Error("Scan is no longer available."));
    return this.request(
      "tile",
      { root: ProjectFile.root, epoch: ProjectFile.epoch, scan, spec },
      signal,
    );
  }
  verifySource(scan) {
    const epoch = ProjectFile.epoch,
      key = epoch + "/" + scan.id,
      now = performance.now();
    if (this.checked.has(key) && now - this.checked.get(key) < 1000) return;
    this.checked.set(key, now);
    this.request("validate", { root: ProjectFile.root, epoch, scan }).catch((e) => {
      if (e.name !== "AbortError" && epoch === ProjectFile.epoch) {
        Tiles.onError({ scanId: scan.id }, e);
        requestRender();
      }
    });
  }
  viewport() {
    this.worker?.postMessage({ type: "viewport" });
  }
  reset() {
    for (const p of this.requests.values()) {
      p.cleanup();
      p.reject(new DOMException("Project changed.", "AbortError"));
    }
    this.requests.clear();
    this.checked.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
const ImageEngine = new ImageTileEngine();
ImageEngine.onWarning = (message) => {
  if (!ProjectFile.cacheWarning) {
    ProjectFile.cacheWarning = true;
    notify(message, true);
  }
};
