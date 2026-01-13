// frontend/src/renderSpiralAdvanced.js
//
// Advanced spiral word cloud renderer (NEW FEATURE, does not affect existing renderSpiral.js).
//
// Differences vs renderSpiral.js:
// - Adaptive sizing from container (SVG parent element) by default
// - Shape mask constraint: built-in shapes OR uploaded image mask
// - Pixel-perfect packing via advancedSpiralPlacer (custom, not d3-cloud layout)
// - Keeps the SAME zoom behavior pattern as renderSpiral.js:
//   - attachZoom(svgEl, root, onZoomK)
//   - svgEl.__zoomBehavior exposed for main.js controls
//   - disable dblclick zoom
//
// Signature aligned with renderSpiral:
//   export async function renderSpiralAdvanced(svgEl, words, opts, onZoomK)

import * as d3 from "d3";
import { createBuiltInShapeMask, loadImageMask } from "./advancedCloud/maskUtils.js";
import { placeWordsAdvanced } from "./advancedCloud/advancedSpiralPlacer.js";

function attachZoom(svgEl, g, onZoomK) {
  const svg = d3.select(svgEl);

  const zoom = d3.zoom()
    .scaleExtent([0.25, 4])
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
      if (onZoomK) onZoomK(event.transform.k);
    });

  svg.call(zoom);
  svg.on("dblclick.zoom", null);
  svgEl.__zoomBehavior = zoom;
}

function getContainerSize(svgEl, fallbackW = 1100, fallbackH = 700) {
  const parent = svgEl?.parentElement;
  const w = Math.floor(parent?.clientWidth || svgEl?.clientWidth || fallbackW);
  const h = Math.floor(parent?.clientHeight || svgEl?.clientHeight || fallbackH);
  return { width: Math.max(50, w), height: Math.max(50, h) };
}

function defaultColorFn(d, i) {
  const palette = d3.schemeTableau10 || ["#1f77b4", "#9467bd", "#2ca02c", "#d62728"];
  return palette[i % palette.length];
}

/**
 * opts.shape:
 *   - { type: "builtin", name: "circle"|"heart"|"roundedRect"|"star", margin?: number, shapePadding?: number }
 *   - { type: "image", source: File|Blob|string, mode?: "alpha"|"luminance", shapePadding?: number, alphaThreshold?: number, luminanceThreshold?: number, luminanceMode?: "dark"|"light" }
 */
async function buildAllowedMask(width, height, opts) {
  const shape = opts.shape || { type: "builtin", name: "circle" };

  if (shape.type === "image") {
    const res = await loadImageMask({
      source: shape.source,
      width,
      height,
      mode: shape.mode || "alpha",
      alphaThreshold: shape.alphaThreshold ?? 1,
      luminanceThreshold: shape.luminanceThreshold ?? 200,
      luminanceMode: shape.luminanceMode || "dark",
      shapePadding: Math.floor(shape.shapePadding ?? 0),
    });
    return res.mask;
  }

  const res = createBuiltInShapeMask({
    width,
    height,
    shape: shape.name || "circle",
    margin: Math.floor(shape.margin ?? 8),
    shapePadding: Math.floor(shape.shapePadding ?? 0),
  });
  return res.mask;
}

/**
 * Advanced renderer aligned with renderSpiral signature.
 *
 * @param {SVGSVGElement} svgEl
 * @param {Array<{text:string,size:number,weight?:number,color?:string}>} words
 * @param {object} opts
 * @param {(k:number)=>void} onZoomK
 */
export async function renderSpiralAdvanced(svgEl, words, opts = {}, onZoomK) {
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  // Advanced mode: adaptive size from container by default
  // If you explicitly want fixed size, you can pass opts.fixedSize=true and opts.w/opts.h.
  const useFixed = !!opts.fixedSize;
  const { width, height } = useFixed
    ? { width: Math.floor(opts.w || 1100), height: Math.floor(opts.h || 700) }
    : getContainerSize(svgEl, opts.w || 1100, opts.h || 700);

  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

  // Root group for zoom/pan (same pattern as renderSpiral.js)
  const root = svg.append("g");
  attachZoom(svgEl, root, onZoomK);

  // Optional background
  if (opts.background) {
    root
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", height)
      .attr("fill", opts.background);
  }

  // Build shape mask
  const allowedMask = await buildAllowedMask(width, height, opts);

  // Normalize words
  const sorted = (words || [])
    .map((d) => ({
      text: d.text ?? d.word ?? "",
      size: d.size ?? d.fontSize ?? 12,
      weight: d.weight,
      color: d.color,
    }))
    .filter((d) => d.text && Number(d.size) > 0)
    .sort((a, b) => (b.size || 0) - (a.size || 0));

  const fontFamily =
    opts.fontFamily || "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  const fontWeight = opts.fontWeight ?? "normal";
  const fontStyle = opts.fontStyle || "normal";

  const colorFn = typeof opts.colorFn === "function" ? opts.colorFn : defaultColorFn;

  // Place via pixel occupancy
  const { placements } = placeWordsAdvanced(sorted, {
    width,
    height,
    allowedMask,
    wordPadding: opts.wordPadding ?? 2, // tight default
    maxTriesPerWord: opts.maxTriesPerWord ?? 6000,
    spiralStep: opts.spiralStep ?? 2,
    spiralTurns: opts.spiralTurns ?? 140,
    startJitter: opts.startJitter ?? 6,
    fontFamily,
    fontWeight,
    fontStyle,
    rotate: opts.rotate ?? 0,
    devicePixelRatio: opts.devicePixelRatio,
    colorFn: (w, i) => w.color || colorFn(w, i),
  });

  // Draw
  const gWords = root.append("g").attr("class", "advanced-spiral-words");

  gWords
    .selectAll("text.word")
    .data(placements, (d) => d.text)
    .enter()
    .append("text")
    .attr("class", "word")
    .style("font-size", (d) => `${d.fontSize}px`)
    .style("font-family", (d) => d.fontFamily)
    .style("font-weight", (d) => d.fontWeight)
    .style("font-style", (d) => d.fontStyle)
    .style("fill", (d, i) => d.color || colorFn(d, i))
    .attr("text-anchor", "start")
    // Use "hanging" so (x,y) approximates top-left for our sprite bbox
    .attr("dominant-baseline", "hanging")
    .attr("transform", (d) => {
      const r = d.rotate || 0;
      if (r) return `translate(${d.x},${d.y}) rotate(${r})`;
      return `translate(${d.x},${d.y})`;
    })
    .text((d) => d.text);

  // Optional mask debug sampling
  if (opts.debugMask === true) {
    const step = Math.max(2, Math.floor(opts.debugMaskStep ?? 6));
    const pts = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (allowedMask[y * width + x]) pts.push([x, y]);
      }
    }
    root
      .append("g")
      .attr("class", "advanced-spiral-mask-debug")
      .selectAll("circle")
      .data(pts)
      .enter()
      .append("circle")
      .attr("cx", (d) => d[0])
      .attr("cy", (d) => d[1])
      .attr("r", 0.6)
      .attr("fill", "rgba(0,0,0,0.08)");
  }
}
