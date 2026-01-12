// 把节点限制在画布范围内（考虑 bbox）
export function forceBounds(width, height, padding = 4) {
    let nodes;
    function force() {
      for (const n of nodes) {
        const hw = (n.bbox?.w ?? 0) / 2;
        const hh = (n.bbox?.h ?? 0) / 2;
        const minX = padding + hw;
        const maxX = width - padding - hw;
        const minY = padding + hh;
        const maxY = height - padding - hh;
  
        if (n.x < minX) n.x = minX;
        if (n.x > maxX) n.x = maxX;
        if (n.y < minY) n.y = minY;
        if (n.y > maxY) n.y = maxY;
      }
    }
    force.initialize = _ => { nodes = _; };
    force.size = (w, h) => { width = w; height = h; return force; };
    return force;
  }