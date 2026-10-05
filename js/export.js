"use strict";

function exportBOM() {
  return _toCSV([
    ["Reference", "Value", "Footprint", "Side"],
    ...State.components.map((c) => [c.ref, c.value, c.footprint, c.side]),
  ]);
}

function safeDatasheetName(name) {
  const cleaned = String(name)
    .replace(/[\\/]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned && /\.pdf$/i.test(cleaned) ? cleaned : "datasheet.pdf";
}
function datasheetPaths(components = State.components) {
  const paths = new Map(),
    used = new Set();
  for (const c of components) {
    const id = c.datasheetId;
    if (id === undefined || paths.has(id)) continue;
    const attachment = State.attachments.find((a) => a.id === id);
    if (!attachment) throw new Error("A component references a missing datasheet.");
    const name = safeDatasheetName(attachment.name),
      base = name.slice(0, -4);
    let candidate = name,
      suffix = 2;
    while (used.has(candidate.toLowerCase())) candidate = base + "-" + suffix++ + ".pdf";
    used.add(candidate.toLowerCase());
    paths.set(id, "datasheets/" + candidate);
  }
  return paths;
}
function buildElectricalExportModel() {
  rebuildConnectivity();
  const paths = datasheetPaths();
  const components = [...State.components]
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    .map((c) => {
      const item = {
        reference: c.ref,
        value: c.value,
        package: c.footprint,
        side: c.side,
        pins: c.pins.map((p) => ({
          number: p.num,
          name: p.name || "",
          net: Connectivity.byKey.get(pinKey(c, p))?.name || null,
        })),
      };
      if (c.datasheetId !== undefined) item.datasheet = paths.get(c.datasheetId);
      return item;
    });
  const nets = Connectivity.nets.map((net) => ({
    name: net.name,
    userNamed: net.names.length > 0,
    pins: net.members
      .filter((m) => m.type === "pad")
      .map((m) => ({ component: m.c.ref, number: m.p.num, name: m.p.name || "" }))
      .sort(
        (a, b) =>
          a.component.localeCompare(b.component, undefined, { numeric: true }) ||
          a.number.localeCompare(b.number, undefined, { numeric: true }),
      ),
    copperObjectCount: net.members.length,
  }));
  return {
    schema: "pcb-reveng-ai-graph-v1",
    project: { name: State.name },
    components,
    nets,
    warnings: [...Connectivity.issues],
    datasheetPaths: paths,
  };
}
function buildGraphJSON(model) {
  const { datasheetPaths, ...graph } = model;
  return JSON.stringify(graph, null, 2) + "\n";
}
function markdownValue(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\`*_{}\[\]()#+.!>])/g, "\\$1");
}
function buildContextMarkdown(model) {
  const lines = [
    "# " + markdownValue(model.project.name) + " — Reverse Engineering Context",
    "",
    "This package represents reconstructed PCB electrical connectivity. Geometry and board photographs are omitted.",
    "",
    "## Connectivity warnings",
    "",
    ...(model.warnings.length ? model.warnings.map((w) => "- " + markdownValue(w)) : ["None."]),
    "",
    "## Components",
    "",
  ];
  for (const c of model.components) {
    lines.push(
      "### " + markdownValue(c.reference) + " — " + markdownValue(c.value || c.package),
      "",
    );
    if (c.datasheet) lines.push("Datasheet: " + markdownValue(c.datasheet), "");
    lines.push("Pins:", "");
    if (!c.pins.length) lines.push("- None recorded.");
    else
      for (const p of c.pins)
        lines.push(
          "- " +
            (p.name ? markdownValue(p.name) + " | " : "") +
            markdownValue(p.number) +
            " → " +
            markdownValue(p.net || "unconnected"),
        );
    lines.push("");
  }
  lines.push("## Nets", "");
  for (const net of model.nets) {
    lines.push("### " + markdownValue(net.name), "");
    if (!net.pins.length) lines.push("- No component pins recorded.");
    else
      for (const p of net.pins)
        lines.push(
          "- " +
            markdownValue(p.component) +
            "." +
            markdownValue(p.number) +
            (p.name ? " — " + markdownValue(p.name) : ""),
        );
    lines.push("");
  }
  return lines.join("\n");
}
function buildAIPackage() {
  const model = buildElectricalExportModel();
  const files = {
    "context.md": fflate.strToU8(buildContextMarkdown(model)),
    "graph.json": fflate.strToU8(buildGraphJSON(model)),
  };
  for (const [id, path] of model.datasheetPaths) {
    const bytes = AttachmentAssets.get(id);
    if (!bytes) throw new Error("A referenced datasheet is unavailable.");
    files[path] = [bytes, { level: 0 }];
  }
  return { model, zip: fflate.zipSync(files, { level: 6 }) };
}
function downloadExport(blob, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function exportFile(kind) {
  try {
    if (kind === "bom") {
      downloadExport(new Blob([exportBOM()], { type: "text/csv" }), State.name + "-BOM.csv");
      notify("Exported BOM.");
    } else if (kind === "ai") {
      const { zip } = buildAIPackage();
      const stem = State.name.replace(/[\\/\x00-\x1f\x7f]/g, "_").trim() || "Untitled board";
      downloadExport(new Blob([zip], { type: "application/zip" }), stem + "-AI.zip");
      notify("Exported AI package.");
    }
  } catch (err) {
    notify("Export failed: " + err.message, true);
  }
}

/* Serialise a row array to RFC-4180 CSV (quote fields with comma/quote/newline). */
function _toCSV(rows) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          v = String(v == null ? "" : v);
          return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        })
        .join(","),
    )
    .join("\n");
}
