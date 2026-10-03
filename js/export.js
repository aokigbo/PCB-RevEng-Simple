"use strict";
function buildNetMap() {
  const map = new Map();
  for (const c of State.components)
    for (const p of c.pins) {
      const net = Connectivity.byKey.get(pinKey(c, p));
      if (!net) continue;
      if (!map.has(net.id)) map.set(net.id, []);
      map.get(net.id).push({ ref: c.ref, pin: p.num });
    }
  return map;
}
function exportBOM() {
  return _toCSV([
    ["Reference", "Value", "Footprint", "Side"],
    ...State.components.map((c) => [c.ref, c.value, c.kicad || c.footprint, c.side]),
  ]);
}
function exportFile(kind) {
  rebuildConnectivity();
  if (!State.components.length) {
    notify("Place components before exporting.", true);
    return;
  }
  if (kind === "net" && Connectivity.issues.length) {
    notify("Resolve the connectivity warnings before exporting a netlist.", true);
    renderInspector();
    return;
  }
  if (State.components.some((c) => !c.pins.length)) {
    notify("Add pads to every component before exporting.", true);
    return;
  }
  const text = kind === "net" ? exportKiCad() : exportBOM();
  const blob = new Blob([text], { type: kind === "net" ? "text/plain" : "text/csv" });
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = State.name + (kind === "net" ? ".net" : "-BOM.csv");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(
    kind === "net"
      ? "Exported connectivity for KiCad. Assign any missing footprints in KiCad."
      : "Exported BOM.",
  );
}
// Connectivity netlist and CSV escaping retained from upstream.
function sexpEscape(s) {
  s = String(s == null ? "" : s);
  if (s === "") return '""';
  if (/[\s();"\\]/.test(s))
    return (
      '"' +
      s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t") +
      '"'
    );
  return s;
}

/* KiCad s-expression netlist — importable in Pcbnew (File → Import Netlist) */
function exportKiCad() {
  const lines = [];
  lines.push("(export (version D)");
  lines.push("  (design");
  lines.push("    (source " + sexpEscape("pcb-reveng") + ")");
  lines.push("    (date " + sexpEscape(new Date().toISOString()) + ")");
  lines.push("    (tool " + sexpEscape("PCB RevEng Simple") + "))");
  lines.push("  (components");
  for (const c of State.components) {
    lines.push("    (comp (ref " + sexpEscape(c.ref) + ")");
    lines.push("      (value " + sexpEscape(c.value || "~") + ")");
    lines.push("      (footprint " + sexpEscape(c.kicad || "") + ")");
    lines.push("      (tstamp " + c.id.toString(16).padStart(8, "0").toUpperCase() + "))");
  }
  lines.push("  )");
  lines.push("  (nets");
  const map = buildNetMap();
  let code = 1;
  for (const net of Connectivity.nets) {
    const nodes = map.get(net.id);
    if (!nodes || !nodes.length) continue;
    lines.push("    (net (code " + code++ + ") (name " + sexpEscape(net.name) + ")");
    for (const n of nodes)
      lines.push("      (node (ref " + sexpEscape(n.ref) + ") (pin " + sexpEscape(n.pin) + "))");
    lines.push("    )");
  }
  lines.push("  )");
  lines.push(")");
  return lines.join("\n");
}

/* serialise a row array to RFC-4180 CSV (quote fields with comma/quote/newline) */
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
