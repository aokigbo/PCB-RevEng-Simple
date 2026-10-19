"use strict";
function isPDF(bytes) {
  return bytes.length >= 5 && [37, 80, 68, 70, 45].every((n, i) => bytes[i] === n);
}
function pdfBytes(url) {
  if (!/^data:application\/pdf;base64,/.test(url)) throw new Error("Invalid PDF data.");
  const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
  if (!isPDF(bytes)) throw new Error("Invalid PDF signature.");
  return bytes;
}
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function chooseDatasheet(c) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.onchange = () => {
    if (input.files[0]) attachDatasheet(c.id, input.files[0]);
  };
  input.click();
}
async function attachDatasheet(id, file) {
  if (ProjectFile.busy || !ProjectFile.root) return;
  ProjectFile.busy = true;
  refreshSaveState();
  try {
    if (
      !/\.pdf$/i.test(file.name) ||
      (file.type && file.type !== "application/pdf") ||
      file.size > 64 * 1024 * 1024
    )
      throw new Error("Choose a PDF up to 64 MiB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPDF(bytes)) throw new Error("Invalid PDF signature.");
    const hash = await sha256(bytes),
      dir = await ProjectFile.root.getDirectoryHandle("datasheets", { create: true });
    await writeProjectAsset(dir, hash + ".pdf", file);
    ProjectFile.busy = false;
    change(() => {
      const c = State.components.find((c) => c.id === id);
      if (!c) return;
      let a = State.attachments.find((a) => a.sha256 === hash);
      if (!a) {
        a = {
          id: nextId(),
          name: file.name,
          mime: "application/pdf",
          size: file.size,
          sha256: hash,
        };
        State.attachments.push(a);
      }
      c.datasheetId = a.id;
    });
  } catch (e) {
    notify("Datasheet was not attached: " + e.message, true);
  } finally {
    ProjectFile.busy = false;
    refreshSaveState();
  }
}
function removeDatasheet(c) {
  change(() => delete c.datasheetId);
}
async function openDatasheet(c) {
  const attachment = State.attachments.find((a) => a.id === c.datasheetId);
  if (!attachment) return;
  const tab = window.open("about:blank", "_blank");
  if (!tab) return notify("Allow a new tab to open the PDF.", true);
  tab.opener = null;
  try {
    const file = await pdfFile(attachment);
    if (!isPDF(new Uint8Array(await file.slice(0, 5).arrayBuffer())))
      throw new Error("Invalid PDF file.");
    const url = URL.createObjectURL(new Blob([file], { type: "application/pdf" }));
    tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  } catch (e) {
    tab.close();
    notify("Cannot open datasheet: " + e.message, true);
  }
}
