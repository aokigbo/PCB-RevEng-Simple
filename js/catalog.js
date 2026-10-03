"use strict";
// Small catalog extracted from the upstream parametric footprint generators.

function _pin(num, x, y, opts) {
  return Object.assign(
    { num: String(num), name: "", xmm: x, ymm: y, shape: "rect", w: 1.0, h: 0.6 },
    opts,
  );
}

const Footprints = {
  catalog: [],
  register(def) {
    this.catalog.push(def);
    return def;
  },
};

function getFootprintDef(id) {
  return Footprints.catalog.find((f) => f.id === id) || null;
}

/* an SMD footprint has no through-hole pads (a THT pad = a round pad that keeps its
   drill, i.e. shape "circle" and tht !== false). BGA balls (round, tht:false) still
   count as SMD. Used to gate the global pad-scale/length tuning. */
function isSmdFootprint(fp) {
  return (
    fp &&
    fp.pins &&
    fp.pins.length > 0 &&
    fp.pins.every((pin) => !(pin.shape === "circle" && pin.tht !== false))
  );
}

function _padMul(v, def) {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return def;
  return Math.max(0.1, Math.min(6, n));
}

/* resize/reposition pads after gen():
   · padScale — scales every pad (SMD footprints only)
   · padLen   — scales each pad along its LENGTH axis, i.e. radially outward from the
                body centre (SMD only); round pads scale uniformly instead
   · padOv    — per-pin ABSOLUTE overrides { [pinNum]:{w,h,x,y} } from the visual pad
                editor (drag handles), for ANY generated footprint; whatever is set wins
                over the scaled base. (Free footprints carry their per-pad geometry in
                pinList instead, so they don't use padOv.) */
function applyPadAdjust(fp, p) {
  const smd = isSmdFootprint(fp);
  const gScale = smd ? _padMul(p.padScale, 1) : 1;
  const gLen = smd ? _padMul(p.padLen, 1) : 1;
  const ov = p.padOv && typeof p.padOv === "object" ? p.padOv : null;
  if (gScale === 1 && gLen === 1 && !ov) return;
  for (const pin of fp.pins) {
    let w = pin.w * gScale,
      h = pin.h * gScale;
    if (gLen !== 1) {
      if (pin.shape === "circle") {
        w *= gLen;
        h *= gLen;
      } // round: no length axis
      else if (Math.abs(pin.xmm) >= Math.abs(pin.ymm))
        w *= gLen; // pad points along X
      else h *= gLen; // pad points along Y
    }
    const o = ov && ov[pin.num];
    if (o) {
      if (o.w != null) w = o.w;
      if (o.h != null) h = o.h;
      if (o.x != null) pin.xmm = o.x;
      if (o.y != null) pin.ymm = o.y;
    }
    pin.w = w;
    pin.h = h;
  }
}

function generateFootprint(fpId, params) {
  const def = getFootprintDef(fpId);
  if (!def) return null;
  const p = Object.assign({}, params); // keep undeclared extras (e.g. freestyle pinList, pad tuning)
  for (const prm of def.params)
    p[prm.key] = params && params[prm.key] !== undefined ? params[prm.key] : prm.def;
  // sanitize ints
  for (const prm of def.params)
    if (prm.type === "int") {
      let v = parseInt(p[prm.key], 10);
      if (isNaN(v)) v = prm.def;
      v = Math.max(prm.min, Math.min(prm.max, v));
      if (prm.step > 1) v = Math.round(v / prm.step) * prm.step;
      p[prm.key] = v;
    }
  const fp = def.gen(p);
  applyPadAdjust(fp, p); // global pad scale/length + per-pin overrides
  fp.fpId = fpId;
  fp.params = p;
  return fp;
}

/* default refdes prefix per footprint family — each def may declare `prefix` */
function refPrefixFor(fpId, value) {
  const v = (value || "").toLowerCase();
  if (fpId === "chip2" && /^\d|k$|m$|r/.test(v)) return "R";
  const def = getFootprintDef(fpId);
  return (def && def.prefix) || "U";
}

Footprints.register({
  id: "chip2",
  name: "R / C / L chip (SMD)",
  prefix: "R",
  params: [
    {
      key: "size",
      label: "Size",
      type: "select",
      def: "0805",
      options: [
        "0201",
        "0402",
        "0406",
        "0603",
        "0612",
        "0805",
        "1206",
        "1210",
        "2010",
        "2512",
        "Tant 2012-12",
        "Tant 3216-18",
        "Tant 3528-15",
        "Tant 6032-28",
        "Tant 7343-31",
        "Tant 7343-43",
      ],
    },
    { key: "polarized", label: "Polarized (tantalum)", type: "bool", def: false },
  ],
  gen(p) {
    // Tantalum SMD cap (EIA metric case code, e.g. 3216-18 = 3.2×1.6mm, 1.8mm tall).
    // Always polarized: pin 1 = + (anode), wide gull-wing terminations at each end.
    if (p.size && p.size.startsWith("Tant ")) {
      const code = p.size.slice(5);
      const tdims = {
        // [body length, body width] mm — the 4-digit part of the code
        "2012-12": [2.0, 1.25],
        "3216-18": [3.2, 1.6],
        "3528-15": [3.5, 2.8],
        "6032-28": [6.0, 3.2],
        "7343-31": [7.3, 4.3],
        "7343-43": [7.3, 4.3],
      };
      const kem = {
        "3216-18": "_Kemet-A",
        "6032-28": "_Kemet-C",
        "7343-31": "_Kemet-D",
        "7343-43": "_Kemet-X",
      };
      const [L, W] = tdims[code] || [3.2, 1.6];
      const px = L * 0.42,
        pw = L * 0.375,
        ph = W * 0.75; // pad centre / radial length / tangential width
      return {
        label: "Tantalum " + code,
        pins: [
          _pin(1, -px, 0, { w: pw, h: ph, name: "+" }),
          _pin(2, px, 0, { w: pw, h: ph, name: "-" }),
        ],
        body: { w: L, h: W },
        polar: true,
        kicad: "Capacitor_Tantalum_SMD:CP_EIA-" + code + (kem[code] || ""),
      };
    }
    const dims = {
      // [body length, body width] mm
      "0201": [0.6, 0.3],
      "0402": [1.0, 0.5],
      "0406": [1.0, 1.6],
      "0603": [1.6, 0.8],
      "0612": [1.6, 3.2],
      "0805": [2.0, 1.25],
      1206: [3.2, 1.6],
      1210: [3.2, 2.5],
      2010: [5.0, 2.5],
      2512: [6.3, 3.2],
    };
    const [L, W] = dims[p.size];
    // IPC-7351B nominal (density level B) land patterns, [px pad centre, pw pad length (along
    // axis), ph pad width (across)] mm — matching the KiCad Resistor_SMD reference footprints
    // (pad centre = half the centre-to-centre spacing). 0406/0612 are non-standard wide chips
    // (no IPC land pattern): they reuse the 0402/0603 termination but widen across the body.
    const ipc = {
      "0201": [0.32, 0.46, 0.4],
      "0402": [0.51, 0.54, 0.64],
      "0603": [0.825, 0.8, 0.95],
      "0805": [0.9125, 1.025, 1.4],
      1206: [1.4625, 1.125, 1.75],
      1210: [1.4625, 1.125, 2.65],
      2010: [2.3125, 1.225, 2.65],
      2512: [2.9625, 1.225, 3.35],
    };
    let pw, ph, px;
    if (ipc[p.size]) {
      [px, pw, ph] = ipc[p.size];
    } else if (p.size === "0406") {
      px = 0.51;
      pw = 0.54;
      ph = 1.7; // 0402 length, 1.6 mm-wide body
    } else if (p.size === "0612") {
      px = 0.825;
      pw = 0.8;
      ph = 3.3; // 0603 length, 3.2 mm-wide body
    } else {
      pw = W * 0.9;
      ph = W * 1.1;
      px = L / 2 + W * 0.35; // fallback for any untabulated size
    }
    const code = {
      "0201": "0603",
      "0402": "1005",
      "0406": "1016",
      "0603": "1608",
      "0612": "1632",
      "0805": "2012",
      1206: "3216",
      1210: "3225",
      2010: "5025",
      2512: "6332",
    }[p.size];
    return {
      label: "Chip " + p.size,
      pins: [
        _pin(1, -px, 0, { w: pw, h: ph, name: p.polarized ? "+" : "" }),
        _pin(2, px, 0, { w: pw, h: ph, name: p.polarized ? "-" : "" }),
      ],
      body: { w: L, h: W },
      polar: !!p.polarized,
      kicad: "Resistor_SMD:R_" + p.size + "_" + code + "Metric",
    };
  },
});

Footprints.register({
  id: "axial",
  name: "Axial THT (R / D / film)",
  prefix: "R",
  params: [{ key: "span", label: "Pitch mm", type: "int", def: 10, min: 5, max: 30, step: 1 }],
  gen(p) {
    return {
      label: "Axial " + p.span + "mm",
      pins: [
        _pin(1, -p.span / 2, 0, { shape: "circle", w: 1.6, h: 1.6 }),
        _pin(2, p.span / 2, 0, { shape: "circle", w: 1.6, h: 1.6 }),
      ],
      body: { w: p.span * 0.6, h: 2.5 },
      kicad: "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P" + p.span.toFixed(2) + "mm_Horizontal",
    };
  },
});

Footprints.register({
  id: "radial",
  name: "Radial THT cap",
  prefix: "C",
  params: [
    {
      key: "pitch",
      label: "Pitch mm",
      type: "select",
      def: "2.5",
      options: ["2.0", "2.5", "3.5", "5.0", "7.5"],
    },
    {
      key: "shape",
      label: "Body",
      type: "select",
      def: "Round",
      options: ["Round", "Square (foil)"],
    },
    { key: "polarized", label: "Polarized", type: "bool", def: true },
  ],
  gen(p) {
    const d = parseFloat(p.pitch);
    const dia = Math.max(d * 1.8, d + 3);
    const square = p.shape !== "Round";
    const pol = !!p.polarized;
    return {
      label: (square ? "Foil cap P" : "Radial P") + p.pitch,
      pins: [
        _pin(1, -d / 2, 0, { shape: "circle", w: 1.4, h: 1.4, name: pol ? "+" : "" }),
        _pin(2, d / 2, 0, { shape: "circle", w: 1.4, h: 1.4, name: pol ? "-" : "" }),
      ],
      body: { w: dia, h: dia, shape: square ? "rect" : "circle" },
      polar: pol,
      kicad:
        (pol ? "Capacitor_THT:CP_Radial_D" : "Capacitor_THT:C_Radial_D") +
        dia.toFixed(1) +
        "mm_P" +
        d.toFixed(2) +
        "mm",
    };
  },
});

Footprints.register({
  id: "sot23",
  name: "SOT-23 / 323 / 523",
  prefix: "Q",
  params: [
    {
      key: "pkg",
      label: "Package",
      type: "select",
      def: "SOT-23",
      options: ["SOT-23", "SOT-323", "SOT-523", "SOT-723"],
    },
    { key: "pins", label: "Pins", type: "select", def: "3", options: ["3", "5", "6"] },
  ],
  gen(p) {
    const k = { "SOT-23": 1, "SOT-323": 0.68, "SOT-523": 0.5, "SOT-723": 0.42 }[p.pkg];
    const n = parseInt(p.pins, 10),
      pins = [];
    const px = 0.95 * k,
      py = 1.15 * k;
    const pad = { w: 0.55 * k, h: 0.8 * k };
    if (n === 3) {
      pins.push(
        _pin(1, -px, py, { ...pad }),
        _pin(2, px, py, { ...pad }),
        _pin(3, 0, -py, { ...pad }),
      );
    } else {
      const top = n === 5 ? 2 : 3;
      for (let i = 0; i < 3; i++) pins.push(_pin(i + 1, (i - 1) * px, py, { ...pad }));
      for (let i = 0; i < top; i++)
        pins.push(_pin(3 + i + 1, top === 2 ? (i ? -px : px) : (1 - i) * px, -py, { ...pad }));
    }
    const kicadName = {
      "SOT-23": "SOT-23",
      "SOT-323": "SOT-323_SC-70",
      "SOT-523": "SOT-523",
      "SOT-723": "SOT-723",
    }[p.pkg];
    return {
      label: p.pkg + (n > 3 ? "-" + n : ""),
      pins,
      body: { w: 3.0 * k, h: 1.6 * k },
      kicad: "Package_TO_SOT_SMD:" + (n === 3 ? kicadName : "SOT-23-" + n),
    };
  },
});

Footprints.register({
  id: "sod",
  name: "SOD / SMA-SMC diode",
  prefix: "D",
  params: [
    {
      key: "pkg",
      label: "Package",
      type: "select",
      def: "SOD-123",
      options: ["SOD-523", "SOD-323", "SOD-123", "SOD-80", "SMA", "SMB", "SMC"],
    },
  ],
  gen(p) {
    const dims = {
      // [bodyL, bodyW, padW, padH, pitchCenter]
      "SOD-523": [1.2, 0.8, 0.5, 0.7, 1.6],
      "SOD-323": [1.7, 1.25, 0.6, 0.9, 2.2],
      "SOD-123": [2.7, 1.6, 0.9, 1.2, 3.6],
      "SOD-80": [3.5, 1.5, 0.9, 1.2, 4.2],
      SMA: [4.3, 2.6, 1.5, 1.8, 5.2],
      SMB: [4.3, 3.6, 1.6, 2.2, 5.4],
      SMC: [6.0, 4.5, 1.8, 2.6, 7.6],
    };
    const [L, W, pw, ph, pc] = dims[p.pkg];
    return {
      label: p.pkg,
      pins: [
        _pin(1, -pc / 2, 0, { w: pw, h: ph, name: "K" }),
        _pin(2, pc / 2, 0, { w: pw, h: ph, name: "A" }),
      ],
      body: { w: L, h: W },
      symbol: "diode",
      kicad: "Diode_SMD:D_" + p.pkg,
    };
  },
});

Footprints.register({
  id: "free",
  name: "Freestyle",
  prefix: "U", // imported footprints live in "Custom (imported)"
  // "num" (not int) so fractional bodies work — quick-add "free 4.5x5" etc.
  params: [
    { key: "w", label: "Body W mm", type: "num", def: 10, min: 1, max: 200, step: 0.5 },
    { key: "h", label: "Body H mm", type: "num", def: 10, min: 1, max: 200, step: 0.5 },
  ],
  gen(p) {
    const pins = (p.pinList || []).map((pl) => {
      const shape = pl.shape || "circle"; // "circle" = round pad, "rect" = SMD rectangle
      const sz = pl.size || (shape === "circle" ? 1.6 : 1.2);
      // pl.w/pl.h give a non-square pad (e.g. imported SMD/QFP pads); fall back to size
      const w = pl.w || sz,
        h = pl.h || sz;
      // tht:false marks a round pad with no drill (e.g. an imported BGA ball); a round pad
      // defaults to through-hole (with a drill), which is what a hand-placed round pad means
      return _pin(pl.num, pl.x, pl.y, { shape, w, h, tht: pl.tht });
    });
    return {
      label: "Free-" + pins.length,
      pins,
      body: { w: parseFloat(p.w) || 10, h: parseFloat(p.h) || 10 },
      kicad: "",
    };
  },
});

Footprints.register({
  id: "pad1",
  name: "Single pad / test point",
  prefix: "TP",
  // free-entry diameters (like a via's size) rather than a fixed size list. SMD by default
  // (one-sided land, no drill); tick Through-hole to add a drilled, all-layers pad.
  params: [
    { key: "tht", label: "Through-hole", type: "bool", def: false, rebuilds: true },
    { key: "dia", label: "Pad Ø mm", type: "num", def: 1.5, min: 0.3, max: 30, step: 0.1 },
    {
      key: "hole",
      label: "Hole Ø mm",
      type: "num",
      def: 0.8,
      min: 0.1,
      max: 30,
      step: 0.1,
      showIf: (p) => !!p.tht,
    },
  ],
  gen(p) {
    const d = parseFloat(p.dia) || 1.5;
    const tht = !!p.tht;
    const opts = { shape: "circle", w: d, h: d, tht };
    if (tht) {
      let hole = parseFloat(p.hole);
      if (!isFinite(hole) || hole <= 0) hole = Math.min(0.8, d);
      if (hole > d) hole = d; // a drill can never be wider than its pad
      opts.hole = hole;
    }
    return {
      label: tht ? "THT pad D" + d.toFixed(1) : "Test point D" + d.toFixed(1),
      pins: [_pin(1, 0, 0, opts)],
      body: { w: d * 1.3, h: d * 1.3, shape: "circle" },
      kicad: tht
        ? "TestPoint:TestPoint_THTPad_D" + d.toFixed(1) + "mm"
        : "TestPoint:TestPoint_Pad_D" + d.toFixed(1) + "mm",
    };
  },
});

Footprints.register({
  id: "dip",
  name: "DIP",
  prefix: "U",
  params: [
    { key: "pins", label: "Pins", type: "int", def: 8, min: 4, max: 64, step: 2 },
    {
      key: "width",
      label: "Row width",
      type: "select",
      def: "7.62",
      options: ["7.62", "10.16", "15.24"],
    },
  ],
  gen(p) {
    const n = p.pins,
      half = n / 2,
      w = parseFloat(p.width),
      pins = [];
    for (let i = 0; i < half; i++) {
      const x = (i - (half - 1) / 2) * 2.54;
      pins.push(_pin(i + 1, x, w / 2, { shape: "circle", w: 1.4, h: 1.4 })); // bottom row L→R
      pins.push(_pin(n - i, x, -w / 2, { shape: "circle", w: 1.4, h: 1.4 })); // top row R→L
    }
    return {
      label: "DIP-" + n,
      pins,
      body: { w: half * 2.54, h: w - 1.5 },
      kicad: "Package_DIP:DIP-" + n + "_W" + w.toFixed(2) + "mm",
    };
  },
});

Footprints.register({
  id: "soic",
  name: "SOIC / SOP / TSSOP / MSOP",
  prefix: "U",
  params: [
    { key: "pins", label: "Pins", type: "int", def: 8, min: 4, max: 56, step: 2 },
    {
      key: "pitch",
      label: "Pitch mm",
      type: "select",
      def: "1.27",
      options: ["0.5", "0.65", "0.8", "1.27"],
    },
    {
      key: "width",
      label: "Row width",
      type: "select",
      def: "6.0",
      options: ["3.0", "4.4", "6.0", "7.5", "10.3"],
    },
  ],
  gen(p) {
    const n = p.pins,
      half = n / 2,
      pt = parseFloat(p.pitch),
      w = parseFloat(p.width),
      pins = [];
    for (let i = 0; i < half; i++) {
      const x = (i - (half - 1) / 2) * pt;
      pins.push(_pin(i + 1, x, w / 2, { w: pt * 0.55, h: 1.5 }));
      pins.push(_pin(n - i, x, -w / 2, { w: pt * 0.55, h: 1.5 }));
    }
    let fam = "SOIC-" + n,
      kicad = "Package_SO:SOIC-" + n + "_3.9x4.9mm_P1.27mm";
    if (pt !== 1.27) {
      fam = (w <= 3.0 ? "MSOP-" : "TSSOP-") + n;
      kicad =
        w <= 3.0
          ? "Package_SO:MSOP-" + n + "_3x3mm_P" + p.pitch + "mm"
          : "Package_SO:TSSOP-" + n + "_4.4x5mm_P" + p.pitch + "mm";
    }
    return { label: fam + " P" + p.pitch, pins, body: { w: half * pt + 0.5, h: w - 2 }, kicad };
  },
});

Footprints.register({
  id: "sip",
  name: "SIP / pin header 1×N",
  prefix: "J",
  params: [
    { key: "pins", label: "Pins", type: "int", def: 4, min: 1, max: 40, step: 1 },
    {
      key: "pitch",
      label: "Pitch mm",
      type: "select",
      def: "2.54",
      options: ["1.0", "1.27", "2.0", "2.54", "3.96", "5.0"],
    },
  ],
  gen(p) {
    const n = p.pins,
      pt = parseFloat(p.pitch),
      pins = [];
    for (let i = 0; i < n; i++)
      pins.push(
        _pin(i + 1, (i - (n - 1) / 2) * pt, 0, { shape: "circle", w: pt * 0.55, h: pt * 0.55 }),
      );
    return {
      label: "1×" + n + " P" + p.pitch,
      pins,
      body: { w: n * pt, h: pt },
      kicad:
        "Connector_PinHeader_" +
        p.pitch +
        "mm:PinHeader_1x" +
        String(n).padStart(2, "0") +
        "_P" +
        p.pitch +
        "mm_Vertical",
    };
  },
});
