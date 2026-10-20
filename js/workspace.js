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
    refreshSaveState();
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
  $("save-state").textContent = ProjectFile.busy
    ? "Working…"
    : !ProjectFile.root
      ? "Choose project folder"
      : dirty
        ? "Unsaved"
        : "Saved";
  if (document.activeElement !== $("project-name")) $("project-name").value = State.name;
  document.title = (dirty ? "• " : "") + State.name + " — PCB RevEng Simple";
  for (const id of ["new", "open", "import-project", "save"])
    $(id).disabled =
      ProjectFile.busy || !fileAccessAvailable() || (id === "save" && !ProjectFile.root);
  $("undo").disabled = ProjectFile.busy || !History.past.length;
  $("redo").disabled = ProjectFile.busy || !History.future.length;
  $("project-name").disabled = !ProjectFile.root || ProjectFile.busy;
  document
    .querySelectorAll("#layer-stack .add-image, #layer-stack .block-button")
    .forEach((b) => (b.disabled = !ProjectFile.root || ProjectFile.busy));
  document
    .querySelectorAll("#layer-stack .layer-row")
    .forEach((row) => (row.draggable = !!ProjectFile.root && !ProjectFile.busy));
}
function showImportProgress(text, visible) {
  $("import-progress").hidden = !visible;
  $("import-progress-text").textContent = text;
}
let hudTimer;
function hud(text) {
  $("view-hud").textContent = text;
  $("view-hud").hidden = false;
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => ($("view-hud").hidden = true), 1800);
}
function normalizeView() {
  if (!State.physicalLayers.some((l) => l.id === View.activeLayerId))
    View.activeLayerId = State.physicalLayers[0].id;
  for (const l of State.physicalLayers) {
    const scans = State.scans.filter((s) => s.layerId === l.id);
    if (!scans.some((s) => s.id === View.primaryByLayer.get(l.id)))
      View.primaryByLayer.set(l.id, scans[0]?.id ?? null);
  }
  if (
    !State.scans.some((s) => s.id === View.comparisonId) ||
    View.comparisonId === View.primaryByLayer.get(View.activeLayerId)
  )
    View.comparisonId = null;
}
function activateLayer(id) {
  if (!State.physicalLayers.some((l) => l.id === id)) return;
  if (Editor.drag) cancelDrag();
  Editor.trace = [];
  Editor.selection = null;
  Editor.mode = null;
  Editor.padTarget = null;
  Editor.snap = null;
  if (id !== View.activeLayerId) View.comparisonId = null;
  View.activeLayerId = id;
  normalizeView();
  renderLayers();
  renderInspector();
  syncViewControls();
  updateHint();
  requestRender();
  hud(
    "Layer " +
      (State.physicalLayers.findIndex((l) => l.id === id) + 1) +
      " / " +
      State.physicalLayers.length +
      "\n" +
      layerName(id, true),
  );
}
function setPrimaryScan(id) {
  const scan = State.scans.find((s) => s.id === id && s.layerId === View.activeLayerId);
  View.primaryByLayer.set(View.activeLayerId, scan?.id ?? null);
  if (View.comparisonId === id) View.comparisonId = null;
  syncViewControls();
  renderLayers();
  requestRender();
  if (scan) {
    const list = State.scans.filter((s) => s.layerId === scan.layerId);
    hud(
      layerName(scan.layerId) +
        " · " +
        scan.name +
        "\n" +
        (list.indexOf(scan) + 1) +
        " / " +
        list.length,
    );
  }
}
function cycleLayer(delta) {
  const i = State.physicalLayers.findIndex((l) => l.id === View.activeLayerId);
  activateLayer(
    State.physicalLayers[Math.max(0, Math.min(State.physicalLayers.length - 1, i + delta))].id,
  );
}
function cycleScan(delta) {
  if (Editor.mode) return;
  const scans = State.scans.filter((s) => s.layerId === View.activeLayerId);
  if (!scans.length) return;
  const i = scans.findIndex((s) => s.id === View.primaryByLayer.get(View.activeLayerId));
  setPrimaryScan(scans[(i + delta + scans.length) % scans.length].id);
}
function adjustBlend(delta) {
  if (View.comparisonId === null) return;
  View.blend = Math.max(0, Math.min(1, Math.round((View.blend + delta) * 100) / 100));
  syncViewControls();
  requestRender();
  hud("Image blend\n" + Math.round(View.blend * 100) + "%");
}
function adjustDrawing(delta) {
  View.drawingOpacity = Math.max(
    0,
    Math.min(1, Math.round((View.drawingOpacity + delta) * 100) / 100),
  );
  syncViewControls();
  requestRender();
  hud("Drawing\n" + Math.round(View.drawingOpacity * 100) + "%");
}
function visibleScans() {
  const m = Editor.mode;
  if (m?.kind === "align") {
    const ref = State.scans.find((s) => s.id === m.referenceId),
      target = State.scans.find((s) => s.id === m.targetId);
    if (m.phase === "reference") return ref ? [ref] : [];
    if (m.phase === "target") return target ? [target] : [];
    return ref && target ? [ref, { ...target, transform: m.fit.transform }] : [];
  }
  const primary = State.scans.find(
      (s) =>
        s.id === View.primaryByLayer.get(View.activeLayerId) && s.layerId === View.activeLayerId,
    ),
    comparison = State.scans.find((s) => s.id === View.comparisonId);
  return primary
    ? [primary, ...(comparison && comparison.id !== primary.id ? [comparison] : [])]
    : [];
}
function defaultViaEnd() {
  const layers = State.physicalLayers,
    i = layers.findIndex((l) => l.id === View.activeLayerId);
  return (layers[i + 1] || layers[i - 1])?.id;
}
function formatDistance(value) {
  return (
    (value / (State.calibration?.boardUnitsPerMm || 1)).toFixed(2) +
    (State.calibration ? " mm" : " u")
  );
}
function dimension(parent, label, value, fn, min = 0.001, max = 1e10) {
  const factor = State.calibration?.boardUnitsPerMm || 1;
  return numeric(
    parent,
    label + (State.calibration ? " (mm)" : " (units)"),
    value / factor,
    (v) => fn(v * factor),
    min / factor,
    max / factor,
  );
}
function layerChoices() {
  return State.physicalLayers.map((l) => [String(l.id), layerName(l.id, true)]);
}
function syncViewControls() {
  normalizeView();
  const primary = $("primary-scan"),
    compare = $("comparison-scan");
  primary.replaceChildren();
  compare.replaceChildren();
  const option = (node, value, text) => {
    const o = el("option", text);
    o.value = value;
    node.append(o);
  };
  option(primary, "", "No scan");
  for (const s of State.scans.filter((s) => s.layerId === View.activeLayerId))
    option(primary, s.id, s.name);
  primary.value = View.primaryByLayer.get(View.activeLayerId) ?? "";
  option(compare, "", "None");
  for (const s of State.scans)
    if (s.id !== View.primaryByLayer.get(View.activeLayerId))
      option(compare, s.id, layerName(s.layerId) + " / " + s.name);
  compare.value = View.comparisonId ?? "";
  compare.disabled = !View.primaryByLayer.get(View.activeLayerId);
  $("blend").disabled = View.comparisonId === null;
  $("blend").value = View.blend;
  $("drawing-opacity").value = View.drawingOpacity;
}
function inspect(type, object) {
  Editor.mode = null;
  Editor.selection = { type, object };
  renderInspector();
  requestRender();
}
function renderLayers() {
  const panel = $("layer-stack");
  panel.replaceChildren();
  panel.append(el("h2", "Physical layers"));
  for (const l of State.physicalLayers) {
    const group = el(
        "div",
        undefined,
        "layer-group" + (l.id === View.activeLayerId ? " active" : ""),
      ),
      row = el("div", undefined, "layer-row");
    row.draggable = !!ProjectFile.root && !ProjectFile.busy;
    row.dataset.layerId = l.id;
    button(row, layerName(l.id, true), () => activateLayer(l.id), "layer-name");
    button(row, "⋯", () => inspect("physicalLayer", l), "layer-menu").setAttribute(
      "aria-label",
      "Properties " + layerName(l.id),
    );
    row.ondragstart = (e) => e.dataTransfer.setData("text/plain", String(l.id));
    row.ondragover = (e) => e.preventDefault();
    row.ondrop = (e) => {
      e.preventDefault();
      if (ProjectFile.busy) return;
      const from = Number(e.dataTransfer.getData("text/plain"));
      if (from === l.id) return;
      const ids = State.physicalLayers.map((x) => x.id).filter((id) => id !== from),
        index = ids.indexOf(l.id);
      if (index < 0) return;
      ids.splice(index, 0, from);
      try {
        reorderLayers(ids, (n) =>
          confirm(
            "Reordering changes the physical span of " +
              n +
              " vias and may change connectivity. Reorder layers?",
          ),
        );
        afterEdit();
      } catch (error) {
        notify(error.message, true);
      }
    };
    group.append(row);
    for (const s of State.scans.filter((s) => s.layerId === l.id)) {
      const scanRow = el(
        "div",
        undefined,
        "scan-row" + (View.primaryByLayer.get(l.id) === s.id ? " primary" : ""),
      );
      button(
        scanRow,
        (View.comparisonId === s.id ? "⇄ " : "") + s.name,
        () => {
          if (View.activeLayerId !== l.id) activateLayer(l.id);
          setPrimaryScan(s.id);
        },
        "scan-name",
      );
      button(scanRow, "⋯", () => inspect("scan", s), "scan-menu").setAttribute(
        "aria-label",
        "Properties scan " + s.name,
      );
      group.append(scanRow);
    }
    button(group, "+ Add image", () => chooseScan(l.id), "add-image").disabled =
      !ProjectFile.root || ProjectFile.busy;
    panel.append(group);
  }
  button(
    panel,
    "+ Add layer",
    () => change(() => State.physicalLayers.push({ id: nextId(), description: "" })),
    "block-button",
  ).disabled = !ProjectFile.root || ProjectFile.busy;
}
let importLayerId = 1;
function chooseScan(id) {
  importLayerId = id;
  $("scan-input").value = "";
  $("scan-input").click();
}
function netInspector(panel, key) {
  const net = Connectivity.byKey.get(key);
  if (!net) return;
  panel.append(el("h3", "Connectivity"));
  paragraph(panel, net.members.length + " connected copper objects");
  field(panel, "Net name", net.names.length === 1 ? net.names[0] : "", (v) =>
    change(() => nameNet(key, v)),
  ).placeholder = net.name;
  paragraph(
    panel,
    "Pads: " +
      net.members
        .filter((m) => m.type === "pad")
        .map((m) => m.c.ref + "." + m.p.num + " (" + layerName(m.c.layerId) + ")")
        .join(", "),
  );
}
function datasheetInspector(panel, c) {
  panel.append(el("h3", "Datasheet"));
  const a = State.attachments.find((a) => a.id === c.datasheetId);
  if (!a) {
    button(panel, "Attach PDF", () => chooseDatasheet(c));
    return;
  }
  paragraph(panel, a.name + " · " + (a.size / 1048576).toFixed(1) + " MB");
  const row = el("div", undefined, "row");
  panel.append(row);
  button(row, "Open PDF", () => openDatasheet(c));
  button(row, "Replace", () => chooseDatasheet(c));
  button(row, "Remove", () => removeDatasheet(c));
}
function componentToolInspector(panel) {
  panel.append(el("h2", "Place component"));
  field(
    panel,
    "Package",
    Editor.package,
    (v) => {
      Editor.package = v;
      Editor.params = {};
      componentPreview();
      renderInspector();
    },
    { choices: Object.entries(PACKAGES).map(([key, p]) => [key, p.label]) },
  );
  const generic = ["custom", "smd", "tht"].includes(Editor.package),
    params = componentParams();
  if (generic) {
    for (const [key, label] of [
      ["w", "Body width"],
      ["h", "Body height"],
      ["pitch", "Pad pitch"],
    ]) {
      if (key === "pitch" && Editor.package === "custom") continue;
      numeric(
        panel,
        label + " (units)",
        params[key] * 10,
        (v) => {
          Editor.params[key] = v / 10;
          componentPreview();
        },
        0.01,
        1e8,
      );
    }
    if (Editor.package !== "custom")
      field(
        panel,
        "Pads",
        params.count,
        (v) => {
          Editor.params.count = Number(v);
          componentPreview();
        },
        { type: "number", min: 1, max: 100, integer: true },
      );
  } else
    for (const prm of getFootprintDef(PACKAGES[Editor.package].id).params) {
      if (prm.type === "bool") continue;
      field(
        panel,
        prm.label.replace(/ mm/g, ""),
        Editor.params[prm.key] ?? prm.def,
        (v) => {
          Editor.params[prm.key] = prm.type === "int" ? Number(v) : v;
          componentPreview();
        },
        {
          choices: prm.type === "select" ? prm.options : undefined,
          type: prm.type === "int" ? "number" : "text",
          min: prm.min,
          max: prm.max,
          integer: prm.type === "int",
        },
      );
    }
  paragraph(
    panel,
    "Click to place on " +
      layerName(View.activeLayerId) +
      ". Catalog proportions are a starting point; resize the body and pads directly.",
  );
}
function beginAlignment(target, referenceId, count) {
  if (!referenceId || referenceId === target.id) return;
  if (View.activeLayerId !== target.layerId) activateLayer(target.layerId);
  setPrimaryScan(target.id);
  Editor.selection = null;
  Editor.tool = "measure";
  Editor.mode = {
    kind: "align",
    targetId: target.id,
    referenceId,
    count,
    phase: "reference",
    referencePoints: [],
    sourcePoints: [],
  };
  renderInspector();
  updateHint();
  requestRender();
}
function alignmentInspector(panel, m) {
  panel.append(el("h2", "Align scans"));
  const ref = State.scans.find((s) => s.id === m.referenceId),
    target = State.scans.find((s) => s.id === m.targetId);
  paragraph(panel, "Reference: " + ref.name + "\nTarget: " + target.name);
  if (m.phase === "reference") {
    paragraph(panel, "Reference points: " + m.referencePoints.length + " / " + m.count);
    button(panel, "Pick target landmarks", () => {
      m.phase = "target";
      renderInspector();
      updateHint();
      requestRender();
    }).disabled = m.referencePoints.length !== m.count;
  } else if (m.phase === "target")
    paragraph(panel, "Target points: " + m.sourcePoints.length + " / " + m.count);
  else {
    paragraph(panel, "Preview · RMS error " + formatDistance(m.fit.rms));
    button(
      panel,
      "Apply alignment",
      () => {
        const transform = m.fit.transform;
        Editor.mode = null;
        change(() => {
          target.transform = transform;
          target.aligned = true;
        });
      },
      "primary",
    );
  }
  button(panel, "Redo points", () => {
    m.phase = "reference";
    m.referencePoints = [];
    m.sourcePoints = [];
    delete m.fit;
    renderInspector();
    updateHint();
    requestRender();
  });
  button(panel, "Cancel alignment", () => {
    Editor.mode = null;
    renderInspector();
    updateHint();
    requestRender();
  });
}
function scanInspector(panel, s) {
  panel.append(el("h2", "Scan"));
  field(panel, "Scan name", s.name, (v) => change(() => (s.name = v)));
  paragraph(panel, layerName(s.layerId, true) + " · " + s.width + " × " + s.height + " px");
  paragraph(panel, s.aligned ? "Alignment confirmed" : "Check / align this scan");
  for (const [key, label] of [
    ["tx", "Image X"],
    ["ty", "Image Y"],
    ["scale", "Image scale"],
    ["rotation", "Image rotation"],
  ])
    numeric(
      panel,
      label,
      s.transform[key],
      (v) =>
        change(() => {
          s.transform[key] = v;
          s.aligned = false;
        }),
      key === "scale" ? 1e-9 : -1e10,
      1e10,
    );
  for (const [axis, label] of [
    ["flipX", "Flip horizontally"],
    ["flipY", "Flip vertically"],
  ])
    button(panel, label, () => {
      if (confirm(label + "? Check or realign this scan afterward."))
        change(() => flipScan(s, axis));
    });
  const others = State.scans.filter((o) => o.id !== s.id);
  if (others.length) {
    let ref = others[0].id,
      count = 3;
    field(panel, "Alignment reference", String(ref), (v) => (ref = Number(v)), {
      choices: others.map((o) => [String(o.id), layerName(o.layerId) + " / " + o.name]),
    });
    field(panel, "Landmark pairs", "3", (v) => (count = Number(v)), { choices: ["3", "4", "5"] });
    button(panel, "Align to reference", () => beginAlignment(s, ref, count));
  }
  if (s.assetMode === "tiff-source")
    button(panel, "Clear Derived Image Cache", () => clearDerivedImageCache(s));
  button(
    panel,
    "Delete scan",
    () => {
      if (confirm("Delete scan “" + s.name + "”? Reconstructed copper is retained.")) {
        Editor.selection = null;
        change(() => (State.scans = State.scans.filter((o) => o.id !== s.id)));
      }
    },
    "danger",
  );
}
function selectionInspector(panel, s) {
  const o = s.object;
  if (s.type === "scan") {
    scanInspector(panel, o);
    return;
  }
  if (s.type === "physicalLayer") {
    panel.append(el("h2", layerName(o.id, true)));
    field(panel, "Layer description", o.description, (v) => change(() => (o.description = v)));
    button(
      panel,
      "Delete physical layer",
      () => {
        if (ProjectFile.busy || !ProjectFile.root) return;
        const counts = ["components", "traces", "scans"]
          .map((key) => State[key].filter((x) => x.layerId === o.id).length + " " + key)
          .join(", ");
        if (
          !confirm(
            "Delete " +
              layerName(o.id, true) +
              "? This deletes " +
              counts +
              " and adjusts or removes affected vias.",
          )
        )
          return;
        try {
          deletePhysicalLayer(o.id);
          Editor.selection = null;
          afterEdit();
        } catch (e) {
          notify(e.message, true);
        }
      },
      "danger",
    );
    return;
  }
  if (s.type === "component") {
    panel.append(el("h2", "Component"));
    field(panel, "Reference", o.ref, (v) =>
      modifySelected((c) => {
        v = v.trim();
        if (!v || State.components.some((x) => x !== c && x.ref.toUpperCase() === v.toUpperCase()))
          throw new Error("Use a unique reference.");
        c.ref = v;
      }),
    );
    field(panel, "Value", o.value, (v) => modifySelected((c) => (c.value = v)));
    paragraph(panel, o.footprint, "pill");
    field(
      panel,
      "Physical layer",
      String(o.layerId),
      (v) => modifySelected((c) => (c.layerId = Number(v))),
      { choices: layerChoices() },
    );
    numeric(
      panel,
      "Rotation (degrees)",
      o.rot,
      (v) => modifySelected((c) => (c.rot = v)),
      -36000,
      36000,
    );
    for (const [key, label] of [
      ["w", "Body width"],
      ["h", "Body height"],
    ])
      dimension(panel, label, o.body[key], (v) =>
        modifySelected((c) => {
          c.body[key] = v;
          if (c.body.shape === "circle") c.body.w = c.body.h = v;
        }),
      );
    datasheetInspector(panel, o);
    panel.append(el("h3", "Pads"));
    o.pins.forEach((p, index) =>
      button(
        panel,
        "Pad " + p.num,
        () => {
          Editor.selection = { type: "pad", object: o, index };
          renderInspector();
          requestRender();
        },
        "block-button",
      ),
    );
    button(panel, "Add pad", () => {
      Editor.padTarget = o;
      updateHint();
    });
  } else if (s.type === "pad") {
    const p = o.pins[s.index];
    panel.append(el("h2", o.ref + " · Pad " + p.num));
    button(panel, "← Component " + o.ref, () => inspect("component", o));
    field(panel, "Pin number", p.num, (v) =>
      modifySelected(() => {
        if (!v.trim() || o.pins.some((q) => q !== p && q.num === v))
          throw new Error("Use a unique pin number.");
        p.num = v;
      }),
    );
    field(panel, "Pin name", p.name || "", (v) => modifySelected(() => (p.name = v)));
    field(
      panel,
      "Pad shape",
      p.shape,
      (v) =>
        modifySelected(() => {
          p.shape = v;
          if (v === "circle") p.h = p.w;
          else {
            p.tht = false;
            delete p.hole;
          }
        }),
      { choices: ["rect", "circle"] },
    );
    for (const [key, label] of [
      ["x", "Local X"],
      ["y", "Local Y"],
      ["w", "Width"],
      ["h", "Height"],
    ]) {
      if (key === "h" && p.shape === "circle") continue;
      dimension(
        panel,
        label,
        p[key],
        (v) =>
          modifySelected(() => {
            if ((key === "w" || key === "h") && p.hole > v)
              throw new Error("Pad must contain its hole.");
            p[key] = v;
            if (p.shape === "circle" && key === "w") p.h = v;
          }),
        ["x", "y"].includes(key) ? -1e10 : 0.001,
      );
    }
    if (p.shape === "circle") {
      checkbox(panel, "Visible drill hole", hasDrill(p), (v) =>
        modifySelected(() => {
          p.tht = v;
          if (v) p.hole = p.w * 0.4;
          else delete p.hole;
        }),
      );
      if (hasDrill(p))
        dimension(
          panel,
          "Hole diameter",
          p.hole,
          (v) => modifySelected(() => (p.hole = v)),
          0.001,
          p.w,
        );
    }
    paragraph(
      panel,
      "A hole is visual geometry. Use an explicit via for cross-layer connectivity.",
    );
    netInspector(panel, pinKey(o, p));
  } else if (s.type === "trace") {
    panel.append(el("h2", "Trace"));
    field(
      panel,
      "Physical layer",
      String(o.layerId),
      (v) => modifySelected((t) => (t.layerId = Number(v))),
      { choices: layerChoices() },
    );
    dimension(panel, "Trace width", o.width, (v) => modifySelected((t) => (t.width = v)));
    netInspector(panel, "t" + o.id);
  } else if (s.type === "via") {
    panel.append(el("h2", "Via"));
    for (const [key, label] of [
      ["fromLayerId", "From layer"],
      ["toLayerId", "To layer"],
    ])
      field(
        panel,
        label,
        String(o[key]),
        (v) =>
          modifySelected((c) => {
            const id = Number(v);
            if (id === c[key === "fromLayerId" ? "toLayerId" : "fromLayerId"])
              throw new Error("A via must span at least two physical layers.");
            c[key] = id;
          }),
        { choices: layerChoices() },
      );
    dimension(panel, "Via diameter", o.r * 2, (v) =>
      modifySelected((c) => {
        if (v / 2 < c.hole) throw new Error("Diameter must contain the drill.");
        c.r = v / 2;
      }),
    );
    dimension(
      panel,
      "Hole diameter",
      o.hole * 2,
      (v) => modifySelected((c) => (c.hole = v / 2)),
      0.001,
      o.r * 2,
    );
    netInspector(panel, "v" + o.id);
  }
  if (["component", "pad", "trace", "via"].includes(s.type))
    button(panel, "Delete selected", deleteSelected, "danger");
}
function renderInspector() {
  const panel = $("inspector");
  panel.replaceChildren();
  if (Editor.mode?.kind === "align") {
    alignmentInspector(panel, Editor.mode);
    return;
  }
  if (isGroupSelection()) {
    panel.append(el("h2", selectionItems().length + " items selected"));
    paragraph(panel, "Move, copy/paste or delete this group.");
    button(panel, "Delete selected", deleteSelected);
  } else if (Editor.selection) selectionInspector(panel, Editor.selection);
  else if (Editor.tool === "component") componentToolInspector(panel);
  else if (Editor.tool === "trace") {
    panel.append(el("h2", "Draw trace"));
    dimension(panel, "Trace width", Editor.traceWidth, (v) => (Editor.traceWidth = v));
    button(panel, "Finish trace", finishTrace);
  } else if (Editor.tool === "via") {
    panel.append(el("h2", "Place via"));
    dimension(panel, "Via diameter", Editor.viaDiameter, (v) => {
      Editor.viaDiameter = v;
      Editor.viaHole = Math.min(Editor.viaHole, v * 0.9);
      renderInspector();
    });
    dimension(
      panel,
      "Hole diameter",
      Editor.viaHole,
      (v) => (Editor.viaHole = v),
      0.001,
      Editor.viaDiameter,
    );
    paragraph(
      panel,
      "New vias span the active layer and its nearest neighbor. Edit the span after placing.",
    );
  } else if (Editor.tool === "measure") {
    panel.append(el("h2", "Measure"));
    button(panel, "Measure distance", () => startMeasure("measure"));
    button(panel, "Calibrate millimeters", () => startMeasure("calibrate"));
    const m = Editor.mode;
    if (m?.points.length === 2) {
      const distance = Math.hypot(m.points[0].x - m.points[1].x, m.points[0].y - m.points[1].y);
      paragraph(panel, "Distance: " + formatDistance(distance));
      if (m.kind === "calibrate") {
        const input = numeric(panel, "Known distance (mm)", 10, () => {}, 0.000001, 1e10);
        button(panel, "Apply calibration", () => {
          const mm = Number(input.value);
          if (!Number.isFinite(mm) || mm <= 0 || distance <= 0) return;
          change(() => (State.calibration = { boardUnitsPerMm: distance / mm }));
        });
      }
    }
    paragraph(
      panel,
      "Calibration only changes unit conversion. Geometry and scans stay in board coordinates. Select a scan’s properties to align it.",
    );
  } else {
    panel.append(el("h2", "Board setup"));
    paragraph(
      panel,
      ProjectFile.root
        ? "Choose a scan and trace copper on the active physical layer."
        : "Create a new project folder, open one, or import an existing .pcbrev file.",
    );
    if (ProjectFile.root) {
      button(panel, "Add image", () => chooseScan(View.activeLayerId));
      button(panel, "Clean unused assets", collectGarbage);
    }
  }
  if (Connectivity.issues.length) {
    panel.append(el("h3", "Connectivity warnings"));
    Connectivity.issues.slice(0, 10).forEach((w) => paragraph(panel, w, "warning"));
  }
}
function resetWorkspace() {
  Editor.fieldDirty = false;
  Editor.clipboard = null;
  Editor.drag = null;
  Editor.mode = null;
  Editor.selection = null;
  Editor.trace = [];
  Editor.padTarget = null;
  View.primaryByLayer.clear();
  View.comparisonId = null;
  View.drawingOpacity = 1;
  View.activeLayerId = State.physicalLayers[0].id;
  setTool("select");
  afterEdit();
  fitBoard();
}
function prepareSave() {
  if (Editor.drag) cancelDrag();
  const active = document.activeElement;
  if (active instanceof HTMLInputElement) active.blur();
  if (Editor.trace.length >= 2) finishTrace();
  return saveProject();
}
function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    const input =
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable,
      cmd = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    if (cmd && ["n", "o", "s"].includes(key)) {
      e.preventDefault();
      if (input) e.target.blur();
      if (key === "n") newProject();
      else if (key === "o") openProject();
      else prepareSave();
      return;
    }
    if (input) return;
    if (cmd) {
      if (["c", "v", "z", "y"].includes(key)) {
        e.preventDefault();
        if (key === "c") copySelected();
        else if (key === "v") pasteClipboard();
        else runHistory(key === "y" || e.shiftKey);
      }
      return;
    }
    if (e.altKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      Editor.space = true;
      return;
    }
    if (Editor.space) {
      const actions = {
        w: () => cycleLayer(-1),
        s: () => cycleLayer(1),
        z: () => cycleScan(-1),
        c: () => cycleScan(1),
        a: () => adjustBlend(-0.05),
        d: () => adjustBlend(0.05),
        q: () => adjustDrawing(-0.05),
        e: () => adjustDrawing(0.05),
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
      }
      return;
    }
    if (key === "escape") {
      e.preventDefault();
      setTool("select");
    }
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      deleteSelected();
    }
    if (key === "enter" && Editor.tool === "trace") finishTrace();
    const tool = { v: "select", c: "component", t: "trace", b: "via", m: "measure" }[key];
    if (tool) setTool(tool);
    if (key === "f") fitBoard();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
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
  $("open").onclick = openProject;
  $("save").onclick = prepareSave;
  $("undo").onclick = () => runHistory(false);
  $("redo").onclick = () => runHistory(true);
  $("fit").onclick = fitBoard;
  $("import-project").onclick = () => {
    $("project-input").value = "";
    $("project-input").click();
  };
  $("project-input").onchange = (e) => {
    if (e.target.files[0]) importExistingProject(e.target.files[0]);
  };
  $("scan-input").onchange = (e) => {
    if (e.target.files[0]) importScanFile(e.target.files[0], importLayerId);
  };
  $("cancel-import").onclick = () => ImportJob.cancel?.();
  $("project-name").oninput = () => {
    Editor.fieldDirty = true;
    refreshSaveState();
  };
  $("project-name").onchange = (e) => {
    Editor.fieldDirty = false;
    change(() => (State.name = e.target.value.trim() || "Untitled board"));
  };
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $("primary-scan").onchange = (e) => setPrimaryScan(Number(e.target.value));
  $("comparison-scan").onchange = (e) => {
    View.comparisonId = e.target.value ? Number(e.target.value) : null;
    View.blend = 0.5;
    syncViewControls();
    renderLayers();
    requestRender();
  };
  $("blend").oninput = (e) => {
    View.blend = Number(e.target.value);
    requestRender();
  };
  $("drawing-opacity").oninput = (e) => {
    View.drawingOpacity = Number(e.target.value);
    requestRender();
  };
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
  for (const kind of ["bom", "ai"])
    $("export-" + kind).onclick = () => {
      if (Editor.drag) cancelDrag();
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
