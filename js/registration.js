"use strict";
function imageToWorld(scan, p) {
  const t = scan.transform,
    a = (t.rotation * Math.PI) / 180,
    x = p.x * (scan.flipX ? -1 : 1) * t.scale,
    y = p.y * (scan.flipY ? -1 : 1) * t.scale;
  return {
    x: t.tx + x * Math.cos(a) - y * Math.sin(a),
    y: t.ty + x * Math.sin(a) + y * Math.cos(a),
  };
}
function worldToImage(scan, p) {
  const t = scan.transform,
    a = (-t.rotation * Math.PI) / 180,
    x = p.x - t.tx,
    y = p.y - t.ty;
  return {
    x: ((x * Math.cos(a) - y * Math.sin(a)) / t.scale) * (scan.flipX ? -1 : 1),
    y: ((x * Math.sin(a) + y * Math.cos(a)) / t.scale) * (scan.flipY ? -1 : 1),
  };
}
function fitSimilarity(scan, source, target) {
  if (source.length < 3 || source.length > 5 || source.length !== target.length)
    throw new Error("Choose 3–5 matching point pairs.");
  const s = source.map((p) => ({ x: p.x * (scan.flipX ? -1 : 1), y: p.y * (scan.flipY ? -1 : 1) }));
  const mean = (ps) => ({
    x: ps.reduce((n, p) => n + p.x, 0) / ps.length,
    y: ps.reduce((n, p) => n + p.y, 0) / ps.length,
  });
  const a = mean(s),
    b = mean(target);
  let dot = 0,
    cross = 0,
    den = 0;
  s.forEach((p, i) => {
    const x = p.x - a.x,
      y = p.y - a.y,
      u = target[i].x - b.x,
      v = target[i].y - b.y;
    dot += x * u + y * v;
    cross += x * v - y * u;
    den += x * x + y * y;
  });
  if (den < 1e-12 || Math.hypot(dot, cross) < 1e-12)
    throw new Error("Landmarks must be distinct and spread across the board.");
  const A = dot / den,
    B = cross / den,
    transform = {
      tx: b.x - A * a.x + B * a.y,
      ty: b.y - B * a.x - A * a.y,
      scale: Math.hypot(A, B),
      rotation: (Math.atan2(B, A) * 180) / Math.PI,
    };
  const fitted = { ...scan, transform };
  const rms = Math.sqrt(
    source.reduce((sum, p, i) => {
      const q = imageToWorld(fitted, p);
      return sum + (q.x - target[i].x) ** 2 + (q.y - target[i].y) ** 2;
    }, 0) / source.length,
  );
  return { transform, rms };
}
function flipScan(scan, axis) {
  const center = imageToWorld(scan, { x: scan.width / 2, y: scan.height / 2 });
  scan[axis] = !scan[axis];
  const after = imageToWorld(scan, { x: scan.width / 2, y: scan.height / 2 });
  scan.transform.tx += center.x - after.x;
  scan.transform.ty += center.y - after.y;
  scan.aligned = false;
}
