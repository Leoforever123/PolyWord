import * as d3 from "d3";

// 矩形碰撞力（四叉树加速）
// 优先使用 node.cbox（推荐：与 UI/ghost 一致），否则退回 node.bbox
// 推 vx/vy（而非直接推 x/y）以减少振荡
export function forceRectCollide(padding = 0, strength = 0.9, iterations = 3) {
  let nodes;

  function getBox(n) {
    // cbox: collision box；bbox: base box
    const box = n.cbox ?? n.bbox ?? { w: 0, h: 0 };
    // 外层再加一层 padding（可为 0）
    return {
      w: (box.w ?? 0) + padding * 2,
      h: (box.h ?? 0) + padding * 2
    };
  }

  function force(alpha) {
    if (!nodes || nodes.length === 0) return;

    // alpha 越小作用越弱（防止后期抖）
    const aStrength = strength * Math.min(1, Math.max(0.08, alpha));

    for (let k = 0; k < iterations; k++) {
      const tree = d3.quadtree(nodes, d => d.x, d => d.y);

      for (const a of nodes) {
        const A = getBox(a);
        const ax0 = a.x - A.w / 2, ax1 = a.x + A.w / 2;
        const ay0 = a.y - A.h / 2, ay1 = a.y + A.h / 2;

        tree.visit((q, x0, y0, x1, y1) => {
          const b = q.data;
          if (b && b !== a) {
            const B = getBox(b);

            const dx = a.x - b.x;
            const px = (A.w + B.w) / 2 - Math.abs(dx);
            if (px > 0) {
              const dy = a.y - b.y;
              const py = (A.h + B.h) / 2 - Math.abs(dy);
              if (py > 0) {
                // 沿更小重叠方向分离
                if (px < py) {
                  const sx = dx < 0 ? -1 : 1;
                  const m = px * 0.5 * aStrength;
                  a.vx = (a.vx ?? 0) + sx * m;
                  b.vx = (b.vx ?? 0) - sx * m;
                } else {
                  const sy = dy < 0 ? -1 : 1;
                  const m = py * 0.5 * aStrength;
                  a.vy = (a.vy ?? 0) + sy * m;
                  b.vy = (b.vy ?? 0) - sy * m;
                }
              }
            }
          }

          // 剪枝：与 a 的 AABB 没交集则跳过子树
          const outside = x0 > ax1 || x1 < ax0 || y0 > ay1 || y1 < ay0;
          return outside;
        });
      }
    }
  }

  force.initialize = _ => { nodes = _; };
  return force;
}
