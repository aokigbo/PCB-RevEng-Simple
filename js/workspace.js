"use strict";

const $ = (id) => document.getElementById(id);
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(parent, text, fn, cls) {
  const b = el("button", text, cls);
  b.addEventListener("click", fn);
  parent.append(b);
  return b;
}
function field(parent, label, value, onChange, options = {}) {
  const wrap = el("label", undefined, "field");
  wrap.append(el("span", label));
  const input = el(options.choices ? "select" : "input");
  input.setAttribute("aria-label", label);
  if (options.choices)
    for (const choice of options.choices) {
      const [v, name] = Array.isArray(choice) ? choice : [choice, choice];
      const o = el("option", name);
      o.value = v;
      input.append(o);
    }
  else {
    input.type = options.type || "text";
    if (input.type === "number") {
      input.step = options.step || "any";
      if (options.min !== undefined) input.min = options.min;
      if (options.max !== undefined) input.max = options.max;
    }
  }
  input.value = value ?? "";
  input.addEventListener("input", () => {
    Editor.fieldDirty = true;
    refreshSaveState();
  });
  input.addEventListener("change", () => {
    Editor.fieldDirty = false;
    let v = input.value;
    if (input.type === "number") {
      v = Number(v);
      if (
        !input.value.trim() ||
        !input.checkValidity() ||
        !Number.isFinite(v) ||
        v < (options.min ?? -Infinity) ||
        v > (options.max ?? Infinity) ||
        (options.integer && !Number.isInteger(v))
      ) {
        input.value = value;
        refreshSaveState();
        notify("Enter a valid " + label.toLowerCase() + ".", true);
        return;
      }
    }
    onChange(v);
  });
  wrap.append(input);
  parent.append(wrap);
  return input;
}
function checkbox(parent, label, value, fn) {
  const wrap = el("label"),
    input = el("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => fn(input.checked));
  wrap.append(input, document.createTextNode(" " + label));
  parent.append(wrap);
}
function paragraph(parent, text, cls = "hint") {
  parent.append(el("p", text, cls));
}
function numeric(parent, label, value, fn, min = 0.001, max = 100000) {
  return field(parent, label, Number(value.toFixed(4)), fn, { type: "number", min, max });
}
let toastTimer;
function notify(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  $("toast").classList.toggle("error", error);
  toastTimer = setTimeout(
    () => {
      $("toast").hidden = true;
    },
    error ? 12000 : 4500,
  );
}
function refreshSaveState() {
  const dirty = isDirty() || Editor.fieldDirty;
  $("save-state").textContent = ProjectFile.busy ? "Working…" : dirty ? "Unsaved" : "Saved";
  $("save-state").classList.toggle("saved", !dirty && !ProjectFile.busy);
  if (document.activeElement !== $("project-name")) $("project-name").value = State.name;
  document.title = (dirty ? "• " : "") + State.name + " — PCB RevEng Simple";
  for (const id of ["new", "open", "save", "save-as"])
    $(id).disabled =
      ProjectFile.busy || (["open", "save", "save-as"].includes(id) && !fileAccessAvailable());
  $("undo").disabled = !History.past.length;
  $("redo").disabled = !History.future.length;
}
function syncPhotoControls() {
  for (const side of ["front", "back"]) {
    const l = State.layers.find((l) => l.side === side),
      input = $(side + "-opacity");
    input.disabled = !l;
    if (l) input.value = l.opacity;
  }
}
function netInspector(panel, key) {
  const net = Connectivity.byKey.get(key);
  if (!net) return;
  panel.append(el("h3", "Connectivity"));
  paragraph(
    panel,
    net.conflict
      ? "Review these conflicting names in the AI package."
      : net.members.length + " connected copper object" + (net.members.length === 1 ? "" : "s"),
  );
  field(panel, "Net name", net.names.length === 1 ? net.names[0] : "", (name) =>
    change(() => nameNet(key, name)),
  ).placeholder = net.name;
  if (net.names.length > 1)
    paragraph(panel, "Conflicting names: " + net.names.join(" / "), "warning");
  const pads = net.members.filter((m) => m.type === "pad").map((m) => m.c.ref + "." + m.p.num);
  paragraph(panel, pads.length ? "Pads: " + pads.join(", ") : "No component pads connected yet.");
}
function setupInspector(panel) {
  panel.append(el("h2", "Board setup"));
  paragraph(panel, "Photographs first. Copper next.");
  for (const side of ["front", "back"]) {
    const l = State.layers.find((l) => l.side === side);
    if (l)
      button(
        panel,
        (side === "front" ? "Front" : "Back") + " · " + l.name,
        () => {
          Editor.selection = { type: "image", object: l };
          setView(side);
          renderInspector();
          requestRender();
        },
        "block-button",
      );
    else button(panel, "Add " + side + " photo", () => choosePhoto(side), "block-button");
  }
  panel.append(el("h3", "Next steps"));
  const steps = [
    [!!State.layers.length, "Add board photographs"],
    [State.calibrated, "Set the image scale"],
    [!!State.components.length, "Place components and pads"],
    [!!State.traces.length, "Trace copper and add vias"],
  ];
  steps.forEach(([done, text], i) => {
    const row = el("div", undefined, "step" + (done ? " done" : ""));
    row.append(el("b", done ? "✓" : String(i + 1)), el("span", text));
    panel.append(row);
  });
  button(
    panel,
    State.calibrated ? "Measure / align photos" : "Set scale / align photos",
    () => setTool("measure"),
    "block-button",
  );
  const stats = el("div", undefined, "stats");
  stats.append(
    el("span", State.components.length + " parts"),
    el("span", Connectivity.nets.length + " nets"),
  );
  panel.append(stats);
}
function componentToolInspector(panel) {
  panel.append(el("h2", "Place component"));
  paragraph(
    panel,
    "Choose a package, then click the board. Use Select to edit its reference, value and pads.",
  );
  field(
    panel,
    "Component",
    Editor.package,
    (v) => {
      Editor.package = v;
      Editor.params = {};
      componentPreview();
      renderInspector();
    },
    { choices: Object.entries(PACKAGES).map(([k, p]) => [k, p.label]) },
  );
  if (["smd", "tht", "custom"].includes(Editor.package)) {
    const params = componentParams();
    for (const [key, label] of [
      ["w", "Body width (mm)"],
      ["h", "Body height (mm)"],
    ])
      numeric(
        panel,
        label,
        params[key],
        (v) => {
          Editor.params[key] = v;
          componentPreview();
        },
        0.1,
        1000,
      );
    if (Editor.package !== "custom") {
      field(
        panel,
        "Pads",
        params.count,
        (v) => {
          Editor.params.count = v;
          componentPreview();
        },
        { type: "number", min: 1, max: 100, integer: true },
      );
      numeric(
        panel,
        "Pad pitch (mm)",
        params.pitch,
        (v) => {
          Editor.params.pitch = v;
          componentPreview();
        },
        0.1,
        100,
      );
    } else
      paragraph(
        panel,
        "After placing the body, select it and choose Add pad. Each pad can be moved and resized directly.",
      );
  } else {
    const def = getFootprintDef(PACKAGES[Editor.package].id);
    for (const prm of def.params) {
      if (prm.type === "bool") continue;
      const value = Editor.params[prm.key] ?? prm.def;
      field(
        panel,
        prm.label,
        value,
        (v) => {
          Editor.params[prm.key] = v;
          componentPreview();
        },
        {
          choices: prm.type === "select" ? prm.options : undefined,
          type: prm.type === "int" ? "number" : "text",
          integer: prm.type === "int",
          min: prm.min,
          max: prm.max,
          step: prm.step,
        },
      );
    }
  }
  if (!State.calibrated)
    paragraph(
      panel,
      "Set the photograph scale with Measure before matching packages to the board.",
      "warning",
    );
}
function measureInspector(panel) {
  panel.append(el("h2", "Measure & align"));
  const m = Editor.mode;
  if (!m) {
    paragraph(
      panel,
      State.calibrated
        ? "Scale: " + State.pxPerMm.toFixed(3) + " pixels per mm"
        : "Set the scale using a known distance, such as connector pin spacing.",
    );
    const stack = el("div", undefined, "stack");
    panel.append(stack);
    button(stack, "Set scale · two points", () => startMeasure("calibrate"));
    button(stack, "Measure a distance", () => startMeasure("measure"));
    button(stack, "Align front & back", () => startMeasure("align"));
    paragraph(
      panel,
      "Align before placing copper. For the back photo, match the same two physical landmarks in the same order. A back photograph is mirrored on import.",
    );
    return;
  }
  if (m.kind === "align") {
    paragraph(
      panel,
      "1. Pick two landmarks on the front.\n2. Pick those same landmarks on the back.",
    );
    paragraph(
      panel,
      "Front: " + m.target.length + "/2 points · Back: " + m.source.length + "/2 points",
    );
    if (m.source.length === 2)
      button(
        panel,
        "Apply alignment",
        () => {
          const l = State.layers.find((l) => l.side === "back");
          if (!change(() => alignImage(l, m.source, m.target))) return;
          Editor.mode = null;
          setView("both");
          fitBoard();
          renderInspector();
          updateHint();
        },
        "primary",
      );
  } else if (m.points.length === 2) {
    const distance = Math.hypot(m.points[1].x - m.points[0].x, m.points[1].y - m.points[0].y);
    paragraph(panel, (distance / State.pxPerMm).toFixed(3) + " mm", "pill");
    if (m.kind === "calibrate") {
      const input = numeric(panel, "Known distance (mm)", 10, () => {}, 0.001, 100000);
      paragraph(
        panel,
        "Changing scale updates package sizes and physical measurements. Set this before tracing.",
      );
      button(
        panel,
        "Apply scale",
        () => {
          const mm = Number(input.value);
          if (!Number.isFinite(mm) || mm <= 0 || distance < 2) {
            notify("Choose distinct points and a positive distance.", true);
            return;
          }
          const scale = distance / mm;
          if (scale < 0.0001 || scale > 1e6) {
            notify("That scale is outside the supported range. Check the distance.", true);
            return;
          }
          change(() => {
            State.pxPerMm = scale;
            State.calibrated = true;
          });
          Editor.mode = null;
          renderInspector();
          updateHint();
        },
        "primary",
      );
    }
  } else paragraph(panel, "Click two points on the photograph.");
  button(panel, "Cancel", () => {
    const prev = m.previousSide;
    Editor.mode = null;
    if (prev) setView(prev);
    renderInspector();
    updateHint();
    requestRender();
  });
}
function selectionInspector(panel, s) {
  const o = s.object,
    ppm = State.pxPerMm;
  if (s.type === "image") {
    panel.append(el("h2", o.side === "front" ? "Front photograph" : "Back photograph"));
    paragraph(panel, o.name);
    numeric(
      panel,
      "Rotation (degrees)",
      o.rot,
      (v) => modifySelected((o) => (o.rot = v)),
      -36000,
      36000,
    );
    numeric(
      panel,
      "Image scale",
      o.scale,
      (v) => modifySelected((o) => (o.scale = v)),
      0.0001,
      10000,
    );
    const row = el("div", undefined, "row");
    panel.append(row);
    numeric(row, "X (mm)", o.tx / ppm, (v) => modifySelected((o) => (o.tx = v * ppm)), -1e6, 1e6);
    numeric(row, "Y (mm)", o.ty / ppm, (v) => modifySelected((o) => (o.ty = v * ppm)), -1e6, 1e6);
    checkbox(panel, "Mirror horizontally", o.mirror, (v) =>
      modifySelected((o) => {
        const center = imageToWorld(o, { x: o.width / 2, y: o.height / 2 });
        o.mirror = v;
        const after = imageToWorld(o, { x: o.width / 2, y: o.height / 2 });
        o.tx += center.x - after.x;
        o.ty += center.y - after.y;
      }),
    );
    paragraph(
      panel,
      "Drag the photograph to position it. Photo adjustments leave copper annotations in place; align before tracing.",
    );
    button(panel, "Replace photo", () => choosePhoto(o.side));
    button(panel, "Measure / align", () => setTool("measure"));
  } else if (s.type === "component") {
    panel.append(el("h2", "Component"));
    field(panel, "Reference", o.ref, (v) =>
      modifySelected((o) => {
        v = v.trim();
        if (!v || State.components.some((c) => c !== o && c.ref.toUpperCase() === v.toUpperCase()))
          throw new Error("Use a unique component reference.");
        o.ref = v;
      }),
    );
    field(panel, "Value", o.value, (v) => modifySelected((o) => (o.value = v)));
    paragraph(panel, o.footprint, "pill");
    field(panel, "Side", o.side, (v) => modifySelected((o) => (o.side = v)), {
      choices: [
        ["front", "Front"],
        ["back", "Back"],
      ],
    });
    numeric(
      panel,
      "Rotation (degrees)",
      o.rot,
      (v) => modifySelected((o) => (o.rot = v)),
      -36000,
      36000,
    );
    numeric(
      panel,
      "Body width (mm)",
      o.body.w,
      (v) =>
        modifySelected((o) => {
          o.body.w = v;
          if (o.body.shape === "circle") o.body.h = v;
        }),
      0.01,
      10000,
    );
    numeric(
      panel,
      "Body height (mm)",
      o.body.h,
      (v) =>
        modifySelected((o) => {
          o.body.h = v;
          if (o.body.shape === "circle") o.body.w = v;
        }),
      0.01,
      10000,
    );
    panel.append(el("h3", "Datasheet"));
    const datasheet = State.attachments.find((a) => a.id === o.datasheetId);
    if (datasheet) {
      const size =
        datasheet.size >= 1048576
          ? (datasheet.size / 1048576).toFixed(1) + " MB"
          : datasheet.size >= 1024
            ? (datasheet.size / 1024).toFixed(1) + " KB"
            : datasheet.size + " bytes";
      paragraph(panel, datasheet.name + " · " + size);
      const actions = el("div", undefined, "row");
      panel.append(actions);
      button(actions, "Open", () => openDatasheet(o));
      button(actions, "Replace", () => chooseDatasheet(o));
      button(actions, "Remove", () => removeDatasheet(o));
    } else button(panel, "Attach PDF", () => chooseDatasheet(o));
    panel.append(el("h3", "Pads"));
    o.pins.forEach((p, index) => {
      const row = el("div", undefined, "pad-row");
      button(row, "Pad " + p.num, () => {
        Editor.selection = { type: "pad", object: o, index };
        renderInspector();
        requestRender();
      });
      row.append(el("span", Connectivity.byKey.get(pinKey(o, p))?.name || ""));
      panel.append(row);
    });
    button(panel, "Add pad", () => {
      Editor.padTarget = o;
      updateHint();
      notify("Click the board to place a new pad on " + o.ref);
    });
    paragraph(
      panel,
      "Drag the body to move it. Drag a corner to resize; the opposite corner stays fixed. Hold Shift to preserve its ratio. Select a pad to edit it separately.",
    );
  } else if (s.type === "pad") {
    const p = o.pins[s.index];
    panel.append(el("h2", o.ref + " · Pad " + p.num));
    button(
      panel,
      "← Component " + o.ref,
      () => {
        Editor.selection = { type: "component", object: o };
        renderInspector();
        requestRender();
      },
      "block-button",
    );
    field(panel, "Pin number", p.num, (v) =>
      modifySelected(() => {
        v = v.trim();
        if (!v || o.pins.some((other) => other !== p && other.num === v))
          throw new Error("Pin numbers must be unique within a component.");
        p.num = v;
      }),
    );
    field(panel, "Pin name", p.name, (v) => modifySelected(() => (p.name = v)));
    field(
      panel,
      "Pad type",
      through(p) ? "tht" : p.shape,
      (v) =>
        modifySelected(() => {
          p.shape = v === "rect" ? "rect" : "circle";
          p.tht = v === "tht";
          if (p.shape === "circle") p.h = p.w;
          if (p.tht) p.hole = Math.min(p.hole || 0.6, p.w * 0.8);
          else delete p.hole;
        }),
      {
        choices: [
          ["rect", "SMD · rectangular"],
          ["circle", "SMD · round"],
          ["tht", "Through-hole · round"],
        ],
      },
    );
    const row = el("div", undefined, "row");
    panel.append(row);
    numeric(row, "X (mm)", p.xmm, (v) => modifySelected(() => (p.xmm = v)), -10000, 10000);
    numeric(row, "Y (mm)", p.ymm, (v) => modifySelected(() => (p.ymm = v)), -10000, 10000);
    numeric(
      panel,
      p.shape === "circle" ? "Diameter (mm)" : "Width (mm)",
      p.w,
      (v) =>
        modifySelected(() => {
          if (p.hole && v < p.hole) throw new Error("Pad diameter must be greater than the hole.");
          p.w = v;
          if (p.shape === "circle") p.h = v;
        }),
      0.01,
      10000,
    );
    if (p.shape !== "circle")
      numeric(panel, "Height (mm)", p.h, (v) => modifySelected(() => (p.h = v)), 0.01, 10000);
    if (through(p))
      numeric(
        panel,
        "Hole diameter (mm)",
        p.hole,
        (v) => modifySelected(() => (p.hole = v)),
        0.01,
        p.w,
      );
    netInspector(panel, pinKey(o, p));
    paragraph(
      panel,
      "Drag the pad to move it. Drag a corner to resize; the opposite corner stays fixed. Hold Shift to preserve its ratio.",
    );
  } else if (s.type === "trace") {
    panel.append(el("h2", "Trace"));
    field(panel, "Layer", o.side, (v) => modifySelected((o) => (o.side = v)), {
      choices: [
        ["front", "Front"],
        ["back", "Back"],
      ],
    });
    numeric(
      panel,
      "Width (mm)",
      o.width / ppm,
      (v) => modifySelected((o) => (o.width = v * ppm)),
      0.01,
      1000,
    );
    netInspector(panel, "t" + o.id);
    paragraph(
      panel,
      "Drag a square to move a corner. Double-click a segment to add a corner. Delete removes a selected corner or trace.",
    );
  } else if (s.type === "via") {
    panel.append(el("h2", "Via"));
    paragraph(panel, "Connects front and back copper.");
    numeric(
      panel,
      "Diameter (mm)",
      (o.r * 2) / ppm,
      (v) =>
        modifySelected((o) => {
          if ((v * ppm) / 2 <= o.hole) throw new Error("Diameter must exceed the hole.");
          o.r = (v * ppm) / 2;
        }),
      0.01,
      1000,
    );
    numeric(
      panel,
      "Hole (mm)",
      (o.hole * 2) / ppm,
      (v) => modifySelected((o) => (o.hole = (v * ppm) / 2)),
      0.01,
      (o.r * 2) / ppm - 0.001,
    );
    netInspector(panel, "v" + o.id);
  }
  panel.append(el("hr", undefined, "panel-rule"));
  button(
    panel,
    s.type === "trace" && s.vertex !== undefined ? "Delete selected corner" : "Delete " + s.type,
    deleteSelected,
    "danger",
  );
}
function renderInspector() {
  const panel = $("inspector");
  panel.replaceChildren();
  if (isGroupSelection()) {
    const items = selectionItems();
    panel.append(el("h2", items.length + " items selected"));
    for (const type of ["component", "pad"]) {
      const n = items.filter((s) => s.type === type).length;
      if (n) paragraph(panel, n + " " + type + (n === 1 ? "" : "s"));
    }
  } else if (Editor.selection) selectionInspector(panel, Editor.selection);
  else if (Editor.tool === "component") componentToolInspector(panel);
  else if (Editor.tool === "measure") measureInspector(panel);
  else if (Editor.tool === "trace") {
    panel.append(el("h2", "Draw trace"));
    paragraph(
      panel,
      "Click a pad, via or trace to start. Add corners with clicks, then click another conductor or press Enter to finish.",
    );
    numeric(
      panel,
      "Width (mm)",
      Editor.traceWidth,
      (v) => {
        Editor.traceWidth = v;
        requestRender();
      },
      0.01,
      1000,
    );
    if (Editor.trace.length) button(panel, "Finish trace", finishTrace);
  } else if (Editor.tool === "via") {
    panel.append(el("h2", "Place via"));
    paragraph(panel, "Click a trace or pad to connect copper between front and back.");
    numeric(
      panel,
      "Diameter (mm)",
      Editor.viaDiameter,
      (v) => {
        if (v <= Editor.viaHole) {
          notify("Diameter must exceed the hole.", true);
          renderInspector();
          return;
        }
        Editor.viaDiameter = v;
      },
      0.01,
      1000,
    );
    numeric(
      panel,
      "Hole (mm)",
      Editor.viaHole,
      (v) => (Editor.viaHole = v),
      0.01,
      Editor.viaDiameter - 0.001,
    );
  } else setupInspector(panel);
  if (Connectivity.issues.length) {
    panel.append(el("h3", "Connectivity warnings"));
    for (const issue of Connectivity.issues.slice(0, 8)) paragraph(panel, issue, "warning");
  }
}
let importSide = "front",
  documentEpoch = 0;
function choosePhoto(side) {
  importSide = side;
  $("photo-input").value = "";
  $("photo-input").click();
}
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read photograph."));
    reader.readAsDataURL(file);
  });
}
async function importPhoto(file, side) {
  const epoch = documentEpoch;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error("Use a PNG, JPEG or WebP photograph.");
    const dataURL = await readPhoto(file),
      img = await decodePhoto(dataURL);
    if (epoch !== documentEpoch) return;
    const assetId = assetSequence++;
    ImageAssets.set(assetId, { dataURL, img });
    change(() => {
      const existing = State.layers.find((l) => l.side === side);
      const l = {
        id: existing?.id || nextId(),
        side,
        name: file.name,
        assetId,
        width: img.naturalWidth,
        height: img.naturalHeight,
        tx: ((side === "back" ? 1 : -1) * img.naturalWidth) / 2,
        ty: -img.naturalHeight / 2,
        scale: 1,
        rot: 0,
        mirror: side === "back",
        opacity: side === "back" ? 0.6 : 1,
      };
      if (existing) State.layers.splice(State.layers.indexOf(existing), 1, l);
      else State.layers.push(l);
      Editor.selection = { type: "image", object: l };
    });
    setView(side);
    fitBoard();
    notify("Added " + side + " photograph. Set scale, then align before tracing.");
  } catch (err) {
    notify(err.message, true);
  }
}
function resetWorkspace() {
  documentEpoch++;
  Editor.fieldDirty = false;
  Editor.clipboard = null;
  Editor.drag = null;
  Editor.trace = [];
  Editor.mode = null;
  Editor.selection = null;
  Editor.padTarget = null;
  Editor.snap = null;
  setTool("select");
  setView("front");
  afterEdit();
  fitBoard();
}
function prepareSave(saveAs) {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement) active.blur();
  if (Editor.trace.length >= 2) finishTrace();
  return saveProject(saveAs);
}
function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    const input = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName),
      cmd = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    if (cmd && ["n", "o", "s"].includes(key)) {
      e.preventDefault();
      if (input) e.target.blur();
      if (key === "s") prepareSave(e.shiftKey);
      else if (key === "o") requestOpen();
      else newProject();
      return;
    }
    if (input) return;
    if (cmd && (key === "c" || key === "v")) {
      e.preventDefault();
      if (key === "c") copySelected();
      else pasteClipboard();
      return;
    }
    if (cmd && (key === "z" || key === "y")) {
      e.preventDefault();
      runHistory(key === "y" || e.shiftKey);
      return;
    }
    if (cmd || e.altKey) return;
    if (e.key === " ") {
      e.preventDefault();
      Editor.space = true;
      View.canvas.style.cursor = "grab";
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setTool("select");
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
    }
    if (e.key === "Enter" && Editor.tool === "trace") finishTrace();
    const tool = { v: "select", c: "component", t: "trace", b: "via", m: "measure" }[key];
    if (tool) setTool(tool);
    if (key === "f") fitBoard();
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      Editor.space = false;
      updateCursor();
    }
  });
  window.addEventListener("blur", () => {
    Editor.space = false;
    if (Editor.drag) cancelDrag();
  });
  window.addEventListener("beforeunload", (e) => {
    if (hasPendingWork() || ProjectFile.busy) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
document.addEventListener("DOMContentLoaded", () => {
  wireCanvas();
  wireKeyboard();
  $("new").onclick = newProject;
  $("open").onclick = requestOpen;
  $("save").onclick = () => prepareSave(false);
  $("save-as").onclick = () => prepareSave(true);
  $("undo").onclick = () => runHistory(false);
  $("redo").onclick = () => runHistory(true);
  $("fit").onclick = fitBoard;
  $("project-name").oninput = () => {
    Editor.fieldDirty = true;
    refreshSaveState();
  };
  $("project-name").onchange = (e) => {
    Editor.fieldDirty = false;
    change(() => {
      const name = e.target.value.trim();
      if (!name) throw new Error("Enter a project name.");
      State.name = name;
    });
  };
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  document
    .querySelectorAll("[data-import]")
    .forEach((b) => (b.onclick = () => choosePhoto(b.dataset.import)));
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $("draw-side").onchange = (e) => {
    if (Editor.trace.length) finishTrace();
    View.drawSide = e.target.value;
    if (View.side !== "both") setView(View.drawSide);
    requestRender();
  };
  for (const side of ["front", "back"]) {
    const input = $(side + "-opacity");
    input.oninput = () => {
      Editor.fieldDirty = true;
      refreshSaveState();
    };
    input.onchange = () => {
      Editor.fieldDirty = false;
      const l = State.layers.find((l) => l.side === side);
      if (l) change(() => (l.opacity = Number(input.value)));
    };
  }
  for (const key of ["components", "traces", "vias"])
    $("show-" + key).onchange = (e) => {
      View[key] = e.target.checked;
      Editor.selection = null;
      renderInspector();
      requestRender();
    };
  $("grid").onchange = (e) => {
    View.grid = e.target.checked;
    requestRender();
  };
  $("photo-input").onchange = (e) => {
    if (e.target.files[0]) importPhoto(e.target.files[0], importSide);
  };
  for (const kind of ["bom", "ai"])
    $("export-" + kind).onclick = () => {
      if (Editor.trace.length >= 2) finishTrace();
      exportFile(kind);
      $("export-menu").open = false;
    };
  document.addEventListener("click", (e) =>
    document.querySelectorAll("details[open]").forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    }),
  );
  $("browser-notice").hidden = fileAccessAvailable();
  resizeCanvas();
  resetWorkspace();
});
