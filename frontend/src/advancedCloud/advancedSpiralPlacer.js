// frontend/src/advancedCloud/advancedSpiralPlacer.js
//
// Advanced spiral placer with:
// 1) shape mask constraint (allowedMask)
// 2) pixel-perfect collision via occupancy grid
//
// This module is independent from existing d3-cloud usage.
// We'll add a new render entry later (renderSpiralAdvanced.js).

import { getWordSprite } from "./spriteWordMask.js";

/**
 * @typedef {object} WordInput
 * @property {string} text
 * @property {number} size font size in px (CSS px)
 * @property {number} [weight] optional
 * @property {string} [color] optional
 */

/**
 * @typedef {object} Placement
 * @property {string} text
 * @property {number} x top-left x in canvas pixels
 * @property {number} y top-left y in canvas pixels
 * @property {number} w sprite width in pixels (DPR pixels in sprite space, but mapped to canvas pixels 1:1 here)
 * @property {number} h sprite height
 * @property {number} fontSize
 * @property {string} fontFamily
 * @property {string|number} fontWeight
 * @property {string} fontStyle
 * @property {number} rotate
 * @property {string} [color]
 * @property {number} [weight]
 */

/**
 * @typedef {object} PlaceOptions
 * @property {number} width canvas width in px
 * @property {number} height canvas height in px
 * @property {Uint8Array|null} [allowedMask] length width*height; 1 inside shape. If null, allow all.
 * @property {number} [wordPadding] pixels around each word (tight=1..2)
 * @property {number} [maxTriesPerWord] max candidate positions to test per word
 * @property {number} [spiralStep] step size in px for spiral radius
 * @property {number} [spiralTurns] affects how far spiral expands (used to cap tries)
 * @property {number} [startJitter] random jitter around center start (px)
 * @property {number} [seed] not used (placeholder if you later want deterministic RNG)
 * @property {string} [fontFamily]
 * @property {string|number} [fontWeight]
 * @property {string} [fontStyle]
 * @property {number} [rotate] degrees; you want 0 for all horizontal
 * @property {number} [devicePixelRatio] forwarded to sprite generator
 * @property {(w: WordInput, i:number) => string} [colorFn]
 * @property {Uint8Array} [existingOccupiedMask] reuse existing occupied mask for incremental placement
 * @property {{x:number,y:number,width:number,height:number}} [preferredLocation] hint for preferred placement location
 */

/**
 * Calculate coverage ratio: how much of allowed area is occupied.
 * @param {Uint8Array} occupiedMask
 * @param {Uint8Array|null} allowedMask
 * @param {number} width
 * @param {number} height
 * @returns {{ coverageRatio: number, allowedArea: number, occupiedArea: number }}
 */
export function calculateCoverage(occupiedMask, allowedMask, width, height) {
  let allowedArea = 0;
  let occupiedArea = 0;

  if (allowedMask) {
    for (let i = 0; i < allowedMask.length; i++) {
      if (allowedMask[i] === 1) {
        allowedArea++;
        if (occupiedMask[i] === 1) {
          occupiedArea++;
        }
      }
    }
  } else {
    // No mask: entire canvas is allowed
    allowedArea = width * height;
    for (let i = 0; i < occupiedMask.length; i++) {
      if (occupiedMask[i] === 1) {
        occupiedArea++;
      }
    }
  }

  const coverageRatio = allowedArea > 0 ? occupiedArea / allowedArea : 0;
  return { coverageRatio, allowedArea, occupiedArea };
}

/**
 * 高级螺旋线放置算法：像素级精确放置 + 形状约束
 * 
 * 核心算法流程：
 * 1. 对每个词生成 sprite（二进制 mask）
 *    - 使用 OffscreenCanvas 栅格化文本
 *    - 生成像素级精确的碰撞 mask
 * 
 * 2. 螺旋线搜索候选位置
 *    - 从中心（或指定位置）开始
 *    - 使用阿基米德螺旋向外扩展：r = a + b*t
 *    - 步长越小，搜索越密集
 * 
 * 3. 像素级碰撞检测
 *    - 检查 sprite 的所有像素是否与已占用区域重叠
 *    - 检查是否在 allowedMask 范围内
 *    - 如果通过，标记占用并返回位置
 * 
 * 4. 更新占用网格
 *    - 成功放置后，将 sprite 的所有像素标记为已占用
 *    - 维护 occupiedMask 用于后续词的碰撞检测
 * 
 * 性能优化：
 * - 使用 Uint8Array 存储 mask（内存高效）
 * - 螺旋线搜索有最大尝试次数限制
 * - 支持增量放置（existingOccupiedMask）用于重复词填充
 *
 * @param {WordInput[]} words should already be filtered/sorted; typically sort by size desc
 * @param {PlaceOptions} opts
 * @returns {{ placements: Placement[], occupiedMask: Uint8Array, stats: { placedCount: number, totalCount: number, coverageRatio: number } }}
 */
export function placeWordsAdvanced(words, opts) {
  const width = Math.max(1, Math.floor(opts.width));
  const height = Math.max(1, Math.floor(opts.height));
  const allowedMask = opts.allowedMask || null;

  if (allowedMask && allowedMask.length !== width * height) {
    throw new Error(
      `allowedMask length mismatch: expected ${width * height}, got ${allowedMask.length}`
    );
  }

  const fontFamily = opts.fontFamily || "serif";
  const fontWeight = opts.fontWeight ?? "normal";
  const fontStyle = opts.fontStyle || "normal";
  const rotate = opts.rotate ?? 0;

  const wordPadding = Math.max(0, Math.floor(opts.wordPadding ?? 1)); // tight default = 1 for closer packing
  const maxTriesPerWord = Math.max(50, Math.floor(opts.maxTriesPerWord ?? 10000)); // increased for better coverage
  const spiralStep = Math.max(0.5, Number(opts.spiralStep ?? 1)); // smaller step for denser search
  const spiralTurns = Math.max(1, Number(opts.spiralTurns ?? 200)); // more turns for better coverage
  const startJitter = Math.max(0, Number(opts.startJitter ?? 4));
  const devicePixelRatio = opts.devicePixelRatio;

  /**
   * 占用网格（Occupancy Grid）
   * - 一维数组，长度 = width * height
   * - 每个元素代表一个像素：0=空闲，1=已占用
   * - 索引计算：idx = y * width + x
   * 
   * 支持增量放置：
   * - 如果提供了 existingOccupiedMask，则复制它
   * - 用于重复词填充场景（Phase 2）
   */
  const occupiedMask = opts.existingOccupiedMask 
    ? new Uint8Array(opts.existingOccupiedMask) // copy existing mask
    : new Uint8Array(width * height);

  const placements = [];

  // Center start (or use preferred location if provided)
  const preferredLocation = opts.preferredLocation || null;
  let cx = width / 2;
  let cy = height / 2;
  
  if (preferredLocation) {
    cx = preferredLocation.x + preferredLocation.width / 2;
    cy = preferredLocation.y + preferredLocation.height / 2;
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const size = Math.max(1, Number(w.size || 1));

    const sprite = getWordSprite({
      text: w.text,
      fontFamily,
      fontWeight,
      fontStyle,
      fontSize: size,
      rotate,
      padding: wordPadding,
      devicePixelRatio,
    });

    // Candidate generator: spiral around center (or preferred location)
    const jx = (Math.random() * 2 - 1) * startJitter;
    const jy = (Math.random() * 2 - 1) * startJitter;

    const placed = tryPlaceOne({
      sprite,
      width,
      height,
      cx: cx + jx,
      cy: cy + jy,
      maxTries: maxTriesPerWord,
      spiralStep,
      spiralTurns,
      allowedMask,
      occupiedMask,
    });

    if (placed) {
      const color = typeof opts.colorFn === "function" ? opts.colorFn(w, i) : w.color;

      placements.push({
        text: w.text,
        x: placed.x,
        y: placed.y,
        w: sprite.width,
        h: sprite.height,
        fontSize: size,
        fontFamily,
        fontWeight,
        fontStyle,
        rotate,
        color,
        weight: w.weight,
      });
    }
    // else: skip the word if cannot place
  }

  const stats = {
    placedCount: placements.length,
    totalCount: words.length,
    ...calculateCoverage(occupiedMask, allowedMask, width, height),
  };

  return { placements, occupiedMask, stats };
}

/**
 * Attempt to place a single sprite on the canvas.
 * Returns {x,y} top-left if success, otherwise null.
 */
function tryPlaceOne(params) {
  const {
    sprite,
    width,
    height,
    cx,
    cy,
    maxTries,
    spiralStep,
    spiralTurns,
    allowedMask,
    occupiedMask,
  } = params;

  const sw = sprite.width;
  const sh = sprite.height;

  // Quick reject: if sprite larger than canvas, cannot place
  if (sw > width || sh > height) return null;

  // We align sprite top-left at (x,y).
  // We want spiral to move around (cx,cy) as the sprite center.
  const halfW = sw / 2;
  const halfH = sh / 2;

  /**
   * 阿基米德螺旋线参数化
   * 
   * 螺旋方程：
   *   x(t) = cx + r(t) * cos(t)
   *   y(t) = cy + r(t) * sin(t)
   *   其中 r(t) = spiralStep * t
   * 
   * 参数说明：
   * - t: 角度参数，从 0 到 maxT（2π * spiralTurns）
   * - tStep: 角度步长，越小搜索越密集（默认 0.03，约每度 1 个点）
   * - spiralStep: 径向步长，控制螺旋疏密（默认 1px）
   * 
   * 搜索策略：
   * - 从中心开始，沿螺旋线向外搜索
   * - 每次尝试一个位置，检查是否可放置
   * - 找到第一个可行位置即返回
   */
  const maxT = spiralTurns * Math.PI * 2;

  let tries = 0;
  // 角度步长：越小搜索越密集（0.03 约等于每度 1 个候选点）
  const tStep = 0.03;

  for (let t = 0; t <= maxT && tries < maxTries; t += tStep) {
    // radius grows with t
    const r = spiralStep * t;

    const xCenter = cx + r * Math.cos(t);
    const yCenter = cy + r * Math.sin(t);

    const x = Math.round(xCenter - halfW);
    const y = Math.round(yCenter - halfH);

    tries++;

    if (!insideCanvasRect(x, y, sw, sh, width, height)) continue;

    if (canPlaceAt(sprite, x, y, width, height, allowedMask, occupiedMask)) {
      // Commit to occupied
      stampOccupied(sprite, x, y, width, occupiedMask);
      return { x, y };
    }
  }

  return null;
}

function insideCanvasRect(x, y, w, h, width, height) {
  return x >= 0 && y >= 0 && x + w <= width && y + h <= height;
}

/**
 * 像素级碰撞检测：检查 sprite 在指定位置是否可以放置
 * 
 * 检测两个条件：
 * 1. 形状约束：sprite 的所有非透明像素必须在 allowedMask 范围内
 * 2. 碰撞检测：sprite 的所有非透明像素不能与 occupiedMask 重叠
 * 
 * 算法流程：
 * - 遍历 sprite 的每个像素（逐行逐列）
 * - 对于每个非透明像素（sm[sp] === 1）：
 *   - 计算其在画布上的坐标：cp = (y + yy) * canvasW + (x + xx)
 *   - 检查是否在 allowedMask 内（如果提供了 allowedMask）
 *   - 检查是否与 occupiedMask 重叠
 * - 如果所有像素都通过检测，返回 true；否则返回 false
 * 
 * 性能优化：
 * - 跳过透明像素（sm[sp] !== 1），只检测实际文字像素
 * - 使用一维数组索引，避免二维数组访问开销
 * 
 * @param {object} sprite sprite 对象，包含 width, height, mask
 * @param {number} x sprite 左上角 x 坐标
 * @param {number} y sprite 左上角 y 坐标
 * @param {number} canvasW 画布宽度
 * @param {number} canvasH 画布高度
 * @param {Uint8Array|null} allowedMask 形状 mask（1=允许，0=禁止）
 * @param {Uint8Array} occupiedMask 占用 mask（1=已占用，0=空闲）
 * @returns {boolean} 是否可以放置
 */
function canPlaceAt(sprite, x, y, canvasW, canvasH, allowedMask, occupiedMask) {
  const sw = sprite.width;
  const sh = sprite.height;
  const sm = sprite.mask;

  // 边界检查：确保 sprite 完全在画布内
  if (x < 0 || y < 0 || x + sw > canvasW || y + sh > canvasH) return false;

  /**
   * 像素级扫描：遍历 sprite 的所有像素
   * 
   * 索引计算：
   * - sprite 内坐标：(xx, yy)
   * - sprite mask 索引：sp = yy * sw + xx
   * - 画布坐标：(x + xx, y + yy)
   * - 画布 mask 索引：cp = (y + yy) * canvasW + (x + xx)
   * 
   * 关键：只检测非透明像素（sm[sp] === 1）
   * 这样可以处理不规则形状的文字（如字母 'i' 的点、'a' 的洞等）
   */
  for (let yy = 0; yy < sh; yy++) {
    const sy = yy * sw;  // sprite 当前行的起始索引
    const cy = (y + yy) * canvasW;  // 画布当前行的起始索引
    for (let xx = 0; xx < sw; xx++) {
      const sp = sy + xx;  // sprite 像素索引
      if (sm[sp] !== 1) continue; // 跳过透明像素

      const cp = cy + (x + xx);  // 画布像素索引

      // 形状约束：word 像素必须在 allowedMask 范围内
      if (allowedMask && allowedMask[cp] !== 1) return false;

      // Collision constraint: word pixel must not overlap existing words
      if (occupiedMask[cp] === 1) return false;
    }
  }

  return true;
}

/**
 * OR sprite pixels into occupiedMask.
 * Mark all non-transparent pixels as occupied.
 */
function stampOccupied(sprite, x, y, canvasW, occupiedMask) {
  const sw = sprite.width;
  const sh = sprite.height;
  const sm = sprite.mask;

  // Mark all non-transparent pixels
  for (let yy = 0; yy < sh; yy++) {
    const sy = yy * sw;
    const cy = (y + yy) * canvasW;
    for (let xx = 0; xx < sw; xx++) {
      const sp = sy + xx;
      if (sm[sp] !== 1) continue; // Skip transparent pixels
      const cp = cy + (x + xx);
      occupiedMask[cp] = 1;
    }
  }
}

function clampInt(v, lo, hi) {
  v = v | 0;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
