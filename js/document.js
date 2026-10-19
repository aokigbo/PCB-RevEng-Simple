"use strict";

function emptyDocument() {
  return {
    name: "Untitled board",
    nextId: 3,
    calibration: null,
    physicalLayers: [
      { id: 1, description: "Top" },
      { id: 2, description: "Bottom" },
    ],
    scans: [],
    components: [],
    traces: [],
    vias: [],
    attachments: [],
  };
}
let State = emptyDocument();
let idFloor = State.nextId;
const History = { past: [], future: [], limit: 60 };
function reserveId() {
  const id = Math.max(State.nextId, idFloor);
  idFloor = id + 1;
  return id;
}
function nextId() {
  const id = reserveId();
  State.nextId = id + 1;
  return id;
}
function snapshot() {
  return JSON.stringify(State);
}
function remember(before) {
  if (before === snapshot()) return false;
  History.past.push(before);
  if (History.past.length > History.limit) History.past.shift();
  History.future.length = 0;
  return true;
}
function editDocument(fn) {
  const before = snapshot();
  try {
    fn();
    const used = new Set(State.components.map((c) => c.datasheetId));
    State.attachments = State.attachments.filter((a) => used.has(a.id));
  } catch (error) {
    State = JSON.parse(before);
    throw error;
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
function layerName(id, description = false) {
  const i = State.physicalLayers.findIndex((l) => l.id === id),
    l = State.physicalLayers[i];
  return i < 0
    ? "Missing layer"
    : "L" + (i + 1) + (description && l.description ? " — " + l.description : "");
}
function viaLayerIds(v, layers = State.physicalLayers) {
  const a = layers.findIndex((l) => l.id === v.fromLayerId),
    b = layers.findIndex((l) => l.id === v.toLayerId);
  return a < 0 || b < 0 ? [] : layers.slice(Math.min(a, b), Math.max(a, b) + 1).map((l) => l.id);
}
function viaOnLayer(v, id) {
  return viaLayerIds(v).includes(id);
}
function reorderLayers(ids, approve = () => true) {
  if (
    ids.length !== State.physicalLayers.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !State.physicalLayers.some((l) => l.id === id))
  )
    throw new Error("Invalid layer order.");
  const layers = ids.map((id) => State.physicalLayers.find((l) => l.id === id));
  const changed = State.vias.filter(
    (v) =>
      viaLayerIds(v)
        .sort((a, b) => a - b)
        .join() !==
      viaLayerIds(v, layers)
        .sort((a, b) => a - b)
        .join(),
  ).length;
  if (changed && !approve(changed)) return false;
  return editDocument(() => {
    State.physicalLayers = layers;
  });
}
function deletePhysicalLayer(id) {
  if (State.physicalLayers.length < 2) throw new Error("Keep at least one physical layer.");
  const spans = new Map(State.vias.map((v) => [v.id, viaLayerIds(v).filter((x) => x !== id)]));
  return editDocument(() => {
    State.physicalLayers = State.physicalLayers.filter((l) => l.id !== id);
    for (const key of ["scans", "components", "traces"])
      State[key] = State[key].filter((o) => o.layerId !== id);
    State.vias = State.vias.filter((v) => spans.get(v.id).length >= 2);
    for (const v of State.vias) {
      const s = spans.get(v.id);
      v.fromLayerId = s[0];
      v.toLayerId = s.at(-1);
    }
  });
}
function nextRef(prefix) {
  let i = 1;
  while (State.components.some((c) => c.ref.toUpperCase() === (prefix + i).toUpperCase())) i++;
  return prefix + i;
}
function nextPinNumber(c) {
  let i = 1;
  while (c.pins.some((p) => p.num === String(i))) i++;
  return String(i);
}
function makeComponent(
  fpId,
  params,
  x,
  y,
  prefix,
  layerId = State.physicalLayers[0].id,
  preview = false,
) {
  const fp = generateFootprint(fpId, params);
  if (!fp) throw new Error("Unknown package.");
  return {
    id: preview ? 0 : nextId(),
    ref: nextRef(prefix || refPrefixFor(fpId, "")),
    value: "",
    footprint: fp.label,
    x,
    y,
    rot: 0,
    layerId,
    body: { ...fp.body, w: fp.body.w * 10, h: fp.body.h * 10, x: 0, y: 0 },
    pins: fp.pins.map((p) => {
      const { xmm, ymm, ...q } = p;
      return {
        ...q,
        num: String(p.num),
        x: xmm * 10,
        y: ymm * 10,
        w: p.w * 10,
        h: (p.shape === "circle" ? p.w : p.h) * 10,
        ...(p.shape === "circle" && p.tht !== false ? { hole: (p.hole || p.w * 0.4) * 10 } : {}),
      };
    }),
  };
}
function documentPayload() {
  return { app: "pcb-reveng-simple", version: 2, ...State };
}
function serializeProject() {
  return JSON.stringify(documentPayload(), null, 2) + "\n";
}
function validateDocument(input) {
  const d = structuredClone(input),
    ids = new Set();
  const fail = (s) => {
    throw new Error("Invalid project: " + s);
  };
  const num = (v, s, min = -1e12, max = 1e12) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(s);
  };
  const str = (v, s) => {
    if (typeof v !== "string" || v.length > 10000) fail(s);
  };
  const list = (v, s, max = 100000) => {
    if (!Array.isArray(v) || v.length > max) fail(s);
  };
  const id = (o) => {
    num(o.id, "object ID", 1, Number.MAX_SAFE_INTEGER - 1);
    if (!Number.isInteger(o.id) || ids.has(o.id)) fail("duplicate ID");
    ids.add(o.id);
  };
  const xy = (o) => {
    num(o.x, "X");
    num(o.y, "Y");
  };
  if (d.app !== "pcb-reveng-simple" || d.version !== 2)
    fail("unsupported format; use Import Existing .pcbrev for v1");
  str(d.name, "name");
  if (d.calibration !== null) {
    if (!d.calibration) fail("calibration");
    num(d.calibration.boardUnitsPerMm, "calibration", 1e-9, 1e9);
  }
  for (const k of ["physicalLayers", "scans", "components", "traces", "vias", "attachments"])
    list(d[k], k);
  if (!d.physicalLayers.length) fail("at least one physical layer is required");
  for (const l of d.physicalLayers) {
    id(l);
    str(l.description, "layer description");
  }
  const layers = new Set(d.physicalLayers.map((l) => l.id));
  const layer = (o) => {
    if (!layers.has(o.layerId)) fail("missing physical layer");
  };
  for (const s of d.scans) {
    id(s);
    layer(s);
    str(s.name, "scan name");
    str(s.sourceName, "source name");
    num(s.width, "scan width", 1, 1e7);
    num(s.height, "scan height", 1, 1e7);
    if (
      !Number.isInteger(s.width) ||
      !Number.isInteger(s.height) ||
      s.tileSize !== 512 ||
      s.levels !== pyramidLevels(s.width, s.height).length
    )
      fail("scan pyramid");
    for (const f of ["flipX", "flipY", "aligned"]) if (typeof s[f] !== "boolean") fail(f);
    const t = s.transform;
    if (!t) fail("scan transform");
    num(t.tx, "scan X");
    num(t.ty, "scan Y");
    num(t.rotation, "scan rotation");
    num(t.scale, "scan scale", 1e-9, 1e9);
  }
  const refs = new Set();
  for (const c of d.components) {
    id(c);
    layer(c);
    xy(c);
    num(c.rot, "rotation");
    str(c.ref, "reference");
    if (!c.ref.trim() || refs.has(c.ref.toUpperCase())) fail("duplicate reference");
    refs.add(c.ref.toUpperCase());
    str(c.value, "value");
    str(c.footprint, "package");
    if (!c.body) fail("body");
    if (c.body.shape !== undefined && !["rect", "circle"].includes(c.body.shape))
      fail("body shape");
    xy(c.body);
    num(c.body.w, "body width", 1e-9);
    num(c.body.h, "body height", 1e-9);
    list(c.pins, "pads", 2000);
    const pins = new Set();
    for (const p of c.pins) {
      str(p.num, "pin number");
      if (!p.num.trim() || pins.has(p.num)) fail("duplicate pin");
      pins.add(p.num);
      xy(p);
      str(p.name ?? "", "pin name");
      num(p.w, "pad width", 1e-9);
      num(p.h, "pad height", 1e-9);
      if (!["rect", "circle"].includes(p.shape)) fail("pad shape");
      if (p.tht !== undefined && typeof p.tht !== "boolean") fail("drill flag");
      if (p.hole !== undefined) num(p.hole, "drill", 0, Math.min(p.w, p.h));
      if (p.shape === "circle" && p.w !== p.h) fail("round pad dimensions");
    }
    delete c.kicad;
  }
  for (const t of d.traces) {
    id(t);
    layer(t);
    num(t.width, "trace width", 1e-9);
    list(t.points, "trace points");
    if (t.points.length < 2) fail("trace points");
    t.points.forEach(xy);
  }
  for (const v of d.vias) {
    id(v);
    xy(v);
    num(v.r, "via radius", 1e-9);
    num(v.hole, "via hole", 0, v.r);
    if (!layers.has(v.fromLayerId) || !layers.has(v.toLayerId) || v.fromLayerId === v.toLayerId)
      fail("via span");
  }
  for (const a of d.attachments) {
    id(a);
    str(a.name, "PDF name");
    if (!/\.pdf$/i.test(a.name) || a.mime !== "application/pdf" || !/^[a-f0-9]{64}$/.test(a.sha256))
      fail("PDF metadata");
    num(a.size, "PDF size", 5, 67108864);
  }
  const attachments = new Set(d.attachments.map((a) => a.id));
  for (const c of d.components)
    if (c.datasheetId !== undefined && !attachments.has(c.datasheetId)) fail("datasheet reference");
  for (const o of [...d.components.flatMap((c) => c.pins), ...d.traces, ...d.vias])
    if (o.netName !== undefined) {
      str(o.netName, "net name");
      if (/[\x00-\x1f]/.test(o.netName)) fail("net name");
    }
  num(
    d.nextId,
    "next ID",
    [...ids].reduce((m, n) => Math.max(m, n), 0) + 1,
    Number.MAX_SAFE_INTEGER,
  );
  if (!Number.isInteger(d.nextId)) fail("next ID");
  const checkKeys = (o, keys) => {
    for (const key of Object.keys(o)) if (!keys.includes(key)) fail("unsupported field " + key);
  };
  if (d.calibration) checkKeys(d.calibration, ["boardUnitsPerMm"]);
  for (const l of d.physicalLayers) checkKeys(l, ["id", "description"]);
  for (const s of d.scans) {
    checkKeys(s, [
      "id",
      "layerId",
      "name",
      "sourceName",
      "width",
      "height",
      "tileSize",
      "levels",
      "flipX",
      "flipY",
      "aligned",
      "transform",
    ]);
    checkKeys(s.transform, ["tx", "ty", "scale", "rotation"]);
  }
  for (const c of d.components) {
    checkKeys(c, [
      "id",
      "ref",
      "value",
      "footprint",
      "layerId",
      "datasheetId",
      "x",
      "y",
      "rot",
      "body",
      "pins",
    ]);
    checkKeys(c.body, ["x", "y", "w", "h", "shape"]);
    for (const p of c.pins) {
      checkKeys(p, ["num", "name", "x", "y", "w", "h", "shape", "tht", "hole", "netName"]);
      if (p.shape === "circle" && p.tht !== false) num(p.hole, "visible drill", 0, p.w);
    }
  }
  for (const t of d.traces) {
    checkKeys(t, ["id", "layerId", "width", "points", "netName"]);
    t.points.forEach((p) => checkKeys(p, ["x", "y"]));
  }
  for (const v of d.vias)
    checkKeys(v, ["id", "x", "y", "r", "hole", "fromLayerId", "toLayerId", "netName"]);
  for (const a of d.attachments) checkKeys(a, ["id", "name", "mime", "size", "sha256"]);
  // Only the v2 schema is adopted; binary assets and transient views cannot sneak into state.
  return {
    name: d.name,
    nextId: d.nextId,
    calibration: d.calibration,
    physicalLayers: d.physicalLayers,
    scans: d.scans,
    components: d.components,
    traces: d.traces,
    vias: d.vias,
    attachments: d.attachments,
  };
}
