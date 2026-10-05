"use strict";

function pdfDataURL(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 32766)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 32766))));
  // Each chunk length is a multiple of three except the last one.
  return "data:application/pdf;base64," + chunks.join("");
}
function pdfBytes(dataURL) {
  const encoded = dataURL.slice("data:application/pdf;base64,".length);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  if (!isPDF(bytes)) throw new Error("The embedded datasheet is not a PDF.");
  return bytes;
}
function isPDF(bytes) {
  return (
    bytes.length >= 5 &&
    bytes[0] === 37 &&
    bytes[1] === 80 &&
    bytes[2] === 68 &&
    bytes[3] === 70 &&
    bytes[4] === 45
  );
}
async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function chooseDatasheet(component) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.hidden = true;
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.remove();
    if (file) attachDatasheet(component.id, file);
  });
  input.click();
}
async function attachDatasheet(componentId, file) {
  const epoch = documentEpoch;
  try {
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf"))
      throw new Error("Choose a PDF file with a .pdf filename.");
    if (file.size > 500000000) throw new Error("That PDF is too large for a project file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPDF(bytes)) throw new Error("The selected file does not have a PDF signature.");
    const hash = await sha256(bytes);
    if (epoch !== documentEpoch) return;
    const component = State.components.find((c) => c.id === componentId);
    if (!component) return;
    let attachment = State.attachments.find((a) => a.sha256 === hash);
    if (attachment) {
      change(() => (component.datasheetId = attachment.id));
    } else {
      const id = State.nextId;
      AttachmentAssets.set(id, bytes);
      if (
        !change(() => {
          attachment = {
            id: nextId(),
            name: file.name,
            mime: "application/pdf",
            size: bytes.length,
            sha256: hash,
          };
          State.attachments.push(attachment);
          component.datasheetId = id;
        })
      )
        AttachmentAssets.delete(id);
    }
  } catch (err) {
    notify("Datasheet was not attached: " + err.message, true);
  }
}
function removeDatasheet(component) {
  change(() => delete component.datasheetId);
}
function openDatasheet(component) {
  const bytes = AttachmentAssets.get(component.datasheetId);
  if (!bytes) return notify("The datasheet is unavailable.", true);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}
