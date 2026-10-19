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
    m.height !== scan.height ||
    JSON.stringify(m.levels) !== JSON.stringify(levels)
  )
    throw new Error("Incomplete or invalid tile manifest for " + scan.name);
  return m;
}
const ImportJob = { worker: null, cancel: null };
async function preprocessImage(file, id, onProgress = () => {}, root = ProjectFile.root) {
  const worker = new Worker("js/image-worker.js");
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
    showImportProgress("Preparing image…", true);
    const manifest = await preprocessImage(file, id, (p) =>
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
        levels: manifest.levels.length,
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
