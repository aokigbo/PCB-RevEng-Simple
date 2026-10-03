"use strict";

function imageToWorld(l, p) {
  const x = (l.mirror ? -p.x : p.x) * l.scale,
    y = p.y * l.scale,
    a = (l.rot * Math.PI) / 180;
  return {
    x: l.tx + x * Math.cos(a) - y * Math.sin(a),
    y: l.ty + x * Math.sin(a) + y * Math.cos(a),
  };
}
function worldToImage(l, p) {
  const a = (-l.rot * Math.PI) / 180,
    x = p.x - l.tx,
    y = p.y - l.ty;
  return {
    x: ((x * Math.cos(a) - y * Math.sin(a)) / l.scale) * (l.mirror ? -1 : 1),
    y: (x * Math.sin(a) + y * Math.cos(a)) / l.scale,
  };
}
function alignImage(layer, source, target) {
  const s = source.map((p) => ({ x: layer.mirror ? -p.x : p.x, y: p.y }));
  const dx = s[1].x - s[0].x,
    dy = s[1].y - s[0].y,
    tx = target[1].x - target[0].x,
    ty = target[1].y - target[0].y;
  if (Math.hypot(dx, dy) < 2 || Math.hypot(tx, ty) < 2)
    throw new Error("Choose two distinct reference points, farther apart.");
  layer.scale = Math.hypot(tx, ty) / Math.hypot(dx, dy);
  layer.rot = ((Math.atan2(ty, tx) - Math.atan2(dy, dx)) * 180) / Math.PI;
  const a = (layer.rot * Math.PI) / 180;
  layer.tx = target[0].x - layer.scale * (s[0].x * Math.cos(a) - s[0].y * Math.sin(a));
  layer.ty = target[0].y - layer.scale * (s[0].x * Math.sin(a) + s[0].y * Math.cos(a));
}
