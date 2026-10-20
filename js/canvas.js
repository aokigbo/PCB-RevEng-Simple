"use strict";

const View = {
  canvas: null,
  ctx: null,
  width: 1,
  height: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  activeLayerId: 1,
  primaryByLayer: new Map(),
  comparisonId: null,
  blend: 0.5,
  drawingOpacity: 1,
  grid: false,
  components: true,
  traces: true,
  vias: true,
};
const Editor = {
  tool: "select",
  selection: null,
  cursor: { x: 0, y: 0 },
  trace: [],
  traceWidth: 5,
  viaDiameter: 10,
  viaHole: 5,
  drag: null,
  space: false,
  mode: null,
  padTarget: null,
  snap: null,
  package: "resistor",
  params: {},
  preview: null,
  fieldDirty: false,
  clipboard: null,
};
function worldToScreen(x, y) {
  return { x: x * View.zoom + View.panX, y: y * View.zoom + View.panY };
}
function screenToWorld(x, y) {
  return { x: (x - View.panX) / View.zoom, y: (y - View.panY) / View.zoom };
}
function layerVisible(id) {
  return View.activeLayerId === id;
}
function padVisible(c, p) {
  return View.components && layerVisible(c.layerId);
}
function selectedKey() {
  const s = Editor.selection;
  if (!s || s.type === "group") return null;
  return s.type === "pad"
    ? pinKey(s.object, s.object.pins[s.index])
    : s.type === "trace"
      ? "t" + s.object.id
      : s.type === "via"
        ? "v" + s.object.id
        : null;
}
function netColor(key, side) {
  const net = Connectivity.byKey.get(key),
    chosen = Connectivity.byKey.get(selectedKey());
  if (net?.conflict) return "#ff8d75";
  if (chosen && net === chosen) return "#ffe291";
  return ["#eea888", "#78b9ff", "#b6d584", "#ce9feb"][
    Math.max(
      0,
      State.physicalLayers.findIndex((l) => l.id === side),
    ) % 4
  ];
}
let renderPending = false;
function requestRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderCanvas();
  });
}
function resizeCanvas() {
  const r = View.canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  const oldW = View.width,
    oldH = View.height;
  View.width = r.width;
  View.height = r.height;
  View.panX += (View.width - oldW) / 2;
  View.panY += (View.height - oldH) / 2;
  View.canvas.width = Math.round(r.width * dpr);
  View.canvas.height = Math.round(r.height * dpr);
  requestRender();
}
function zoomAt(sx, sy, factor) {
  const p = screenToWorld(sx, sy);
  View.zoom = Math.max(0.000001, Math.min(64, View.zoom * factor));
  View.panX = sx - p.x * View.zoom;
  View.panY = sy - p.y * View.zoom;
  requestRender();
}
function fitBoard() {
  const points = [];
  for (const l of visibleScans())
    for (const p of [
      { x: 0, y: 0 },
      { x: l.width, y: 0 },
      { x: 0, y: l.height },
      { x: l.width, y: l.height },
    ])
      points.push(imageToWorld(l, p));
  for (const c of State.components) {
    if (!layerVisible(c.layerId)) continue;
    const r = compRadius(c);
    points.push({ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
  }
  for (const t of State.traces) if (layerVisible(t.layerId)) points.push(...t.points);
  for (const v of State.vias)
    if (viaOnLayer(v, View.activeLayerId))
      points.push({ x: v.x - v.r, y: v.y - v.r }, { x: v.x + v.r, y: v.y + v.r });
  if (points.length) {
    const b = bounds(points);
    View.zoom = Math.max(
      0.000001,
      Math.min(
        8,
        (View.width - 100) / Math.max(1, b.maxX - b.minX),
        (View.height - 100) / Math.max(1, b.maxY - b.minY),
      ),
    );
    View.panX = View.width / 2 - ((b.minX + b.maxX) / 2) * View.zoom;
    View.panY = View.height / 2 - ((b.minY + b.maxY) / 2) * View.zoom;
  } else {
    View.zoom = 1;
    View.panX = View.width / 2;
    View.panY = View.height / 2;
  }
  requestRender();
}
function pathTrace(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}
function pinDisplayLabel(pin) {
  return pin.name?.trim() ? pin.name.trim() + " | " + pin.num : pin.num;
}
function renderComponent(ctx, c, ghost = false) {
  const selected = selectionContains("component", c);
  const active = !isGroupSelection() && Editor.selection?.object === c;
  const scale = 1;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate((c.rot * Math.PI) / 180);
  ctx.scale(scale, scale);
  if (layerVisible(c.layerId)) {
    ctx.strokeStyle = selected ? "#baf5df" : "#b7ccdbaa";
    ctx.fillStyle = selected ? "#42635640" : "#1b283940";
    ctx.lineWidth = 1.2 / View.zoom / scale;
    ctx.beginPath();
    if (c.body.shape === "circle")
      ctx.ellipse(c.body.x || 0, c.body.y || 0, c.body.w / 2, c.body.h / 2, 0, 0, Math.PI * 2);
    else
      ctx.rect((c.body.x || 0) - c.body.w / 2, (c.body.y || 0) - c.body.h / 2, c.body.w, c.body.h);
    ctx.fill();
    ctx.stroke();
  }
  c.pins.forEach((p, i) => {
    if (!padVisible(c, p) && !ghost) return;
    const chosen = selectionContains("pad", c, i) || selected;
    ctx.fillStyle = ghost ? "#87dabe99" : netColor(pinKey(c, p), c.layerId);
    ctx.strokeStyle = chosen ? "#e1fff5" : "#27333d";
    ctx.lineWidth = (chosen ? 2 : 0.7) / View.zoom / scale;
    ctx.beginPath();
    if (p.shape === "circle") ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
    else ctx.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    ctx.fill();
    ctx.stroke();
    if (hasDrill(p)) {
      ctx.fillStyle = "#111820";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.hole / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
  if (layerVisible(c.layerId)) {
    const box = compBoxHalf(c);
    ctx.font = 12 / View.zoom + "px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = selected ? "#d9ffef" : "#deebf3";
    ctx.fillText(c.ref, c.x, c.y - box.hy - 8 / View.zoom);
  }
  if (active)
    for (const p of c.pins) {
      if (!padVisible(c, p)) continue;
      const q = pinWorldPos(c, p);
      ctx.font = 10 / View.zoom + "px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.fillText(pinDisplayLabel(p), q.x, q.y - (p.h * scale) / 2 - 4 / View.zoom);
    }
}
function renderCanvas() {
  if (!View.ctx) return;
  const ctx = View.ctx,
    dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, View.width, View.height);
  ctx.save();
  ctx.translate(View.panX, View.panY);
  ctx.scale(View.zoom, View.zoom);
  const contributions = imageContributions(visibleScans(), View.blend),
    requested = planTileRequests(contributions),
    viewToken = JSON.stringify([
      View.zoom,
      View.panX,
      View.panY,
      ...contributions.map(({ scan }) => [scan.id, scan.transform, scan.flipX, scan.flipY]),
    ]);
  Tiles.view(requested, viewToken);
  for (const { scan, alpha } of contributions)
    renderScanTiles(ctx, scan, alpha, visibleTileSpecs(scan));
  const loading = document.getElementById("image-loading");
  if (loading)
    loading.textContent = [...Tiles.wanted.values()].some(
      (s) =>
        s.priority === 0 &&
        !Tiles.unavailable.has(s.scanId) &&
        !Tiles.cache.entries.has(s.key) &&
        !Tiles.failed.has(s.key),
    )
      ? "Loading detail…"
      : "";
  if (View.grid) {
    const step = State.calibration?.boardUnitsPerMm || 100,
      tl = screenToWorld(0, 0),
      br = screenToWorld(View.width, View.height);
    if (step * View.zoom >= 8) {
      ctx.fillStyle = "#b0c5d440";
      for (let x = Math.ceil(tl.x / step) * step; x < br.x; x += step)
        for (let y = Math.ceil(tl.y / step) * step; y < br.y; y += step)
          ctx.fillRect(x, y, 1 / View.zoom, 1 / View.zoom);
    }
  }
  ctx.save();
  ctx.globalAlpha = View.drawingOpacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (View.traces)
    for (const t of State.traces) {
      if (!layerVisible(t.layerId)) continue;
      const selected = Editor.selection?.object === t;
      pathTrace(ctx, t.points);
      ctx.lineWidth = t.width;
      ctx.strokeStyle = netColor("t" + t.id, t.layerId);
      ctx.stroke();
      if (selected) {
        pathTrace(ctx, t.points);
        ctx.lineWidth = 1 / View.zoom;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        t.points.forEach((p, i) => {
          ctx.fillStyle = Editor.selection.vertex === i ? "#fff" : "#99e7cc";
          ctx.fillRect(p.x - 3 / View.zoom, p.y - 3 / View.zoom, 6 / View.zoom, 6 / View.zoom);
        });
      }
    }
  if (View.components) for (const c of State.components) renderComponent(ctx, c);
  if (View.vias)
    for (const v of State.vias) {
      if (!viaOnLayer(v, View.activeLayerId)) continue;
      ctx.fillStyle = netColor("v" + v.id, View.activeLayerId);
      ctx.beginPath();
      ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#101820";
      ctx.beginPath();
      ctx.arc(v.x, v.y, v.hole, 0, Math.PI * 2);
      ctx.fill();
      if (Editor.selection?.object === v) {
        ctx.strokeStyle = "#e1fff5";
        ctx.lineWidth = 2 / View.zoom;
        ctx.beginPath();
        ctx.arc(v.x, v.y, v.r + 3 / View.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  ctx.restore();
  if (Editor.drag?.type === "marquee" && Editor.drag.moved) {
    const box = bounds([Editor.drag.start, Editor.drag.end]);
    ctx.fillStyle = "#baf5df10";
    ctx.strokeStyle = "#baf5df";
    ctx.lineWidth = 1 / View.zoom;
    ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  }
  const corners = selectionResizeCorners();
  if (corners.length) {
    ctx.strokeStyle = "#baf5df";
    ctx.fillStyle = "#e1fff5";
    ctx.lineWidth = 1 / View.zoom;
    pathTrace(ctx, corners);
    ctx.closePath();
    ctx.stroke();
    const size = 7 / View.zoom;
    for (const p of corners) ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  }
  if (Editor.tool === "component" && Editor.preview) {
    ctx.globalAlpha = 0.7;
    renderComponent(
      ctx,
      { ...Editor.preview, x: Editor.cursor.x, y: Editor.cursor.y, layerId: View.activeLayerId },
      true,
    );
    ctx.globalAlpha = 1;
  }
  if (Editor.trace.length) {
    const p = Editor.snap || Editor.cursor;
    pathTrace(ctx, [...Editor.trace, p]);
    ctx.strokeStyle = "#b2edcd";
    ctx.lineWidth = Editor.traceWidth * 1;
    ctx.stroke();
  }
  if (Editor.snap) {
    ctx.strokeStyle = "#fff5b2";
    ctx.lineWidth = 1.5 / View.zoom;
    ctx.beginPath();
    ctx.arc(Editor.snap.x, Editor.snap.y, 7 / View.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }
  const mode = Editor.mode;
  if (mode) {
    const points =
      mode.kind === "align"
        ? mode.phase === "reference"
          ? mode.referencePoints
          : mode.sourcePoints.map((p) =>
              imageToWorld(
                State.scans.find((s) => s.id === mode.targetId),
                p,
              ),
            )
        : mode.points;
    ctx.strokeStyle = "#b4ffe3";
    ctx.fillStyle = "#d6ffef";
    ctx.lineWidth = 1.5 / View.zoom;
    ctx.font = 13 / View.zoom + "px system-ui";
    ctx.textAlign = "left";
    if (points.length === 2) {
      pathTrace(ctx, points);
      ctx.stroke();
    }
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 / View.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(String(i + 1), p.x + 9 / View.zoom, p.y - 9 / View.zoom);
    });
  }
  ctx.restore();
  document.getElementById("zoom").textContent = Math.round(View.zoom * 100) + "%";
}
function selectionResizeCorners() {
  const s = Editor.selection;
  if (Editor.tool !== "select" || Editor.mode || Editor.padTarget || !View.components || !s)
    return [];
  if (s.type === "component" && layerVisible(s.object.layerId)) return bodyCornersWorld(s.object);
  if (s.type === "pad" && padVisible(s.object, s.object.pins[s.index]))
    return padCornersWorld(s.object, s.object.pins[s.index]);
  return [];
}
function resizeHandleAt(p) {
  const corners = selectionResizeCorners();
  if (!corners.length) return null;
  const center = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
  let nearest = null,
    cornerIndex = -1,
    distance = 7 / View.zoom;
  for (const [index, corner] of corners.entries()) {
    const d = Math.hypot(p.x - corner.x, p.y - corner.y);
    if (d < distance) {
      distance = d;
      nearest = corner;
      cornerIndex = index;
    }
  }
  // Keep the centre available for moving pads whose handles overlap at low zoom.
  if (!nearest || Math.hypot(p.x - center.x, p.y - center.y) < distance) return null;
  return {
    corner: nearest,
    cornerIndex,
    cursor: (nearest.x - center.x) * (nearest.y - center.y) >= 0 ? "nwse-resize" : "nesw-resize",
  };
}
function hitTest(p) {
  const tol = 5 / View.zoom,
    s = Editor.selection;
  if (s?.type === "trace" && View.traces && layerVisible(s.object.layerId))
    for (let i = 0; i < s.object.points.length; i++)
      if (Math.hypot(p.x - s.object.points[i].x, p.y - s.object.points[i].y) < 7 / View.zoom)
        return { type: "trace", object: s.object, vertex: i };
  if (View.vias)
    for (const v of [...State.vias].reverse())
      if (viaOnLayer(v, View.activeLayerId) && Math.hypot(p.x - v.x, p.y - v.y) <= v.r + tol)
        return { type: "via", object: v };
  if (View.components)
    for (const c of [...State.components].reverse())
      for (let i = 0; i < c.pins.length; i++)
        if (padVisible(c, c.pins[i]) && pinEdgeDist(c, c.pins[i], p.x, p.y) < tol)
          return { type: "pad", object: c, index: i };
  if (View.traces)
    for (const t of [...State.traces].reverse())
      if (layerVisible(t.layerId))
        for (let i = 1; i < t.points.length; i++)
          if (distToSeg(p.x, p.y, t.points[i - 1], t.points[i]) <= t.width / 2 + tol)
            return { type: "trace", object: t };
  if (View.components)
    for (const c of [...State.components].reverse())
      if (layerVisible(c.layerId) && pointInComp(c, p.x, p.y))
        return { type: "component", object: c };
  return null;
}
function snapPoint(p, anySide = false, excludeTrace = null) {
  let best = null,
    dist = 9 / View.zoom;
  const take = (q) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < dist) {
      dist = d;
      best = q;
    }
  };
  for (const c of State.components)
    for (const pad of c.pins)
      if (c.layerId === View.activeLayerId) {
        const wp = pinWorldPos(c, pad);
        if (pinEdgeDist(c, pad, p.x, p.y) === 0) return wp;
        take(wp);
      }
  for (const v of State.vias) if (viaOnLayer(v, View.activeLayerId)) take(v);
  if (!best)
    for (const t of State.traces)
      if (t !== excludeTrace && t.layerId === View.activeLayerId)
        for (let i = 1; i < t.points.length; i++) {
          const q = projectOnSeg(p.x, p.y, t.points[i - 1], t.points[i]);
          if (q.d < dist) {
            dist = q.d;
            best = q;
          }
        }
  return best ? { x: best.x, y: best.y } : null;
}
