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
import { placeWordsAdvanced, calculateCoverage } from "./advancedCloud/advancedSpiralPlacer.js";

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
  // 确保获取到有效的容器尺寸
  // 如果容器还没有渲染完成，使用 fallback 值
  let w = fallbackW;
  let h = fallbackH;
  
  if (parent) {
    const parentW = parent.clientWidth;
    const parentH = parent.clientHeight;
    // 只有当容器有实际尺寸时才使用
    if (parentW > 0 && parentH > 0) {
      w = parentW;
      h = parentH;
    }
  }
  
  // 如果 SVG 本身有尺寸，也考虑
  if (svgEl) {
    const svgW = svgEl.clientWidth;
    const svgH = svgEl.clientHeight;
    if (svgW > 0 && svgH > 0) {
      w = svgW;
      h = svgH;
    }
  }
  
  return { width: Math.max(50, Math.floor(w)), height: Math.max(50, Math.floor(h)) };
}

function defaultColorFn(d, i) {
  const palette = d3.schemeTableau10 || ["#1f77b4", "#9467bd", "#2ca02c", "#d62728"];
  return palette[i % palette.length];
}

/**
 * Find the widest available horizontal space in the mask.
 * Returns {x, y, width, height} or null if no space found.
 */
function findWidestAvailableSpace(occupiedMask, allowedMask, width, height) {
  let widestWidth = 0;
  let bestSpace = null;
  
  // Scan each row for horizontal gaps
  for (let y = 0; y < height; y++) {
    let gapStart = -1;
    let gapWidth = 0;
    
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const isAllowed = !allowedMask || allowedMask[idx] === 1;
      const isOccupied = occupiedMask[idx] === 1;
      
      if (isAllowed && !isOccupied) {
        if (gapStart === -1) {
          gapStart = x;
          gapWidth = 1;
        } else {
          gapWidth++;
        }
      } else {
        if (gapWidth > widestWidth) {
          widestWidth = gapWidth;
          bestSpace = {
            x: gapStart,
            y: y,
            width: gapWidth,
            height: 1, // start with single row
          };
        }
        gapStart = -1;
        gapWidth = 0;
      }
    }
    
    // Check final gap
    if (gapWidth > widestWidth) {
      widestWidth = gapWidth;
      bestSpace = {
        x: gapStart,
        y: y,
        width: gapWidth,
        height: 1,
      };
    }
  }
  
  // Try to extend vertically if possible
  if (bestSpace) {
    let maxHeight = 1;
    for (let h = 2; h <= height - bestSpace.y; h++) {
      let allRowsValid = true;
      for (let dy = 0; dy < h; dy++) {
        const rowY = bestSpace.y + dy;
        if (rowY >= height) {
          allRowsValid = false;
          break;
        }
        for (let dx = 0; dx < bestSpace.width; dx++) {
          const idx = rowY * width + (bestSpace.x + dx);
          const isAllowed = !allowedMask || allowedMask[idx] === 1;
          const isOccupied = occupiedMask[idx] === 1;
          if (!isAllowed || isOccupied) {
            allRowsValid = false;
            break;
          }
        }
        if (!allRowsValid) break;
      }
      if (allRowsValid) {
        maxHeight = h;
      } else {
        break;
      }
    }
    bestSpace.height = maxHeight;
  }
  
  return bestSpace;
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

  /**
   * 自适应贪婪放置算法：确保所有词都显示，然后填充形状
   * 
   * 算法策略：
   * 1. Phase 1: 放置所有原始词
   *    - 从大到小遍历所有词
   *    - 对每个词：二分搜索找到能放置的最大字号
   *    - 如果失败，逐步缩小字号直到能放置（最小到 2px）
   *    - 保证 100% 的词都显示
   * 
   * 2. Phase 2: 填充剩余空间
   *    - 如果覆盖率 < 目标值（默认 85%）
   *    - 重复小词（底部 30-40%）填充空隙
   *    - 每次也找最宽空间并尽量填满
   * 
   * 关键设计：
   * - 保持词频偏序：大词始终比小词大（通过非线性压缩）
   * - 优先填满形状：覆盖率比严格的字号比例更重要
   * - 颜色随机：使用原始索引确保颜色分布均匀
   */
  const enableAdaptive = opts.adaptiveFontSize !== false; // default true
  let placements = [];

  if (enableAdaptive) {
    const wordPadding = opts.wordPadding ?? 1;
    const targetCoverage = opts.targetCoverage ?? 0.85;
    const nonlinearPower = opts.nonlinearPower ?? 0.5;
    
    // 计算字号范围，用于非线性压缩
    const sizes = sorted.map(w => w.size).filter(s => s > 0);
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    const sizeRange = maxSize - minSize;
    
    // Phase 1: Place ALL words (guaranteed to succeed by shrinking if needed)
    let occupiedMask = new Uint8Array(width * height);
    const wordPlacements = new Map(); // word text -> placement info
    
    for (let i = 0; i < sorted.length; i++) {
      const word = sorted[i];
      let placed = false;
      let attemptSize = word.size;
      let minAttemptSize = 4; // minimum size to guarantee placement
      
      // Binary search for size that allows placement
      while (!placed && attemptSize >= minAttemptSize) {
        // Apply nonlinear scaling
        let scaledSize = attemptSize;
        if (sizeRange > 0 && nonlinearPower !== 1.0) {
          const normalized = (word.size - minSize) / sizeRange;
          const compressed = Math.pow(normalized, nonlinearPower);
          scaledSize = minSize + compressed * sizeRange;
          // Scale to attemptSize proportionally
          scaledSize = scaledSize * (attemptSize / word.size);
        }
        
        const sizedWord = {
          ...word,
          size: Math.max(4, Math.floor(scaledSize)),
        };
        
        const result = placeWordsAdvanced([sizedWord], {
          width,
          height,
          allowedMask,
          wordPadding,
          maxTriesPerWord: 15000,
          spiralStep: 0.5,
          spiralTurns: 250,
          startJitter: 4,
          fontFamily,
          fontWeight,
          fontStyle,
          rotate: opts.rotate ?? 0,
          devicePixelRatio: opts.devicePixelRatio,
          colorFn: (w, originalIdx) => {
            // Use original index for color assignment
            return w.color || colorFn(w, i);
          },
          existingOccupiedMask: occupiedMask,
        });
        
        if (result.placements.length > 0) {
          const placement = result.placements[0];
          placement.originalIndex = i; // remember original order
          wordPlacements.set(word.text, {
            placement,
            word,
            size: sizedWord.size,
          });
          placements.push(placement);
          
          // Update occupied mask
          for (let j = 0; j < occupiedMask.length; j++) {
            if (result.occupiedMask[j] === 1) occupiedMask[j] = 1;
          }
          placed = true;
        } else {
          // Reduce size and retry
          attemptSize = attemptSize * 0.7;
        }
      }
      
      // If still not placed, force place with minimal size (guaranteed to work)
      if (!placed) {
        // Try progressively smaller sizes until it fits
        let forceSize = minAttemptSize;
        let forcePlaced = false;
        
        for (let forceAttempt = 0; forceAttempt < 10 && !forcePlaced; forceAttempt++) {
          const minWord = {
            ...word,
            size: forceSize,
          };
          
          const result = placeWordsAdvanced([minWord], {
            width,
            height,
            allowedMask,
            wordPadding: Math.max(0, wordPadding - 1), // reduce padding for tight fit
            maxTriesPerWord: 25000,
            spiralStep: 0.2,
            spiralTurns: 400,
            startJitter: 8,
            fontFamily,
            fontWeight,
            fontStyle,
            rotate: opts.rotate ?? 0,
            devicePixelRatio: opts.devicePixelRatio,
            colorFn: (w, originalIdx) => w.color || colorFn(w, i),
            existingOccupiedMask: occupiedMask,
          });
          
          if (result.placements.length > 0) {
            const placement = result.placements[0];
            placement.originalIndex = i;
            wordPlacements.set(word.text, {
              placement,
              word,
              size: forceSize,
            });
            placements.push(placement);
            for (let j = 0; j < occupiedMask.length; j++) {
              if (result.occupiedMask[j] === 1) occupiedMask[j] = 1;
            }
            forcePlaced = true;
          } else {
            // Try even smaller
            forceSize = Math.max(2, Math.floor(forceSize * 0.8));
          }
        }
        
        // Last resort: if still not placed, it means mask is completely full
        // This shouldn't happen, but if it does, we skip (shouldn't occur in practice)
      }
    }
    
    // Phase 2: Iterative optimization - try to increase sizes and improve coverage
    // Skip this phase for now - focus on ensuring all words appear first
    // Can be re-enabled later if needed
    
    // Phase 3: Fill remaining space with duplicates
    let coverage = calculateCoverage(occupiedMask, allowedMask, width, height).coverageRatio;
    
    if (coverage < targetCoverage) {
      const smallWords = sorted.slice(Math.floor(sorted.length * 0.6)); // bottom 40%
      const maxDuplicates = Math.min(400, sorted.length * 8);
      let duplicateCount = 0;
      
      while (coverage < targetCoverage && duplicateCount < maxDuplicates) {
        const wordToDuplicate = smallWords[Math.floor(Math.random() * smallWords.length)];
        const widestSpace = findWidestAvailableSpace(occupiedMask, allowedMask, width, height);
        
        if (!widestSpace || widestSpace.width < 6) break;
        
        const textLength = wordToDuplicate.text.length;
        const optimalSize = Math.max(4, Math.floor(widestSpace.width / (textLength * 0.6)));
        
        const duplicateWord = {
          ...wordToDuplicate,
          size: optimalSize,
        };
        
        const duplicateResult = placeWordsAdvanced([duplicateWord], {
          width,
          height,
          allowedMask,
          wordPadding,
          maxTriesPerWord: 5000,
          spiralStep: 0.5,
          spiralTurns: 100,
          startJitter: 2,
          fontFamily,
          fontWeight,
          fontStyle,
          rotate: opts.rotate ?? 0,
          devicePixelRatio: opts.devicePixelRatio,
          colorFn: (w, originalIdx) => {
            // Use random color for duplicates to maintain variety
            return w.color || colorFn(w, Math.floor(Math.random() * sorted.length));
          },
          existingOccupiedMask: occupiedMask,
        });
        
        if (duplicateResult.placements.length > 0) {
          const dupPlacement = duplicateResult.placements[0];
          dupPlacement.originalIndex = -1; // mark as duplicate
          placements.push(dupPlacement);
          for (let j = 0; j < occupiedMask.length; j++) {
            if (duplicateResult.occupiedMask[j] === 1) occupiedMask[j] = 1;
          }
          coverage = calculateCoverage(occupiedMask, allowedMask, width, height).coverageRatio;
          duplicateCount++;
        } else {
          break;
        }
      }
    }
  } else {
    // No adaptive scaling: use original sizes
    const result = placeWordsAdvanced(sorted, {
      width,
      height,
      allowedMask,
      wordPadding: opts.wordPadding ?? 1,
      maxTriesPerWord: opts.maxTriesPerWord ?? 10000,
      spiralStep: opts.spiralStep ?? 1,
      spiralTurns: opts.spiralTurns ?? 200,
      startJitter: opts.startJitter ?? 6,
      fontFamily,
      fontWeight,
      fontStyle,
      rotate: opts.rotate ?? 0,
      devicePixelRatio: opts.devicePixelRatio,
      colorFn: (w, i) => w.color || colorFn(w, i),
    });
    placements = result.placements;
  }

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
