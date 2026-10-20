"use strict";

function validatePadArraySettings(c, s) {
  if (
    !Number.isInteger(s.rows) ||
    !Number.isInteger(s.columns) ||
    s.rows < 1 ||
    s.columns < 1 ||
    s.rows * s.columns + c.pins.length > 2000
  )
    throw new Error("Use positive rows and columns, up to 2,000 total component pins.");
  if (!["row", "column", "serpentine", "dip"].includes(s.numbering))
    throw new Error("Choose an array numbering mode.");
  if (s.numbering === "dip" && s.columns !== 2)
    throw new Error("Around perimeter / DIP numbering needs exactly two columns.");
  if (
    !Number.isSafeInteger(s.startPin) ||
    !Number.isSafeInteger(s.increment) ||
    !s.increment ||
    !Number.isSafeInteger(s.startPin + (s.rows * s.columns - 1) * s.increment)
  )
    throw new Error("Start pin and increment must be whole numbers; increment cannot be zero.");
  if (
    !["rect", "circle"].includes(s.shape) ||
    ![s.w, s.h].every((v) => Number.isFinite(v) && v > 0 && v <= 1e7)
  )
    throw new Error("Use positive pad dimensions.");
  if (!["surface", "through"].includes(s.physicalType))
    throw new Error("Choose a physical pin type.");
  if (s.physicalType === "through") {
    const ids = State.physicalLayers.map((l) => l.id);
    if (!ids.includes(s.fromLayerId) || !ids.includes(s.toLayerId) || s.fromLayerId === s.toLayerId)
      throw new Error("Through-board pins must span at least two physical layers.");
    if (
      !Number.isFinite(s.diameter) ||
      s.diameter <= 0 ||
      s.diameter > 1e7 ||
      !Number.isFinite(s.hole) ||
      s.hole < 0 ||
      s.hole >= s.diameter
    )
      throw new Error("The hole must be smaller than the positive outer diameter.");
  }
}
function generatePadArray(c, s, start, end) {
  validatePadArraySettings(c, s);
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite))
    throw new Error("Invalid array bounds.");
  if (
    (s.columns > 1 && Math.abs(end.x - start.x) < 1e-6) ||
    (s.rows > 1 && Math.abs(end.y - start.y) < 1e-6)
  )
    throw new Error("Drag between the first and last pin centers to set the spacing.");
  const pads = [],
    used = new Set(c.pins.map((p) => p.num));
  for (let row = 0; row < s.rows; row++)
    for (let col = 0; col < s.columns; col++) {
      const serial =
        s.numbering === "column"
          ? col * s.rows + row
          : s.numbering === "dip"
            ? col === 0
              ? row
              : 2 * s.rows - 1 - row
            : row * s.columns +
              (s.numbering === "serpentine" && row % 2 ? s.columns - 1 - col : col);
      const num = String(s.startPin + serial * s.increment);
      if (used.has(num))
        throw new Error("Pin " + num + " already exists. Choose a different start or increment.");
      used.add(num);
      const p = {
        num,
        name: "",
        x: start.x + (col * (end.x - start.x)) / Math.max(1, s.columns - 1),
        y: start.y + (row * (end.y - start.y)) / Math.max(1, s.rows - 1),
        w: s.w,
        h: s.shape === "circle" ? s.w : s.h,
        shape: s.shape,
        tht: false,
      };
      if (s.physicalType === "through")
        p.barrel = {
          fromLayerId: s.fromLayerId,
          toLayerId: s.toLayerId,
          diameter: s.diameter,
          hole: s.hole,
        };
      pads.push(p);
    }
  return pads;
}
function startPadArray(c) {
  if (ProjectFile.busy || !ProjectFile.root) return;
  setTool("select");
  const max = Math.max(0, ...c.pins.map((p) => Number(p.num)).filter(Number.isSafeInteger));
  Editor.mode = {
    kind: "pad-array",
    component: c,
    preview: [],
    start: null,
    end: null,
    settings: {
      rows: 24,
      columns: 2,
      numbering: "dip",
      startPin: max + 1,
      increment: 1,
      physicalType: "surface",
      shape: "rect",
      w: 15,
      h: 15,
      diameter: 15,
      hole: 6,
      fromLayerId: State.physicalLayers[0].id,
      toLayerId: State.physicalLayers.at(-1).id,
    },
  };
  renderInspector();
  updateHint();
  updateCursor();
  requestRender();
}
function updateArrayPreview(m) {
  m.preview = [];
  m.error = "";
  try {
    validatePadArraySettings(m.component, m.settings);
    if (m.start && m.end) m.preview = generatePadArray(m.component, m.settings, m.start, m.end);
  } catch (e) {
    m.error = e.message;
  }
  const button = document.getElementById("place-pad-array");
  if (button) button.disabled = !m.preview.length || ProjectFile.busy;
  const status = document.getElementById("pad-array-status");
  if (status)
    status.textContent =
      m.error ||
      (m.preview.length
        ? m.preview.length + " pins ready · Enter to place"
        : "Drag between the first and last pin centers.");
  if (m.preview.length)
    hud(m.settings.columns + " × " + m.settings.rows + "\n" + m.preview.length + " pins");
  requestRender();
}
function commitPadArray() {
  const m = Editor.mode;
  if (m?.kind !== "pad-array" || Editor.drag || ProjectFile.busy || !ProjectFile.root) return;
  try {
    if (!m.start || !m.end) throw new Error("Drag on the component to preview the array first.");
    const pads = generatePadArray(m.component, m.settings, m.start, m.end);
    if (!State.components.includes(m.component))
      throw new Error("The array's component is no longer available.");
    change(() => {
      m.component.pins.push(...pads);
      Editor.mode = null;
      Editor.selection = { type: "component", object: m.component };
    });
  } catch (e) {
    notify(e.message, true);
  }
}
function renderPadArrayPreview(ctx, m) {
  if (!m.start || !m.end) return;
  ctx.save();
  ctx.translate(m.component.x, m.component.y);
  ctx.rotate((m.component.rot * Math.PI) / 180);
  ctx.lineWidth = 1 / View.zoom;
  ctx.strokeStyle = "#baf5df";
  ctx.fillStyle = "#87dabe99";
  const end = {
    x: m.settings.columns === 1 ? m.start.x : m.end.x,
    y: m.settings.rows === 1 ? m.start.y : m.end.y,
  };
  ctx.strokeRect(m.start.x, m.start.y, end.x - m.start.x, end.y - m.start.y);
  for (const p of m.preview) {
    for (const shape of pinCopperShapes(m.component, p)) {
      ctx.beginPath();
      if (shape.shape === "circle") ctx.arc(shape.x, shape.y, shape.w / 2, 0, Math.PI * 2);
      else ctx.rect(shape.x - shape.w / 2, shape.y - shape.h / 2, shape.w, shape.h);
      ctx.fill();
      ctx.stroke();
      if (hasDrill(shape)) {
        ctx.save();
        ctx.fillStyle = "#111820";
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, shape.hole / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.font = 11 / View.zoom + "px system-ui";
    ctx.textAlign = "center";
    ctx.save();
    ctx.fillStyle = "#fff";
    if (m.settings.numbering === "dip") {
      const left = Math.abs(p.x - m.start.x) < 1e-8,
        direction = (left ? -1 : 1) * (m.end.x >= m.start.x ? 1 : -1);
      ctx.textAlign = direction < 0 ? "right" : "left";
      ctx.fillText(
        p.num,
        p.x + direction * (Math.max(p.w, p.barrel?.diameter || 0) / 2 + 5 / View.zoom),
        p.y + 4 / View.zoom,
      );
    } else
      ctx.fillText(p.num, p.x, p.y - Math.max(p.h, p.barrel?.diameter || 0) / 2 - 4 / View.zoom);
    ctx.restore();
  }
  ctx.restore();
}
