"use strict";

const PACKAGES = {
  resistor: { label: "Resistor · SMD", id: "chip2", prefix: "R" },
  capacitor: { label: "Capacitor · SMD", id: "chip2", prefix: "C" },
  diode: { label: "Diode", id: "sod", prefix: "D" },
  transistor: { label: "Transistor", id: "sot23", prefix: "Q" },
  dip: { label: "DIP IC", id: "dip", prefix: "U" },
  soic: { label: "SOIC IC", id: "soic", prefix: "U" },
  header: { label: "Header / connector", id: "sip", prefix: "J" },
  smd: { label: "Generic SMD", id: "free", prefix: "U" },
  tht: { label: "Generic through-hole", id: "free", prefix: "U" },
  custom: { label: "Custom · place pads", id: "free", prefix: "U" },
};
function componentParams() {
  if (["smd", "tht", "custom"].includes(Editor.package)) {
    const p = { w: 10, h: 5, count: 2, pitch: 2.54, ...Editor.params };
    p.pinList =
      Editor.package === "custom"
        ? []
        : Array.from({ length: p.count }, (_, i) => ({
            num: String(i + 1),
            x: (i - (p.count - 1) / 2) * p.pitch,
            y: 0,
            w: 1.5,
            h: 1.5,
            shape: Editor.package === "tht" ? "circle" : "rect",
            tht: Editor.package === "tht",
          }));
    return p;
  }
  return Editor.params;
}
function componentPreview() {
  const pkg = PACKAGES[Editor.package],
    fp = generateFootprint(pkg.id, componentParams());
  Editor.preview = normalizeComponentGeometry({
    id: 0,
    ref: nextRef(pkg.prefix),
    value: "",
    body: fp.body,
    pins: fp.pins,
    footprint: fp.label,
    kicad: fp.kicad,
    rot: 0,
    side: View.drawSide,
  });
  requestRender();
}
function setTool(tool) {
  if (Editor.drag) cancelDrag();
  Editor.tool = tool;
  Editor.trace = [];
  Editor.selection = null;
  Editor.mode = null;
  Editor.padTarget = null;
  Editor.snap = null;
  if (tool === "component") componentPreview();
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === tool);
    b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  });
  View.canvas.style.cursor = tool === "select" ? "default" : "crosshair";
  renderInspector();
  updateHint();
  requestRender();
}
function setView(side) {
  if (Editor.trace.length && side !== "both" && side !== View.drawSide) finishTrace();
  View.side = side;
  if (side !== "both") View.drawSide = side;
  document.getElementById("draw-side").value = View.drawSide;
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === side);
    b.setAttribute("aria-pressed", String(b.dataset.view === side));
  });
  requestRender();
}
function afterEdit(inspector = true) {
  rebuildConnectivity();
  refreshSaveState();
  syncPhotoControls();
  document.getElementById("empty-state").hidden = !!(
    State.layers.length ||
    State.components.length ||
    State.traces.length ||
    State.vias.length
  );
  if (inspector) renderInspector();
  updateHint();
  requestRender();
}
function change(fn) {
  try {
    editDocument(fn);
    afterEdit();
    return true;
  } catch (err) {
    Editor.selection = null;
    afterEdit();
    notify(err.message, true);
    return false;
  }
}
function selectionItems(selection = Editor.selection) {
  return !selection ? [] : selection.type === "group" ? selection.items : [selection];
}
function isGroupSelection() {
  return Editor.selection?.type === "group";
}
function selectionContains(type, object, index) {
  return selectionItems().some(
    (s) => s.type === type && s.object === object && (type !== "pad" || s.index === index),
  );
}
function canonicalSelection(items) {
  const parents = new Set(items.filter((s) => s.type === "component").map((s) => s.object));
  const seen = new Set();
  items = items.filter((s) => {
    if (s.type === "pad" && parents.has(s.object)) return false;
    const key = s.type + ":" + s.object.id + ":" + (s.index ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return items.length > 1 ? { type: "group", items } : items[0] || null;
}
function marqueeSelection(a, b) {
  const items = [],
    box = bounds([a, b]);
  if (View.components)
    for (const c of State.components) {
      if (sideVisible(c.side) && cornersContained(box, bodyCornersWorld(c)))
        items.push({ type: "component", object: c });
      else
        c.pins.forEach((p, index) => {
          if (padVisible(c, p) && cornersContained(box, padCornersWorld(c, p)))
            items.push({ type: "pad", object: c, index });
        });
    }
  return canonicalSelection(items);
}
function anchorsFor(selection) {
  const locations = [];
  for (const s of selectionItems(selection)) {
    const o = s.object;
    const pads = s.type === "component" ? o.pins : s.type === "pad" ? [o.pins[s.index]] : [];
    for (const p of pads)
      locations.push({
        before: pinWorldPos(o, p),
        after: () => pinWorldPos(o, p),
        side: through(p) ? null : o.side,
      });
    if (s.type === "via") locations.push({ before: { x: o.x, y: o.y }, after: () => o });
  }
  const anchors = [];
  for (const t of State.traces)
    for (const point of t.points) {
      const loc = locations.find(
        (loc) =>
          (!loc.side || loc.side === t.side) &&
          Math.hypot(point.x - loc.before.x, point.y - loc.before.y) < 1e-5,
      );
      if (loc) anchors.push({ point, after: loc.after });
    }
  return anchors;
}
function applyAnchors(anchors) {
  for (const a of anchors) {
    const p = a.after();
    a.point.x = p.x;
    a.point.y = p.y;
  }
}
function modifySelected(fn) {
  const s = Editor.selection,
    anchors = anchorsFor(s);
  change(() => {
    fn(s.object);
    applyAnchors(anchors);
  });
}
function finishTrace() {
  if (Editor.trace.length >= 2) {
    const points = Editor.trace.map((p) => ({ x: p.x, y: p.y }));
    change(() =>
      State.traces.push({
        id: nextId(),
        side: View.drawSide,
        width: Editor.traceWidth * State.pxPerMm,
        points,
      }),
    );
  }
  Editor.trace = [];
  Editor.snap = null;
  updateHint();
  requestRender();
}
function deleteSelected() {
  if (Editor.drag) return;
  const items = selectionItems(canonicalSelection(selectionItems()));
  if (!items.length) return;
  // Higher pad indices are removed first so remaining selections stay valid.
  items.sort((a, b) => (b.index ?? -1) - (a.index ?? -1));
  change(() => {
    for (const s of items) {
      if (s.type === "pad") s.object.pins.splice(s.index, 1);
      else if (s.type === "trace" && s.vertex !== undefined && s.object.points.length > 2)
        s.object.points.splice(s.vertex, 1);
      else {
        const key = { component: "components", trace: "traces", via: "vias", image: "layers" }[
          s.type
        ];
        State[key] = State[key].filter((o) => o.id !== s.object.id);
      }
    }
    Editor.selection = null;
  });
}
function copySelected() {
  if (Editor.drag) return;
  const items = selectionItems(canonicalSelection(selectionItems())).filter(
    (s) => s.type === "component" || s.type === "pad",
  );
  if (!items.length) return;
  const cleanPad = (p) => {
    const copy = structuredClone(p);
    delete copy.netName;
    delete copy.netId;
    return copy;
  };
  const entries = items.map((s) => {
    const c = s.object;
    if (s.type === "pad")
      return {
        type: "pad",
        parentId: c.id,
        data: cleanPad(c.pins[s.index]),
        position: pinWorldPos(c, c.pins[s.index]),
      };
    const data = structuredClone(c);
    delete data.id;
    delete data.netName;
    delete data.netId;
    data.pins = c.pins.map(cleanPad);
    return {
      type: "component",
      data,
      position: { x: c.x, y: c.y },
      prefix: c.ref.replace(/\d+$/, "") || "U",
    };
  });
  const box = bounds(entries.map((entry) => entry.position));
  Editor.clipboard = {
    entries,
    origin: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
  };
}
function pasteClipboard() {
  if (Editor.drag || !Editor.clipboard) return;
  const { entries, origin } = Editor.clipboard;
  const dx = Editor.cursor.x - origin.x,
    dy = Editor.cursor.y - origin.y;
  setTool("select");
  change(() => {
    const items = [];
    for (const entry of entries) {
      const data = structuredClone(entry.data);
      const point = { x: entry.position.x + dx, y: entry.position.y + dy };
      if (entry.type === "component") {
        Object.assign(data, point, { id: nextId(), ref: nextRef(entry.prefix) });
        State.components.push(data);
        items.push({ type: "component", object: data });
      } else {
        const c = State.components.find((c) => c.id === entry.parentId);
        if (!c) continue;
        const q = compWorldToMm(c, point.x, point.y);
        Object.assign(data, { num: nextPinNumber(c), xmm: q.x, ymm: q.y });
        c.pins.push(data);
        items.push({ type: "pad", object: c, index: c.pins.length - 1 });
      }
    }
    Editor.selection = canonicalSelection(items);
  });
}
function runHistory(redoIt) {
  if (Editor.drag) cancelDrag();
  Editor.trace = [];
  Editor.mode = null;
  Editor.padTarget = null;
  Editor.selection = null;
  if (redoIt ? redo() : undo()) afterEdit();
  else requestRender();
}
function canvasPos(event) {
  const r = View.canvas.getBoundingClientRect();
  return { x: event.clientX - r.left, y: event.clientY - r.top };
}
function cancelDrag() {
  const d = Editor.drag;
  if (!d) return;
  if (d.before) {
    State = JSON.parse(d.before);
    Editor.selection = null;
  }
  Editor.drag = null;
  if (d.pointerId !== undefined && View.canvas.hasPointerCapture(d.pointerId))
    View.canvas.releasePointerCapture(d.pointerId);
  updateCursor();
  afterEdit();
}
function updateCursor() {
  View.canvas.style.cursor =
    Editor.drag?.type === "pan"
      ? "grabbing"
      : Editor.space
        ? "grab"
        : Editor.drag?.type === "resize"
          ? Editor.drag.cursor
          : resizeHandleAt(Editor.cursor)?.cursor ||
            (Editor.tool === "select" ? "default" : "crosshair");
}
function pointerDown(e) {
  if (e.button !== 0 && e.button !== 1) return;
  const pos = canvasPos(e),
    p = screenToWorld(pos.x, pos.y);
  Editor.cursor = p;
  View.canvas.focus();
  View.canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
  if (e.button === 1 || Editor.space) {
    Editor.drag = { type: "pan", start: pos, x: View.panX, y: View.panY, pointerId: e.pointerId };
    updateCursor();
    return;
  }
  const handle = resizeHandleAt(p);
  if (handle) {
    const s = Editor.selection,
      o = s.object;
    const pad = s.type === "pad" ? o.pins[s.index] : null;
    const opposite = selectionResizeCorners()[(handle.cornerIndex + 2) % 4];
    Editor.drag = {
      type: "resize",
      selection: s,
      cornerIndex: handle.cornerIndex,
      anchorLocal: compWorldToMm(o, opposite.x, opposite.y),
      original: structuredClone(pad || o.body),
      minimum: pad && through(pad) ? Math.max(0.01, pad.hole + 0.1) : 0.01,
      anchors: pad ? anchorsFor(s) : [],
      before: snapshot(),
      start: p,
      offset: { x: handle.corner.x - p.x, y: handle.corner.y - p.y },
      cursor: handle.cursor,
      pointerId: e.pointerId,
    };
    updateCursor();
    return;
  }
  if (Editor.mode) {
    recordMeasurePoint(p);
    return;
  }
  if (Editor.padTarget) {
    const c = Editor.padTarget,
      q = compWorldToMm(c, p.x, p.y);
    const num = nextPinNumber(c);
    change(() => {
      c.pins.push({
        num,
        name: "",
        xmm: q.x,
        ymm: q.y,
        w: 1.5,
        h: 1.5,
        shape: "rect",
        tht: false,
      });
      Editor.selection = { type: "pad", object: c, index: c.pins.length - 1 };
    });
    Editor.padTarget = null;
    updateHint();
    return;
  }
  if (Editor.tool === "component") {
    const pkg = PACKAGES[Editor.package];
    change(() => {
      const c = makeComponent(pkg.id, componentParams(), p.x, p.y, pkg.prefix);
      c.side = View.drawSide;
      if (Editor.package === "capacitor")
        c.kicad = c.kicad.replace("Resistor_SMD:R_", "Capacitor_SMD:C_");
      State.components.push(c);
    });
    componentPreview();
    return;
  }
  if (Editor.tool === "via") {
    const q = snapPoint(p, true) || p;
    change(() =>
      State.vias.push({
        id: nextId(),
        x: q.x,
        y: q.y,
        r: (Editor.viaDiameter * State.pxPerMm) / 2,
        hole: (Editor.viaHole * State.pxPerMm) / 2,
      }),
    );
    return;
  }
  if (Editor.tool === "trace") {
    if (e.detail > 1) {
      finishTrace();
      return;
    }
    const snap = snapPoint(p),
      q = snap || p,
      last = Editor.trace.at(-1);
    if (!last || Math.hypot(last.x - q.x, last.y - q.y) > 1e-6)
      Editor.trace.push({ x: q.x, y: q.y });
    if (snap && Editor.trace.length > 1) finishTrace();
    else {
      updateHint();
      requestRender();
    }
    return;
  }
  if (Editor.tool === "measure") return;
  const hit = hitTest(p);
  if (!hit) {
    Editor.selection = null;
    Editor.drag = { type: "marquee", start: p, end: p, pointerId: e.pointerId };
    renderInspector();
    requestRender();
    return;
  }
  if (
    !isGroupSelection() ||
    !(
      selectionContains(hit.type, hit.object, hit.index) ||
      (hit.type === "pad" && selectionContains("component", hit.object))
    )
  )
    Editor.selection = hit;
  renderInspector();
  requestRender();
  Editor.drag = {
    type: "object",
    start: p,
    before: snapshot(),
    records: selectionItems().map((s) => ({
      selection: s,
      original: structuredClone(s.object),
      padPosition: s.type === "pad" ? pinWorldPos(s.object, s.object.pins[s.index]) : null,
    })),
    anchors: anchorsFor(Editor.selection),
    moved: false,
    pointerId: e.pointerId,
  };
}
function pointerMove(e) {
  const pos = canvasPos(e),
    p = screenToWorld(pos.x, pos.y);
  Editor.cursor = p;
  document.getElementById("coordinates").textContent =
    (p.x / State.pxPerMm).toFixed(2) + ", " + (p.y / State.pxPerMm).toFixed(2) + " mm";
  const d = Editor.drag;
  if (d?.type === "pan") {
    View.panX = d.x + pos.x - d.start.x;
    View.panY = d.y + pos.y - d.start.y;
    requestRender();
    return;
  }
  if (d?.type === "resize") {
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) * View.zoom < 3) return;
    d.moved = true;
    const s = d.selection,
      pad = s.type === "pad" ? s.object.pins[s.index] : null;
    Object.assign(
      pad || s.object.body,
      resizeGeometry(
        s.object,
        { x: p.x + d.offset.x, y: p.y + d.offset.y },
        d.anchorLocal,
        d.original,
        d.cornerIndex,
        e.shiftKey,
        d.minimum,
      ),
    );
    applyAnchors(d.anchors);
    requestRender();
    return;
  }
  if (d?.type === "marquee") {
    d.end = p;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * View.zoom >= 3) d.moved = true;
    requestRender();
    return;
  }
  if (d?.type === "object") {
    const dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) * View.zoom < 3) return;
    d.moved = true;
    moveSelectionRecords(d.records, dx, dy, p);
    applyAnchors(d.anchors);
    requestRender();
    return;
  }
  Editor.snap = ["trace", "via"].includes(Editor.tool) ? snapPoint(p, Editor.tool === "via") : null;
  updateCursor();
  requestRender();
}
function moveSelectionRecords(records, dx, dy, pointer) {
  for (const record of records) {
    const s = record.selection,
      o = s.object,
      orig = record.original;
    if (s.type === "pad") {
      const q = compWorldToMm(o, record.padPosition.x + dx, record.padPosition.y + dy);
      o.pins[s.index].xmm = q.x;
      o.pins[s.index].ymm = q.y;
    } else if (s.type === "trace") {
      if (s.vertex !== undefined) {
        const q = snapPoint(pointer, false, o) || pointer;
        o.points[s.vertex] = { x: q.x, y: q.y };
      } else o.points = orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else if (s.type === "image") {
      o.tx = orig.tx + dx;
      o.ty = orig.ty + dy;
    } else {
      o.x = orig.x + dx;
      o.y = orig.y + dy;
    }
  }
}
function pointerUp(e) {
  const d = Editor.drag;
  Editor.drag = null;
  if (View.canvas.hasPointerCapture(e.pointerId)) View.canvas.releasePointerCapture(e.pointerId);
  if (d?.type === "marquee") {
    Editor.selection = d.moved ? marqueeSelection(d.start, d.end) : null;
    renderInspector();
    requestRender();
  }
  if (d?.before) {
    remember(d.before);
    afterEdit();
  }
  updateCursor();
}
function insertTraceVertex(e) {
  if (Editor.tool !== "select" || Editor.mode) return;
  const p0 = canvasPos(e),
    p = screenToWorld(p0.x, p0.y),
    hit = hitTest(p);
  if (resizeHandleAt(p)) return;
  if (hit?.type !== "trace") return;
  const t = hit.object;
  let best = null;
  for (let i = 1; i < t.points.length; i++) {
    const q = projectOnSeg(p.x, p.y, t.points[i - 1], t.points[i]);
    if (!best || q.d < best.d) best = { ...q, i };
  }
  if (best && t.points.every((p) => Math.hypot(p.x - best.x, p.y - best.y) > 1 / View.zoom))
    change(() => {
      t.points.splice(best.i, 0, { x: best.x, y: best.y });
      Editor.selection = { type: "trace", object: t, vertex: best.i };
    });
}
function startMeasure(kind) {
  if (kind === "align" && !["front", "back"].every((s) => State.layers.some((l) => l.side === s))) {
    notify("Add both photographs before aligning them.", true);
    return;
  }
  Editor.selection = null;
  Editor.mode =
    kind === "align"
      ? { kind, target: [], source: [], previousSide: View.side }
      : { kind, points: [] };
  if (kind === "align") {
    setView("front");
    fitBoard();
  }
  renderInspector();
  updateHint();
  requestRender();
}
function recordMeasurePoint(p) {
  const m = Editor.mode;
  if (m.kind === "align") {
    if (m.target.length < 2) {
      m.target.push(p);
      if (m.target.length === 2) {
        setView("back");
        fitBoard();
      }
    } else if (m.source.length < 2)
      m.source.push(
        worldToImage(
          State.layers.find((l) => l.side === "back"),
          p,
        ),
      );
  } else if (m.points.length < 2) m.points.push(p);
  renderInspector();
  updateHint();
  requestRender();
}
function updateHint() {
  let text = {
    select: "Drag empty space to select · Ctrl/Cmd+C copy · Ctrl/Cmd+V paste · Space + drag to pan",
    component: "Choose a package, then click to place · Escape returns to Select",
    trace: "Click pads or copper to trace · Click to add corners · Enter finishes · Escape cancels",
    via: "Click to place a via connecting front and back copper",
    measure: "Choose Measure, Set scale or Align photos in the properties panel",
  }[Editor.tool];
  if (Editor.padTarget) text = "Click on the photograph to add a pad to " + Editor.padTarget.ref;
  if (Editor.mode) {
    const m = Editor.mode;
    text =
      m.kind === "align"
        ? m.target.length < 2
          ? "FRONT: click reference point " + (m.target.length + 1) + " of 2"
          : m.source.length < 2
            ? "BACK: click the SAME reference point " + (m.source.length + 1) + " of 2"
            : "Review the points, then apply alignment"
        : m.points.length < 2
          ? "Click point " + (m.points.length + 1) + " of 2 on the photograph"
          : "Read the measurement or enter the known distance in the properties panel";
  }
  document.getElementById("canvas-hint").textContent = text;
}
function wireCanvas() {
  View.canvas = document.getElementById("canvas");
  View.ctx = View.canvas.getContext("2d");
  View.canvas.addEventListener("pointerdown", pointerDown);
  View.canvas.addEventListener("pointermove", pointerMove);
  View.canvas.addEventListener("pointerup", pointerUp);
  View.canvas.addEventListener("pointercancel", cancelDrag);
  View.canvas.addEventListener("dblclick", insertTraceVertex);
  View.canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = canvasPos(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.001));
    },
    { passive: false },
  );
  View.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  new ResizeObserver(resizeCanvas).observe(document.getElementById("board"));
}
