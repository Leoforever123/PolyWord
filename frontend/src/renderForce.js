import * as d3 from "d3";
import { forceRectCollide } from "./forces/rectCollide.js";
import { forceBounds } from "./forces/bounds.js";

const GHOST_PAD = 14;

function measureBBoxes(nodes, fontFamily) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  for (const n of nodes) {
    ctx.font = `${Math.round(n.size)}px ${fontFamily}`;
    const m = ctx.measureText(n.text);

    let w = m.width;
    let h = n.size * 1.15;

    if (n.rotate === 90) {
      const tmp = w; w = h; h = tmp;
    }

    const baseW = w + 8;
    const baseH = h + 8;
    n.bbox = { w: baseW, h: baseH };
    n.cbox = { w: baseW + GHOST_PAD, h: baseH + GHOST_PAD };
  }
}

function attachZoom(svgEl, rootG, onZoomK) {
  const svg = d3.select(svgEl);

  const zoom = d3.zoom()
    .scaleExtent([0.25, 4])
    .on("zoom", (event) => {
      rootG.attr("transform", event.transform);
      if (onZoomK) onZoomK(event.transform.k);
    });

  svg.call(zoom);
  svg.on("dblclick.zoom", null);

  svgEl.__zoomBehavior = zoom;
}

function getWorldPointer(svgEl, dragEvent) {
  const t = d3.zoomTransform(svgEl);
  const p = d3.pointer(dragEvent, svgEl);
  return t.invert(p);
}

function simToWidth(sim) {
  const s = Math.max(0, Math.min(1, sim ?? 0));
  return 1.2 + 5.5 * Math.pow(s, 1.35);
}
function simToOpacity(sim) {
  const s = Math.max(0, Math.min(1, sim ?? 0));
  return 0.25 + 0.75 * Math.pow(s, 0.9);
}

function getId(v) {
  return typeof v === "object" ? v.id : v;
}

function computeNeighborhood(neighbors, startId, hop = 1) {
  const L0 = new Set([startId]);
  const L1 = new Set();
  const L2 = new Set();

  const n1 = neighbors.get(startId) ?? new Set();
  for (const x of n1) L1.add(x);

  if (hop >= 2) {
    for (const x of L1) {
      const nx = neighbors.get(x) ?? new Set();
      for (const y of nx) {
        if (y !== startId && !L1.has(y)) L2.add(y);
      }
    }
  }

  return { L0, L1, L2 };
}

export async function renderForce(svgEl, words, links, opts, onZoomK) {
  const ui = opts?.ui ?? {};
  const showLinks = ui.showLinks !== false;
  const showTooltip = ui.showTooltip !== false;
  const highlightHop = ui.highlightHop === 2 ? 2 : 1;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  svg.attr("width", opts.w).attr("height", opts.h).attr("viewBox", `0 0 ${opts.w} ${opts.h}`);

  // defs：ghost 框虚化
  const defs = svg.append("defs");
  const filter = defs.append("filter").attr("id", "dragGlow");
  filter.append("feGaussianBlur").attr("stdDeviation", 1.2).attr("result", "blur");
  const merge = filter.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");

  const root = svg.append("g");
  attachZoom(svgEl, root, onZoomK);

  const fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";

  const nodes = words.map((d, i) => ({
    id: i,
    text: d.text,
    weight: d.weight,
    size: d.size,
    rotate: 0,
    color: d3.schemeTableau10[i % 10],
    x: opts.w / 2 + (i % 9) * 6,
    y: opts.h / 2 + (i % 7) * 6,
    pinned: false, // ✅ 新增：是否已 pin
  }));

  measureBBoxes(nodes, fontFamily);

  const safeLinks = (links || []).map(l => ({
    source: l.source,
    target: l.target,
    sim: l.sim
  }));

  // 邻接表 + 边表（tooltip/top neighbors）
  const neighbors = new Map();
  const edgeMap = new Map(); // "a|b" -> sim
  for (const n of nodes) neighbors.set(n.id, new Set());
  for (const l of safeLinks) {
    const a = l.source;
    const b = l.target;
    if (typeof a !== "number" || typeof b !== "number") continue;
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
    edgeMap.set(`${Math.min(a, b)}|${Math.max(a, b)}`, l.sim ?? 0);
  }

  function getSim(a, b) {
    return edgeMap.get(`${Math.min(a, b)}|${Math.max(a, b)}`) ?? 0;
  }

  // -----------------------
  // 状态：hover + click 锁定
  // -----------------------
  let hoverId = null;
  let selectedId = null;
  let draggingId = null;

  function getActiveId() {
    if (draggingId != null) return draggingId;
    if (selectedId != null) return selectedId;
    return hoverId;
  }

  // -----------------------
  // edges
  // -----------------------
  const linkLayer = root.append("g")
    .attr("stroke-linecap", "round")
    .style("display", showLinks ? null : "none");

  const link = linkLayer
    .selectAll("line")
    .data(safeLinks)
    .enter()
    .append("line")
    .attr("stroke", "#94a3b8")
    .attr("stroke-opacity", 0.14)
    .attr("stroke-width", d => 0.8 + 2.2 * Math.max(0, (d.sim ?? 0) - 0.2));

  // drag ghost
  const dragLayer = root.append("g").style("pointer-events", "none");
  const dragRect = dragLayer.append("rect")
    .attr("rx", 10)
    .attr("ry", 10)
    .attr("fill", "rgba(99,102,241,0.06)")
    .attr("stroke", "#6366f1")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "6 6")
    .attr("opacity", 0)
    .attr("filter", "url(#dragGlow)");

  // tooltip
  const tooltip = root.append("g")
    .style("pointer-events", "none")
    .style("display", showTooltip ? null : "none")
    .attr("opacity", 0);

  const tipBg = tooltip.append("rect")
    .attr("rx", 10)
    .attr("ry", 10)
    .attr("fill", "rgba(15,23,42,0.88)")
    .attr("stroke", "rgba(148,163,184,0.35)")
    .attr("stroke-width", 1);

  const tipText = tooltip.append("text")
    .attr("x", 12)
    .attr("y", 14)
    .attr("fill", "white")
    .style("font-family", fontFamily)
    .style("font-size", "12px")
    .style("font-weight", 600);

  function setTooltipContent(activeId) {
    const n = nodes[activeId];
    const neigh = [...(neighbors.get(activeId) ?? [])];

    const top3 = neigh
      .map(id => ({ id, sim: getSim(activeId, id), text: nodes[id]?.text }))
      .sort((a, b) => (b.sim ?? 0) - (a.sim ?? 0))
      .slice(0, 3);

    const lines = [
      `${n.text}${n.pinned ? "  [PIN]" : ""}`,
      `weight: ${n.weight ?? "-"}`,
      `degree: ${neigh.length}`,
      ...(top3.length ? ["top neighbors:"] : []),
      ...top3.map(x => `  • ${x.text}  (sim=${(x.sim ?? 0).toFixed(2)})`)
    ];

    tipText.selectAll("tspan").remove();
    lines.forEach((line, i) => {
      tipText.append("tspan")
        .attr("x", 12)
        .attr("dy", i === 0 ? 0 : 16)
        .text(line);
    });

    const bb = tipText.node().getBBox();
    tipBg
      .attr("x", bb.x - 10)
      .attr("y", bb.y - 8)
      .attr("width", bb.width + 20)
      .attr("height", bb.height + 16);
  }

  function positionTooltip(activeId) {
    const n = nodes[activeId];
    const w = (n.cbox?.w ?? n.bbox?.w ?? 0);
    const h = (n.cbox?.h ?? n.bbox?.h ?? 0);

    const ox = n.x + w / 2 + 10;
    const oy = n.y - h / 2 - 10;
    tooltip.attr("transform", `translate(${ox},${oy})`);
  }

  // labels
  const labelLayer = root.append("g");
  const labels = labelLayer
    .selectAll("text")
    .data(nodes)
    .enter()
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-family", fontFamily)
    .style("font-weight", 650)
    .style("fill", d => d.color)
    .style("font-size", d => `${d.size}px`)
    .style("cursor", "grab")
    .style("user-select", "none")
    .style("paint-order", "stroke")
    .text(d => d.text);

  // 点击空白清除锁定（不影响 pin）
  svg.on("click", () => {
    selectedId = null;
    draggingId = null;
    updateHighlight();
  });

  function updateHighlight() {
    const activeId = getActiveId();

    if (activeId == null) {
      labels
        .style("opacity", 1)
        .style("stroke", "transparent")
        .style("stroke-width", 0);

      link
        .attr("stroke-opacity", 0.14)
        .attr("stroke", "#94a3b8")
        .attr("stroke-width", d => 0.8 + 2.2 * Math.max(0, (d.sim ?? 0) - 0.2));

      tooltip.attr("opacity", 0);
      return;
    }

    const { L0, L1, L2 } = computeNeighborhood(neighbors, activeId, highlightHop);

    labels
      .style("opacity", d => {
        if (L0.has(d.id)) return 1;
        if (L1.has(d.id)) return 1;
        if (highlightHop >= 2 && L2.has(d.id)) return 0.55;
        return 0.14;
      })
      .style("stroke", d => (L0.has(d.id) ? "rgba(15,23,42,0.55)" : "transparent"))
      .style("stroke-width", d => (L0.has(d.id) ? 4 : 0));

    link
      .attr("stroke", d => {
        const s = getId(d.source), t = getId(d.target);
        const hit = (s === activeId) || (t === activeId);
        return hit ? "#64748b" : "#94a3b8";
      })
      .attr("stroke-opacity", d => {
        const s = getId(d.source), t = getId(d.target);
        const hit = (s === activeId) || (t === activeId);
        return hit ? simToOpacity(d.sim) : 0.05;
      })
      .attr("stroke-width", d => {
        const s = getId(d.source), t = getId(d.target);
        const hit = (s === activeId) || (t === activeId);
        const base = 0.8 + 2.2 * Math.max(0, (d.sim ?? 0) - 0.2);
        return hit ? Math.max(base, simToWidth(d.sim)) : base * 0.7;
      });

    if (showTooltip) {
      setTooltipContent(activeId);
      positionTooltip(activeId);
      tooltip.attr("opacity", 1);
    }
  }

  labels
    .on("mouseenter", (event, d) => {
      hoverId = d.id;
      updateHighlight();
    })
    .on("mouseleave", () => {
      hoverId = null;
      updateHighlight();
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      selectedId = (selectedId === d.id) ? null : d.id;
      updateHighlight();
    })
    // 可选：双击单点解 pin（你不想要也可以删掉）
    .on("dblclick", (event, d) => {
      event.stopPropagation();
      d.pinned = false;
      d.fx = null;
      d.fy = null;
    });

  // -----------------------
  // simulation
  // -----------------------
  const sim = d3.forceSimulation(nodes)
    .velocityDecay(0.32)
    .alphaDecay(0.055)
    .force("center", d3.forceCenter(opts.w / 2, opts.h / 2))
    .force("charge", d3.forceManyBody().strength(-18))
    .force("link", d3.forceLink(safeLinks).id(d => d.id)
      .distance(d => 240 - 160 * (d.sim ?? 0))
      .strength(d => {
        const s = (d.sim ?? 0);
        return Math.min(0.75, Math.max(0.05, s));
      }))
    .force("rectCollide", forceRectCollide(2, 1.05, 4))
    .force("bounds", forceBounds(opts.w, opts.h, 8, 0.22))
    .on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      labels
        .attr("transform", d => `translate(${d.x},${d.y}) rotate(${d.rotate})`);

      const activeId = getActiveId();
      if (activeId != null && showTooltip) positionTooltip(activeId);
    });

  // -----------------------
  // Unpin All（挂到 svgEl 上，main.js 可直接调用）
  // -----------------------
  function unpinAll() {
    for (const n of nodes) {
      n.pinned = false;
      n.fx = null;
      n.fy = null;
    }
    // 让系统稍微“热”一下，快速重新收敛
    sim.alphaTarget(0.12).restart();
    setTimeout(() => sim.alphaTarget(0), 250);
    updateHighlight();
  }
  svgEl.__unpinAll = unpinAll;

  // -----------------------
  // 方案A：拖动时软拖拽 1-hop 邻居
  // -----------------------
  let dragPack = null; // { startX, startY, fixed: [{node, x, y, k, movable}] }

  function buildDragPack(d) {
    const neigh = [...(neighbors.get(d.id) ?? [])];

    const fixed = [];
    fixed.push({ node: d, x: d.x, y: d.y, k: 1, movable: true });

    for (const id of neigh) {
      const n = nodes[id];
      if (!n) continue;

      // ✅ 已 pin 的邻居不要被拖走（否则用户辛苦 pin 的也被你一把带走）
      if (n.pinned) continue;

      const s = getSim(d.id, id);
      const k = 0.15 + 0.5 * Math.pow(Math.max(0, Math.min(1, s)), 0.8);
      fixed.push({ node: n, x: n.x, y: n.y, k, movable: true });
    }

    return { startX: d.x, startY: d.y, fixed };
  }

  function applyDragPack(pack, mx, my) {
    const dx = mx - pack.startX;
    const dy = my - pack.startY;
    for (const it of pack.fixed) {
      if (!it.movable) continue;
      it.node.fx = it.x + dx * it.k;
      it.node.fy = it.y + dy * it.k;
    }
  }

  // drag（拖完自动 pin 主节点）
  labels.call(
    d3.drag()
      .on("start", (event, d) => {
        svg.on(".zoom", null);

        draggingId = d.id;

        if (!event.active) sim.alphaTarget(0.25).restart();

        // 如果原来就是 pinned，先把它当作可拖动点：drag 时允许移动 pinned 点
        // （用户拖动 pinned 点本身就是在改 pin 的位置）
        dragPack = buildDragPack(d);

        d3.select(event.sourceEvent?.target).style("cursor", "grabbing");

        const w = d.cbox?.w ?? d.bbox?.w ?? 0;
        const h = d.cbox?.h ?? d.bbox?.h ?? 0;
        dragRect
          .attr("width", w)
          .attr("height", h)
          .attr("opacity", 0.9)
          .attr("transform", `translate(${d.x - w / 2}, ${d.y - h / 2})`);

        updateHighlight();
      })
      .on("drag", (event, d) => {
        const [mx, my] = getWorldPointer(svgEl, event);

        if (dragPack) applyDragPack(dragPack, mx, my);

        const w = d.cbox?.w ?? d.bbox?.w ?? 0;
        const h = d.cbox?.h ?? d.bbox?.h ?? 0;
        dragRect.attr("transform", `translate(${mx - w / 2}, ${my - h / 2})`);
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);

        // 释放邻居的 fx/fy（主节点不释放，直接 pin）
        if (dragPack) {
          for (const it of dragPack.fixed) {
            if (it.node === d) continue;
            it.node.fx = null;
            it.node.fy = null;
          }
        }
        dragPack = null;

        // ✅ 关键：拖完自动 pin 主节点（保持最终位置，不回弹）
        const [mx, my] = getWorldPointer(svgEl, event);
        d.fx = mx;
        d.fy = my;
        d.pinned = true;

        d3.select(event.sourceEvent?.target).style("cursor", "grab");
        dragRect.attr("opacity", 0);

        draggingId = null;
        updateHighlight();

        attachZoom(svgEl, root, onZoomK);
      })
  );

  updateHighlight();
}
