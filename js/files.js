"use strict";
const ProjectFile = {
  root: null,
  saved: null,
  busy: false,
  stamp: null,
  epoch: 0,
  assetWarnings: new Set(),
};
function fileAccessAvailable() {
  return typeof window.showDirectoryPicker === "function";
}
function isDirty() {
  return ProjectFile.root
    ? snapshot() !== ProjectFile.saved
    : State.components.length + State.scans.length + State.traces.length + State.vias.length > 0;
}
function hasPendingWork() {
  return isDirty() || Editor.fieldDirty || Editor.trace.length || Editor.drag?.before;
}
async function readJSON(dir, name) {
  const h = await dir.getFileHandle(name),
    file = await h.getFile();
  if (file.size > 32 * 1024 * 1024) throw new Error("Project metadata is too large.");
  return { value: JSON.parse(await file.text()), file };
}
async function writeProjectAsset(dir, name, data) {
  const h = await dir.getFileHandle(name, { create: true }),
    w = await h.createWritable();
  try {
    await w.write(data);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
  return h;
}
async function scanDirectory(id, root = ProjectFile.root) {
  const images = await root.getDirectoryHandle("images");
  return images.getDirectoryHandle("scan-" + id);
}
async function pdfFile(attachment, root = ProjectFile.root) {
  const dir = await root.getDirectoryHandle("datasheets"),
    h = await dir.getFileHandle(attachment.sha256 + ".pdf");
  const file = await h.getFile();
  if (file.size !== attachment.size)
    throw new Error("Datasheet size changed on disk: " + attachment.name);
  return file;
}
function adoptProject(candidate, root, file) {
  State = candidate;
  idFloor = Math.max(State.nextId, 1);
  clearHistory();
  ProjectFile.root = root;
  ProjectFile.epoch++;
  ProjectFile.saved = snapshot();
  ProjectFile.stamp = file ? { lastModified: file.lastModified, size: file.size } : null;
  ProjectFile.assetWarnings.clear();
  Tiles.clear();
  resetWorkspace();
}
async function emptyProjectDirectory() {
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  for await (const entry of dir.values()) {
    if (entry) throw new Error("Choose a new empty folder so existing files are preserved.");
  }
  await dir.getDirectoryHandle("images", { create: true });
  await dir.getDirectoryHandle("datasheets", { create: true });
  return dir;
}
async function newProject() {
  if (
    ProjectFile.busy ||
    (hasPendingWork() && !confirm("Discard unsaved edits and create a new project?"))
  )
    return;
  ProjectFile.busy = true;
  refreshSaveState();
  try {
    const root = await emptyProjectDirectory(),
      d = emptyDocument(),
      h = await writeProjectAsset(
        root,
        "project.json",
        JSON.stringify({ app: "pcb-reveng-simple", version: 2, ...d }, null, 2),
      );
    adoptProject(d, root, await h.getFile());
  } catch (e) {
    if (e.name !== "AbortError") notify("New project failed: " + e.message, true);
  } finally {
    ProjectFile.busy = false;
    refreshSaveState();
  }
}
async function openProject() {
  if (
    ProjectFile.busy ||
    (hasPendingWork() && !confirm("Discard unsaved edits and open a project folder?"))
  )
    return;
  ProjectFile.busy = true;
  refreshSaveState();
  try {
    const root = await window.showDirectoryPicker({ mode: "readwrite" }),
      { value, file } = await readJSON(root, "project.json"),
      candidate = validateDocument(value),
      warnings = [];
    for (const scan of candidate.scans)
      try {
        const dir = await scanDirectory(scan.id, root);
        validateManifest((await readJSON(dir, "manifest.json")).value, scan);
      } catch (e) {
        warnings.push(scan.name + ": " + e.message);
      }
    adoptProject(candidate, root, file);
    if (warnings.length)
      notify("Some scan assets are unavailable. Copper is intact. " + warnings.join("; "), true);
  } catch (e) {
    if (e.name !== "AbortError")
      notify("Open failed: " + e.message + " The current project is unchanged.", true);
  } finally {
    ProjectFile.busy = false;
    refreshSaveState();
  }
}
async function saveProject() {
  if (ProjectFile.busy) return false;
  if (!ProjectFile.root) {
    notify("Create or open a project folder first.", true);
    return false;
  }
  ProjectFile.busy = true;
  refreshSaveState();
  let writable;
  try {
    const h = await ProjectFile.root.getFileHandle("project.json"),
      file = await h.getFile();
    if (
      ProjectFile.stamp &&
      (file.lastModified !== ProjectFile.stamp.lastModified || file.size !== ProjectFile.stamp.size)
    )
      throw new Error("project.json changed outside the app. Reopen it before saving.");
    validateDocument(documentPayload());
    const checkpoint = snapshot(),
      text = serializeProject();
    writable = await h.createWritable();
    await writable.write(text);
    await writable.close();
    writable = null;
    ProjectFile.saved = checkpoint;
    const saved = await h.getFile();
    ProjectFile.stamp = { size: saved.size, lastModified: saved.lastModified };
    notify("Saved project.json");
    return true;
  } catch (e) {
    if (writable) await writable.abort().catch(() => {});
    notify("Save failed: " + e.message, true);
    return false;
  } finally {
    ProjectFile.busy = false;
    refreshSaveState();
  }
}
async function importExistingProject(file) {
  if (
    ProjectFile.busy ||
    (hasPendingWork() &&
      !confirm("Discard unsaved edits and import this existing project into a new folder?"))
  )
    return;
  ProjectFile.busy = true;
  refreshSaveState();
  try {
    if (file.size > 256 * 1024 * 1024)
      throw new Error(
        "The legacy JSON exceeds the 256 MiB migration limit. Use smaller source photographs for this import.",
      );
    const migration = convertV1(JSON.parse(await file.text())),
      root = await emptyProjectDirectory();
    for (const photo of migration.photos) {
      showImportProgress("Preparing legacy photograph…", true);
      const blob = await (await fetch(photo.dataURL)).blob();
      const manifest = await preprocessImage(
        blob,
        photo.id,
        (p) =>
          showImportProgress(
            "Importing photographs · " + Math.round((p.done / p.total) * 100) + "%",
            true,
          ),
        root,
      );
      const scan = migration.document.scans.find((s) => s.id === photo.id);
      scan.width = manifest.width;
      scan.height = manifest.height;
      scan.levels = manifest.levels.length;
    }
    const dir = await root.getDirectoryHandle("datasheets");
    for (const a of migration.pdfs) {
      const bytes = pdfBytes(a.dataURL);
      if (bytes.length !== a.size || (await sha256(bytes)) !== a.sha256)
        throw new Error("Invalid legacy datasheet.");
      await writeProjectAsset(dir, a.sha256 + ".pdf", bytes);
    }
    const candidate = validateDocument({
        app: "pcb-reveng-simple",
        version: 2,
        ...migration.document,
      }),
      h = await writeProjectAsset(
        root,
        "project.json",
        JSON.stringify({ app: "pcb-reveng-simple", version: 2, ...candidate }, null, 2),
      );
    adoptProject(candidate, root, await h.getFile());
    notify("Imported into a new project folder. Original .pcbrev preserved.");
  } catch (e) {
    if (e.name !== "AbortError")
      notify("Import failed: " + e.message + " The current project is unchanged.", true);
  } finally {
    ProjectFile.busy = false;
    showImportProgress("", false);
    refreshSaveState();
  }
}
async function collectGarbage() {
  if (
    !ProjectFile.root ||
    ProjectFile.busy ||
    !confirm(
      "Remove unused app-owned scan folders and PDF files? Undo and redo assets are retained.",
    )
  )
    return;
  ProjectFile.busy = true;
  refreshSaveState();
  try {
    const states = [
        State,
        ...History.past.map(JSON.parse),
        ...History.future.map(JSON.parse),
        { scans: [], attachments: Editor.clipboard?.attachments || [] },
      ],
      scans = new Set(states.flatMap((s) => s.scans.map((x) => "scan-" + x.id))),
      pdfs = new Set(states.flatMap((s) => s.attachments.map((a) => a.sha256 + ".pdf")));
    for (const [folder, used, pattern] of [
      ["images", scans, /^scan-\d+$/],
      ["datasheets", pdfs, /^[a-f0-9]{64}\.pdf$/],
    ]) {
      const dir = await ProjectFile.root.getDirectoryHandle(folder);
      for await (const [name] of dir.entries())
        if (pattern.test(name) && !used.has(name)) await dir.removeEntry(name, { recursive: true });
    }
    notify("Unused project assets removed.");
  } catch (e) {
    notify("Cleanup failed: " + e.message, true);
  } finally {
    ProjectFile.busy = false;
    refreshSaveState();
  }
}
