"use strict";

// Only document data lives in State. Images and history are session-only.
function emptyDocument() {
  return {
    name: "Untitled board",
    pxPerMm: 10,
    calibrated: false,
    nextId: 1,
    layers: [],
    components: [],
    traces: [],
    vias: [],
  };
}
let State = emptyDocument();
const ImageAssets = new Map();
let assetSequence = 1;
const History = { past: [], future: [], limit: 60 };
function nextId() {
  return State.nextId++;
}
function snapshot() {
  return JSON.stringify(State);
}
function remember(before) {
  if (before === snapshot()) return false;
  History.past.push(before);
  if (History.past.length > History.limit) History.past.shift();
  History.future.length = 0;
  pruneImageAssets();
  return true;
}
function editDocument(fn) {
  const before = snapshot();
  try {
    fn();
  } catch (err) {
    State = JSON.parse(before);
    throw err;
  }
  return remember(before);
}
function undo() {
  if (!History.past.length) return false;
  History.future.push(snapshot());
  State = JSON.parse(History.past.pop());
  return true;
}
function redo() {
  if (!History.future.length) return false;
  History.past.push(snapshot());
  State = JSON.parse(History.future.pop());
  return true;
}
function clearHistory() {
  History.past.length = History.future.length = 0;
}
function pruneImageAssets() {
  const used = new Set(State.layers.map((l) => l.assetId));
  for (const text of [...History.past, ...History.future])
    for (const l of JSON.parse(text).layers) used.add(l.assetId);
  for (const id of ImageAssets.keys()) if (!used.has(id)) ImageAssets.delete(id);
}
function nextRef(prefix) {
  let i = 1;
  while (State.components.some((c) => c.ref === prefix + i)) i++;
  return prefix + i;
}
function makeComponent(fpId, params, x, y, prefix) {
  const fp = generateFootprint(fpId, params);
  if (!fp) throw new Error("Unknown component package");
  return normalizeComponentGeometry({
    id: nextId(),
    ref: nextRef(prefix || refPrefixFor(fpId, "")),
    value: "",
    footprint: fp.label,
    kicad: fp.kicad || "",
    x,
    y,
    rot: 0,
    side: "front",
    body: { ...fp.body },
    pins: fp.pins.map((p) => ({ ...p, num: String(p.num) })),
  });
}
// File-boundary migration: all editing/rendering uses physical millimetres.
function normalizeComponentGeometry(c) {
  const scale = c.scale === undefined ? 1 : c.scale;
  // Older round bodies were drawn with their larger dimension as the diameter.
  if (c.scale !== undefined && c.body.shape === "circle")
    c.body.w = c.body.h = Math.max(c.body.w, c.body.h);
  c.body.w *= scale;
  c.body.h *= scale;
  for (const p of c.pins) {
    p.xmm *= scale;
    p.ymm *= scale;
    p.w *= scale;
    p.h *= scale;
    if (p.hole !== undefined) p.hole *= scale;
    if (p.shape === "circle") {
      p.h = p.w;
      // Materialize the old drawing fallback so resizing never changes the drill.
      if (p.tht !== false && !p.hole) p.hole = p.w * 0.4;
    }
  }
  delete c.scale;
  return c;
}
function documentPayload() {
  return {
    app: "pcb-reveng-simple",
    version: 1,
    ...State,
    layers: State.layers.map((l) => {
      const { assetId, ...meta } = l;
      const asset = ImageAssets.get(assetId);
      if (!asset)
        throw new Error("A photograph is missing. Save was stopped to protect the project.");
      return { ...meta, dataURL: asset.dataURL };
    }),
  };
}
function serializeProject() {
  return JSON.stringify(documentPayload(), null, 2) + "\n";
}

// Refuse unsupported data before replacing the open project. This is deliberately
// strict: malformed geometry must not become a plausible-looking wrong netlist.
function validateDocument(input) {
  const d = structuredClone(input);
  const fail = (message) => {
    throw new Error("Invalid project: " + message);
  };
  const num = (v, label, min = -1e8, max = 1e8) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(label);
  };
  const str = (v, label) => {
    if (typeof v !== "string" || v.length > 10000) fail(label);
  };
  const list = (v, label, max = 100000) => {
    if (!Array.isArray(v) || v.length > max) fail(label);
  };
  if (d.app !== "pcb-reveng-simple" || d.version !== 1) fail("unsupported application or version");
  str(d.name, "project name");
  num(d.pxPerMm, "image scale", 0.0001, 1e6);
  if (typeof d.calibrated !== "boolean") fail("calibration state");
  list(d.layers, "photographs", 2);
  list(d.components, "components");
  list(d.traces, "traces");
  list(d.vias, "vias");
  const ids = new Set(),
    sides = new Set(),
    refs = new Set();
  const id = (o) => {
    num(o.id, "object ID", 1, Number.MAX_SAFE_INTEGER - 1);
    if (!Number.isInteger(o.id) || ids.has(o.id)) fail("duplicate object ID");
    ids.add(o.id);
  };
  const xy = (o) => {
    num(o.x, "X coordinate");
    num(o.y, "Y coordinate");
  };
  const side = (o) => {
    if (!["front", "back"].includes(o.side)) fail("only front/back are supported");
  };
  const label = (o) => {
    if (o.netName !== undefined) {
      str(o.netName, "net name");
      if (/[\x00-\x1f]/.test(o.netName)) fail("net name contains control characters");
    }
  };
  for (const l of d.layers) {
    id(l);
    side(l);
    if (sides.has(l.side)) fail("more than one photograph on a side");
    sides.add(l.side);
    str(l.name, "photograph name");
    num(l.tx, "image X");
    num(l.ty, "image Y");
    num(l.scale, "image scale", 1e-8, 1e6);
    num(l.rot, "image rotation");
    num(l.opacity, "opacity", 0, 1);
    num(l.width, "image width", 1, 100000);
    num(l.height, "image height", 1, 100000);
    if (typeof l.mirror !== "boolean") fail("image mirror");
    if (
      typeof l.dataURL !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(l.dataURL)
    )
      fail("photographs must be embedded PNG, JPEG or WebP");
  }
  for (const c of d.components) {
    id(c);
    xy(c);
    side(c);
    num(c.rot, "component rotation");
    if (c.scale !== undefined) num(c.scale, "component scale", 0.001, 1000);
    str(c.ref, "reference");
    if (!c.ref.trim() || refs.has(c.ref.toUpperCase())) fail("empty or duplicate reference");
    refs.add(c.ref.toUpperCase());
    str(c.value, "value");
    str(c.footprint, "footprint");
    str(c.kicad, "KiCad footprint");
    if (!c.body) fail("component body");
    num(c.body.w, "body width", 1e-6, 1e7);
    num(c.body.h, "body height", 1e-6, 1e7);
    list(c.pins, "pads", 2000);
    const pins = new Set();
    for (const p of c.pins) {
      str(p.num, "pin number");
      if (!p.num.trim() || pins.has(p.num)) fail("empty or duplicate pin number");
      pins.add(p.num);
      str(p.name ?? "", "pin name");
      num(p.xmm, "pad X", -1e11, 1e11);
      num(p.ymm, "pad Y", -1e11, 1e11);
      num(p.w, "pad width", 1e-6, 1e7);
      num(p.h, "pad height", 1e-6, 1e7);
      if (!["circle", "rect"].includes(p.shape)) fail("pad shape");
      if (p.tht !== undefined && typeof p.tht !== "boolean") fail("pad plating");
      if (p.shape === "rect" && p.tht === true) fail("through-hole pads must be round");
      if (p.hole !== undefined) num(p.hole, "pad hole", 0, Math.min(p.w, p.h));
      label(p);
    }
    normalizeComponentGeometry(c);
    // Retain the full physical range of previously valid scaled projects.
    num(c.body.w, "body width", 1e-6, 1e7);
    num(c.body.h, "body height", 1e-6, 1e7);
    for (const p of c.pins) {
      num(p.xmm, "pad X", -1e11, 1e11);
      num(p.ymm, "pad Y", -1e11, 1e11);
      num(p.w, "pad width", 1e-6, 1e7);
      num(p.h, "pad height", 1e-6, 1e7);
      if (p.hole !== undefined) num(p.hole, "pad hole", 0, p.w);
    }
  }
  for (const t of d.traces) {
    id(t);
    side(t);
    num(t.width, "trace width", 0.001, 100000);
    list(t.points, "trace vertices", 100000);
    if (t.points.length < 2) fail("trace needs two points");
    t.points.forEach(xy);
    label(t);
  }
  for (const v of d.vias) {
    id(v);
    xy(v);
    num(v.r, "via radius", 0.001, 100000);
    num(v.hole, "via hole radius", 0.001, v.r);
    label(v);
  }
  const maxId = [...ids].reduce((max, id) => Math.max(max, id), 0);
  num(d.nextId, "next ID", maxId + 1, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(d.nextId)) fail("next ID");
  delete d.app;
  delete d.version;
  return d;
}

// Conversion is deliberately limited. Never flatten multiple boards or discard
// schematic/annotation data, inner copper, warped/remote photos or unknown pads.
function migrateLegacy(raw) {
  if (raw.app !== "pcb-reveng" || ![1, 2].includes(raw.version))
    throw new Error("This is not a supported PCB RevEng project.");
  const reject = (why) => {
    throw new Error(
      "This older project uses " +
        why +
        ". Open it in the original PCB RevEng; the original file has not been changed.",
    );
  };
  if (raw.boards && raw.boards.length !== 1) reject("multiple boards");
  const b = raw.boards?.[0] || raw;
  if ((b.layerCount || raw.layerCount || 2) !== 2) reject("inner copper layers");
  if (
    (raw.xlinks || []).length ||
    (b.schWires || []).length ||
    (b.schLabels || []).length ||
    (b.notes || []).length ||
    (raw.bomColumns || []).length
  )
    reject("schematic, annotation, cross-board or custom BOM data");
  const d = {
    ...emptyDocument(),
    name: b.name || "Imported board",
    pxPerMm: raw.pxPerMm || 10,
    calibrated: true,
  };
  const nets = new Map((raw.nets || []).map((n) => [n.id, n]));
  // Retain labels on every legacy member: disconnected old assignments are then
  // reported as duplicate names, never silently discarded or assumed connected.
  const netName = (o) => (o.netId ? nets.get(o.netId)?.name || "LEGACY_" + o.netId : undefined);
  d.components = (b.components || []).map((c) => {
    if (
      c.xlink ||
      c.bom ||
      Object.keys(c).some((k) => k.startsWith("sch")) ||
      (c.part && c.value && c.part !== c.value)
    )
      reject("component schematic or custom metadata");
    const fp = generateFootprint(c.fpId, c.fpParams);
    if (!fp) reject("an unsupported footprint (" + c.fpId + ")");
    if ((c.pins || []).length !== fp.pins.length) reject("inconsistent pad geometry");
    return {
      id: c.id,
      ref: c.ref,
      value: c.value || c.part || "",
      footprint: fp.label,
      kicad: c.kicad || fp.kicad || "",
      x: c.x,
      y: c.y,
      rot: c.rot || 0,
      scale: c.scale || 1,
      side: c.side,
      body: fp.body,
      pins: c.pins.map((p, i) => {
        if (p.nc) reject("explicit no-connect pads");
        const f = fp.pins.find((f) => String(f.num) === String(p.num));
        if (!f) reject("unknown pin numbers");
        return { ...f, num: String(p.num), name: p.name || f.name || "", netName: netName(p) };
      }),
    };
  });
  d.traces = (b.traces || []).map((t) => ({
    id: t.id,
    side: t.side,
    width: t.width || raw.traceW || 5,
    points: t.points,
    netName: netName(t),
  }));
  d.vias = (b.vias || []).map((v) => {
    if (v.from || v.to) reject("blind or buried vias");
    return {
      id: v.id,
      x: v.x,
      y: v.y,
      r: v.r || raw.viaR || 5,
      hole: v.hole || raw.viaHole || 2.5,
      netName: netName(v),
    };
  });
  d.layers = (b.layers || []).map((l) => {
    if (l.warp || l.url || l.imgW || l.imgH) reject("warped, linked or downscaled photographs");
    return {
      id: l.id,
      name: l.name,
      side: l.side,
      dataURL: l.dataURL,
      tx: l.tx || 0,
      ty: l.ty || 0,
      scale: l.scale || 1,
      rot: l.rot || 0,
      mirror: !!l.mirror,
      opacity: l.opacity ?? 1,
      width: 1,
      height: 1,
    };
  });
  d.nextId = Math.max(0, ...d.layers.concat(d.components, d.traces, d.vias).map((o) => o.id)) + 1;
  return { app: "pcb-reveng-simple", version: 1, ...d };
}
