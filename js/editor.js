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
  Editor.preview = {
    id: 0,
    ref: nextRef(pkg.prefix),
    value: "",
    body: fp.body,
    pins: fp.pins,
    footprint: fp.label,
    kicad: fp.kicad,
    rot: 0,
    scale: 1,
    side: View.drawSide,
  };
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
function anchorsFor(selection) {
  const locations = [];
  const o = selection.object;
  if (selection.type === "component")
    o.pins.forEach((p) =>
      locations.push({
        before: pinWorldPos(o, p),
        after: () => pinWorldPos(o, p),
        side: through(p) ? null : o.side,
      }),
    );
  if (selection.type === "pad") {
    const p = o.pins[selection.index];
    locations.push({
      before: pinWorldPos(o, p),
      after: () => pinWorldPos(o, p),
      side: through(p) ? null : o.side,
    });
  }
  if (selection.type === "via") locations.push({ before: { x: o.x, y: o.y }, after: () => o });
  const anchors = [];
  for (const t of State.traces)
    for (const point of t.points)
      for (const loc of locations)
        if (
          (!loc.side || loc.side === t.side) &&
          Math.hypot(point.x - loc.before.x, point.y - loc.before.y) < 1e-5
        )
          anchors.push({ point, after: loc.after });
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
  const s = Editor.selection;
  if (!s) return;
  change(() => {
    if (s.type === "pad") s.object.pins.splice(s.index, 1);
    else if (s.type === "trace" && s.vertex !== undefined && s.object.points.length > 2)
      s.object.points.splice(s.vertex, 1);
    else {
      const key = { component: "components", trace: "traces", via: "vias", image: "layers" }[
        s.type
      ];
      State[key] = State[key].filter((o) => o.id !== s.object.id);
    }
    Editor.selection = null;
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
  afterEdit();
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
    Editor.drag = { type: "pan", start: pos, x: View.panX, y: View.panY };
    return;
  }
  if (Editor.mode) {
    recordMeasurePoint(p);
    return;
  }
  if (Editor.padTarget) {
    const c = Editor.padTarget,
      q = compWorldToMm(c, p.x, p.y);
    let n = 1;
    while (c.pins.some((p) => p.num === String(n))) n++;
    change(() => {
      c.pins.push({
        num: String(n),
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
  Editor.selection = hit;
  renderInspector();
  requestRender();
  if (!hit) return;
  Editor.drag = {
    type: "object",
    start: p,
    before: snapshot(),
    original: structuredClone(hit.object),
    selection: hit,
    anchors: anchorsFor(hit),
    moved: false,
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
  if (d?.type === "object") {
    const dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) * View.zoom < 3) return;
    d.moved = true;
    const s = d.selection,
      o = s.object,
      orig = d.original;
    if (s.type === "pad") {
      const q = compWorldToMm(o, p.x, p.y);
      o.pins[s.index].xmm = q.x;
      o.pins[s.index].ymm = q.y;
    } else if (s.type === "trace") {
      if (s.vertex !== undefined) {
        const q = snapPoint(p, false, o) || p;
        o.points[s.vertex] = { x: q.x, y: q.y };
      } else o.points = orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else if (s.type === "image") {
      o.tx = orig.tx + dx;
      o.ty = orig.ty + dy;
    } else {
      o.x = orig.x + dx;
      o.y = orig.y + dy;
    }
    applyAnchors(d.anchors);
    requestRender();
    return;
  }
  Editor.snap = ["trace", "via"].includes(Editor.tool) ? snapPoint(p, Editor.tool === "via") : null;
  requestRender();
}
function pointerUp(e) {
  const d = Editor.drag;
  Editor.drag = null;
  if (View.canvas.hasPointerCapture(e.pointerId)) View.canvas.releasePointerCapture(e.pointerId);
  if (d?.before) {
    remember(d.before);
    afterEdit();
  }
}
function insertTraceVertex(e) {
  if (Editor.tool !== "select" || Editor.mode) return;
  const p0 = canvasPos(e),
    p = screenToWorld(p0.x, p0.y),
    hit = hitTest(p);
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
    select: "Select an object to inspect it · Scroll to zoom · Space + drag to pan",
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
