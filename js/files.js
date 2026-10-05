"use strict";

const ProjectFile = { handle: null, saved: null, busy: false, stamp: null };
function isDirty() {
  return snapshot() !== ProjectFile.saved;
}
function hasPendingWork() {
  return (
    isDirty() ||
    (typeof Editor !== "undefined" &&
      (Editor.fieldDirty || Editor.trace.length || Editor.drag?.before))
  );
}
const projectTypes = [
  { description: "PCB RevEng project", accept: { "application/json": [".pcbrev"] } },
];
function fileAccessAvailable() {
  return (
    typeof window.showSaveFilePicker === "function" &&
    typeof window.showOpenFilePicker === "function"
  );
}
function decodePhoto(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("A photograph could not be decoded. The open project has not changed."));
    img.src = dataURL;
  });
}
async function prepareProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  const legacy = raw.app === "pcb-reveng";
  if (legacy) raw = migrateLegacy(raw);
  const candidate = validateDocument(raw),
    assets = [],
    attachments = [];
  // Decode before committing any state or changing the current file handle.
  for (const l of candidate.layers) {
    const img = await decodePhoto(l.dataURL);
    if (!legacy && (img.naturalWidth !== l.width || img.naturalHeight !== l.height))
      throw new Error("Photograph dimensions do not match the project.");
    l.width = img.naturalWidth;
    l.height = img.naturalHeight;
    const assetId = assetSequence++;
    assets.push([assetId, { img, dataURL: l.dataURL }]);
    delete l.dataURL;
    l.assetId = assetId;
  }
  for (const a of candidate.attachments) {
    let bytes;
    try {
      bytes = pdfBytes(a.dataURL);
    } catch {
      throw new Error(
        "An embedded datasheet could not be decoded. The open project has not changed.",
      );
    }
    if (bytes.length !== a.size || (await sha256(bytes)) !== a.sha256)
      throw new Error(
        "An embedded datasheet failed its size or checksum check. The open project has not changed.",
      );
    attachments.push([a.id, bytes]);
    delete a.dataURL;
  }
  return { candidate, assets, attachments, legacy };
}
function adoptProject(prepared, handle, stamp) {
  State = prepared.candidate;
  ImageAssets.clear();
  prepared.assets.forEach(([k, v]) => ImageAssets.set(k, v));
  AttachmentAssets.clear();
  prepared.attachments.forEach(([k, v]) => AttachmentAssets.set(k, v));
  clearHistory();
  ProjectFile.handle = prepared.legacy ? null : handle;
  ProjectFile.stamp = prepared.legacy ? null : stamp;
  ProjectFile.saved = prepared.legacy ? null : snapshot();
}
async function openProject() {
  if (ProjectFile.busy) return;
  if (hasPendingWork() && !confirm("Discard unsaved changes and open another project?")) return;
  const openSnapshot = snapshot();
  ProjectFile.busy = true;
  refreshSaveState();
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "PCB project", accept: { "application/json": [".pcbrev", ".json"] } }],
      multiple: false,
    });
    const file = await handle.getFile(),
      prepared = await prepareProject(await file.text());
    // The editor may still be used while a picker or image decode is pending.
    if (
      (snapshot() !== openSnapshot || (typeof Editor !== "undefined" && Editor.fieldDirty)) &&
      hasPendingWork() &&
      !confirm("The current project changed while opening. Discard those changes?")
    )
      return;
    adoptProject(prepared, handle, { lastModified: file.lastModified, size: file.size });
    resetWorkspace();
    if (prepared.legacy)
      notify(
        "Converted an older project. Save As creates a new file; the original remains unchanged.",
      );
  } catch (err) {
    if (err.name !== "AbortError") notify(err.message, true);
  } finally {
    ProjectFile.busy = false;
    refreshSaveState();
  }
}
function requestOpen() {
  return openProject();
}
async function saveProject(saveAs = false) {
  if (ProjectFile.busy) return false;
  ProjectFile.busy = true;
  refreshSaveState();
  let writable;
  try {
    const oldHandle = ProjectFile.handle;
    const handle =
      saveAs || !oldHandle
        ? await window.showSaveFilePicker({
            suggestedName: State.name + ".pcbrev",
            types: projectTypes,
          })
        : oldHandle;
    if (handle === oldHandle && ProjectFile.stamp) {
      const current = await handle.getFile();
      if (
        current.lastModified !== ProjectFile.stamp.lastModified ||
        current.size !== ProjectFile.stamp.size
      )
        throw new Error(
          "This file changed on disk. Use Save As to preserve both versions, or reopen it.",
        );
    }
    validateDocument(documentPayload());
    const checkpoint = snapshot(),
      text = serializeProject();
    writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    writable = null;
    ProjectFile.handle = handle;
    ProjectFile.saved = checkpoint;
    try {
      const file = await handle.getFile();
      ProjectFile.stamp = { lastModified: file.lastModified, size: file.size };
    } catch {
      ProjectFile.stamp = null;
    }
    notify("Saved to " + handle.name);
    return true;
  } catch (err) {
    if (writable)
      try {
        await writable.abort();
      } catch {}
    if (err.name !== "AbortError") notify("Save failed: " + err.message, true);
    return false;
  } finally {
    ProjectFile.busy = false;
    refreshSaveState();
  }
}
function newProject() {
  if (ProjectFile.busy) return;
  if (hasPendingWork() && !confirm("Discard unsaved changes and start a new project?")) return;
  State = emptyDocument();
  ImageAssets.clear();
  AttachmentAssets.clear();
  clearHistory();
  ProjectFile.handle = null;
  ProjectFile.saved = null;
  ProjectFile.stamp = null;
  resetWorkspace();
}
