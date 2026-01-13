// frontend/src/forces/bounds.js
// Soft bounds force: push via vx/vy instead of clamping x/y.
// This plays nicely with collision/link forces and reduces overlaps near edges.

export function forceBounds(width, height, padding = 4, strength = 0.25) {
  let nodes;

  function getHalfBox(n) {
    // Prefer collision box (cbox) to match rectCollide; fallback to bbox
    const box = n.cbox ?? n.bbox ?? { w: 0, h: 0 };
    const hw = (box.w ?? 0) / 2;
    const hh = (box.h ?? 0) / 2;
    return { hw, hh };
  }

  function force(alpha) {
    if (!nodes || nodes.length === 0) return;

    // As alpha decreases, weaken the correction to avoid late-stage jitter.
    const k = strength * Math.min(1, Math.max(0.08, alpha ?? 1));

    for (const n of nodes) {
      const { hw, hh } = getHalfBox(n);

      const minX = padding + hw;
      const maxX = width - padding - hw;
      const minY = padding + hh;
      const maxY = height - padding - hh;

      // If outside, apply a velocity correction proportional to penetration depth.
      if (n.x < minX) {
        const d = (minX - n.x);
        n.vx = (n.vx ?? 0) + d * k;
      } else if (n.x > maxX) {
        const d = (n.x - maxX);
        n.vx = (n.vx ?? 0) - d * k;
      }

      if (n.y < minY) {
        const d = (minY - n.y);
        n.vy = (n.vy ?? 0) + d * k;
      } else if (n.y > maxY) {
        const d = (n.y - maxY);
        n.vy = (n.vy ?? 0) - d * k;
      }
    }
  }

  force.initialize = _ => { nodes = _; };
  force.size = (w, h) => { width = w; height = h; return force; };
  force.strength = (s) => { strength = +s; return force; };

  return force;
}
