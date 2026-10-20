"use strict";
function pyramidLevels(width, height) {
  const levels = [];
  for (let level = 0; ; level++) {
    levels.push({ level, width, height });
    if (width <= 512 && height <= 512) break;
    width = Math.ceil(width / 2);
    height = Math.ceil(height / 2);
  }
  return levels;
}
function validateManifest(m, scan) {
  const levels = pyramidLevels(scan.width, scan.height);
  if (
    !m ||
    m.complete !== true ||
    m.tileSize !== 512 ||
    m.width !== scan.width ||
    m.height !== scan.height
  )
    throw new Error("Incomplete or invalid image manifest for " + scan.name);
  if (scan.assetMode === "tiff-source") {
    if (
      m.schema !== "pcb-reveng-scan-v1" ||
      m.source !== "source.tif" ||
      m.cacheVersion !== 1 ||
      m.maxLogicalLevel !== scan.maxLogicalLevel ||
      !Number.isSafeInteger(m.sourceSize) ||
      m.sourceSize < 8 ||
      !Array.isArray(m.sourceOverviews) ||
      m.sourceOverviews.length > 32
    )
      throw new Error("Invalid TIFF source manifest for " + scan.name);
  } else if (JSON.stringify(m.levels) !== JSON.stringify(levels))
    throw new Error("Incomplete or invalid legacy tile manifest for " + scan.name);
  return m;
}

const ImportJob = { worker: null, cancel: null };
async function prepareLegacyImage(file, id, onProgress = () => {}, root = ProjectFile.root) {
  const worker = new Worker("js/legacy-image-worker.js");
  ImportJob.worker = worker;
  try {
    return await new Promise((resolve, reject) => {
      ImportJob.cancel = () => {
        worker.terminate();
        reject(new DOMException("Image preparation cancelled.", "AbortError"));
      };
      worker.onmessage = (e) => {
        if (e.data.error) reject(new Error(e.data.error));
        else if (e.data.done === true) resolve(e.data.manifest);
        else onProgress(e.data);
      };
      worker.onerror = (e) => reject(new Error(e.message || "Image preparation failed."));
      worker.postMessage({ file, id, root });
    });
  } finally {
    worker.terminate();
    ImportJob.worker = null;
    ImportJob.cancel = null;
  }
}
async function copyImageSource(file, dir, signal, onProgress) {
  const w = await (await dir.getFileHandle("source.tif", { create: true })).createWritable();
  try {
    const chunkSize = 16 * 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      if (signal.aborted) throw new DOMException("Image copy cancelled.", "AbortError");
      const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
      if (signal.aborted) throw new DOMException("Image copy cancelled.", "AbortError");
      await w.write(chunk);
      onProgress({
        message:
          "Copying image… " +
          (Math.min(file.size, offset + chunkSize) / 1048576).toFixed(1) +
          " MiB" +
          " / " +
          (file.size / 1048576).toFixed(1) +
          " MiB",
        done: Math.min(file.size, offset + chunkSize),
        total: file.size,
      });
    }
    if (signal.aborted) throw new DOMException("Image copy cancelled.", "AbortError");
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
}
async function prepareScanAsset(file, id, onProgress, root = ProjectFile.root) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer()),
    tiff = (head[0] === 73 && head[1] === 73) || (head[0] === 77 && head[1] === 77);
  if (!tiff) return prepareLegacyImage(file, id, onProgress, root);
  const controller = new AbortController(),
    images = await root.getDirectoryHandle("images", { create: true }),
    dir = await images.getDirectoryHandle("scan-" + id, { create: true });
  ImportJob.cancel = () => controller.abort();
  try {
    await copyImageSource(file, dir, controller.signal, onProgress);
    onProgress({ message: "Reading image information…", done: 1, total: 1 });
    const manifest = await ImageEngine.request(
      "inspect",
      { root, scanId: id, sourceName: file.name },
      controller.signal,
    );
    if (controller.signal.aborted) throw new DOMException("Image import cancelled.", "AbortError");
    await writeProjectAsset(dir, "manifest.json", JSON.stringify(manifest));
    if (controller.signal.aborted) throw new DOMException("Image import cancelled.", "AbortError");
    return manifest;
  } catch (e) {
    await images.removeEntry("scan-" + id, { recursive: true }).catch(() => {});
    throw e;
  } finally {
    ImportJob.cancel = null;
  }
}
async function importScanFile(file, layerId) {
  if (ProjectFile.busy || !ProjectFile.root) return;
  ProjectFile.busy = true;
  refreshSaveState();
  let id;
  try {
    const images = await ProjectFile.root.getDirectoryHandle("images", { create: true });
    // Never overwrite a scan directory retained by undo or an interrupted import.
    for (;;) {
      id = reserveId();
      try {
        await images.getDirectoryHandle("scan-" + id);
      } catch (e) {
        if (e.name === "NotFoundError") break;
        throw e;
      }
    }
    showImportProgress("Copying image…", true);
    const manifest = await prepareScanAsset(file, id, (p) =>
      showImportProgress(p.message + " · " + Math.round((p.done / p.total) * 100) + "%", true),
    );
    ProjectFile.busy = false;
    change(() => {
      State.nextId = Math.max(State.nextId, id + 1);
      State.scans.push({
        id,
        layerId,
        name: file.name.replace(/\.[^.]+$/, ""),
        sourceName: file.name,
        width: manifest.width,
        height: manifest.height,
        tileSize: 512,
        maxLogicalLevel: manifest.maxLogicalLevel ?? manifest.levels.length - 1,
        assetMode: manifest.source ? "tiff-source" : "legacy-pyramid",
        flipX: false,
        flipY: false,
        aligned: State.scans.length === 0,
        transform: { tx: 0, ty: 0, scale: 1, rotation: 0 },
      });
    });
    View.primaryByLayer.set(layerId, id);
    activateLayer(layerId);
    setPrimaryScan(id);
    fitBoard();
  } catch (e) {
    if (e.name !== "AbortError") notify("Image import failed: " + e.message, true);
  } finally {
    ProjectFile.busy = false;
    showImportProgress("", false);
    refreshSaveState();
  }
}
