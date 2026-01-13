/**
 * 词文本栅格化模块（Sprite Word Mask）
 * 
 * 功能：将文本栅格化为二进制像素 mask，用于像素级精确碰撞检测
 * 
 * 核心概念：
 * - Sprite：词的像素级表示，包含宽度、高度和二进制 mask
 * - Mask：Uint8Array，长度 = width * height，1=文字像素，0=透明像素
 * - 坐标系统：sprite 有自己的坐标系 (0..w-1, 0..h-1)，放置时左上角对齐到画布坐标 (x, y)
 * 
 * 使用场景：
 * - 高级螺旋线词云：需要像素级精确放置，避免重叠
 * - 形状约束词云：需要检查词的每个像素是否在允许区域内
 * 
 * 性能优化：
 * - LRU 缓存：相同参数的词只栅格化一次
 * - OffscreenCanvas：在后台线程栅格化，不阻塞主线程
 * 
 * 坐标约定：
 * - Sprite 坐标系：(0, 0) 在左上角
 * - 画布坐标系：放置时 sprite 的 (0, 0) 对齐到画布的 (x, y)
 * - 旋转：围绕 sprite 中心旋转，然后计算新的边界框
 */

import { createOffscreenCanvas } from "./maskUtils.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function makeKey(params) {
  const {
    text,
    fontFamily,
    fontWeight,
    fontStyle,
    fontSize,
    rotate,
    padding,
    devicePixelRatio,
  } = params;

  return [
    text,
    fontFamily || "",
    fontWeight || "",
    fontStyle || "",
    fontSize || 0,
    rotate || 0,
    padding || 0,
    devicePixelRatio || 1,
  ].join("|");
}

/**
 * LRU 缓存：最近最少使用缓存
 * 
 * 用途：缓存已栅格化的词 sprite，避免重复计算
 * 
 * 策略：
 * - 使用 Map 保持插入顺序（最近使用的在末尾）
 * - 访问时移动到末尾（刷新使用时间）
 * - 超过容量时删除最久未使用的项（第一个）
 * 
 * 性能：
 * - 相同字体、字号、文本的词只栅格化一次
 * - 显著提升重复词的放置速度
 */
class LRUCache {
  constructor(limit = 256) {
    this.limit = limit;
    this.map = new Map(); // key -> value，插入顺序 = 使用时间（末尾=最近）
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    // refresh recency
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
  }
  clear() {
    this.map.clear();
  }
}

const DEFAULT_CACHE = new LRUCache(400);

/**
 * @typedef {object} WordSprite
 * @property {string} text
 * @property {number} width sprite canvas width (px)
 * @property {number} height sprite canvas height (px)
 * @property {Uint8Array} mask length = width*height
 * @property {{x0:number,y0:number,x1:number,y1:number}} bbox tight bbox in sprite coords (inclusive)
 * @property {{drawX:number,drawY:number}} origin where text baseline drawing started (for debug)
 * @property {number} rotate degrees
 * @property {number} padding pixels added around ink
 */

/**
 * 获取词的 sprite（带缓存）
 * 
 * 功能：将文本栅格化为二进制 mask
 * 
 * 流程：
 * 1. 检查缓存：如果相同参数的词已栅格化，直接返回
 * 2. 栅格化：调用 rasterizeWordToMask 生成 sprite
 * 3. 缓存：将结果存入 LRU 缓存
 * 
 * 缓存键：基于所有参数（文本、字体、字号、旋转、padding 等）
 * 
 * @param {object} params 栅格化参数
 * @param {string} params.text 词文本
 * @param {string} [params.fontFamily] 字体族，如 "serif", "Arial"
 * @param {string|number} [params.fontWeight] 字重，如 400/"bold"
 * @param {string} [params.fontStyle] 字体样式，如 "normal"/"italic"
 * @param {number} params.fontSize 字号（CSS px）
 * @param {number} [params.rotate] 旋转角度（度），通常为 0（水平）
 * @param {number} [params.padding] 词周围额外空白像素（影响碰撞距离）
 * @param {number} [params.alphaThreshold] 透明度阈值 0..255，默认 16
 * @param {number} [params.devicePixelRatio] 设备像素比，默认 window.devicePixelRatio
 * @param {LRUCache} [params.cache] 可选的自定义缓存
 * @returns {WordSprite} sprite 对象
 */
export function getWordSprite(params) {
  const cache = params.cache || DEFAULT_CACHE;
  const devicePixelRatio = clamp(
    params.devicePixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1) ?? 1,
    1,
    3
  );

  const p = {
    ...params,
    rotate: params.rotate ?? 0,
    padding: Math.max(0, Math.floor(params.padding ?? 1)),
    alphaThreshold: Math.floor(params.alphaThreshold ?? 16),
    devicePixelRatio,
  };

  const key = makeKey(p);
  const cached = cache.get(key);
  if (cached) return cached;

  const sprite = rasterizeWordToMask(p);
  cache.set(key, sprite);
  return sprite;
}

/**
 * Optional: clear the global cache (useful if user changes font settings globally).
 */
export function clearWordSpriteCache() {
  DEFAULT_CACHE.clear();
}

/**
 * 栅格化词文本为二进制 mask
 * 
 * 算法流程：
 * 1. 测量文本尺寸：使用小 canvas 测量文本的宽度和高度
 * 2. 计算 sprite 尺寸：考虑旋转、padding，计算所需 canvas 大小
 * 3. 绘制文本：在 OffscreenCanvas 上绘制文本（考虑旋转）
 * 4. 提取 mask：从 canvas 的 alpha 通道提取二进制 mask
 * 5. 计算边界框：找到文字像素的紧密边界框
 * 
 * 关键点：
 * - 使用 OffscreenCanvas 避免影响主 canvas
 * - 旋转时围绕文本中心旋转，然后计算新的边界框
 * - 只提取非透明像素（alpha >= threshold）作为 mask
 * - padding 在 mask 周围添加空白，用于控制词间距
 * 
 * @param {object} params 栅格化参数
 * @returns {WordSprite} sprite 对象
 */
function rasterizeWordToMask(params) {
  const {
    text,
    fontFamily = "serif",
    fontWeight = "normal",
    fontStyle = "normal",
    fontSize,
    rotate = 0,
    padding = 1,
    alphaThreshold = 16,
    devicePixelRatio = 1,
  } = params;

  // 参数安全处理
  const safeText = (text ?? "").toString();
  const safeSize = Math.max(1, Number(fontSize || 1));
  const rot = ((rotate % 360) + 360) % 360; // 规范化角度到 [0, 360)

  // 步骤 1: 测量文本尺寸
  // 使用小 canvas 快速测量文本的宽度和高度
  const measCanvas = createOffscreenCanvas(16, 16);
  const mctx = measCanvas.getContext("2d");
  mctx.textBaseline = "alphabetic"; // 基线对齐方式
  mctx.textAlign = "left"; // 左对齐

  const font = `${fontStyle} ${fontWeight} ${safeSize}px ${fontFamily}`;
  mctx.font = font;

  const metrics = mctx.measureText(safeText);

  // Fallbacks for browsers that don't provide these metrics consistently
  const ascent = metrics.actualBoundingBoxAscent ?? safeSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent ?? safeSize * 0.2;
  const left = metrics.actualBoundingBoxLeft ?? 0;
  const right = metrics.actualBoundingBoxRight ?? metrics.width ?? safeSize * safeText.length * 0.6;

  const inkW = Math.ceil(left + right);
  const inkH = Math.ceil(ascent + descent);

  // Add padding and some safety border to avoid clipping due to hinting/subpixel
  const safety = 2;
  let w = inkW + 2 * (padding + safety);
  let h = inkH + 2 * (padding + safety);

  // If rotated 90/270, swap w/h (rough estimate)
  if (rot === 90 || rot === 270) {
    const tmp = w;
    w = h;
    h = tmp;
  }

  // Use CSS px directly for coordinate consistency with canvas
  // For better quality, we could use DPR scaling, but that complicates coordinate conversion
  // Using CSS px ensures sprite coordinates match canvas coordinates exactly
  const W = Math.max(8, Math.ceil(w));
  const H = Math.max(8, Math.ceil(h));

  const canvas = createOffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  ctx.clearRect(0, 0, W, H);
  // No DPR scaling - use CSS px directly for coordinate consistency

  ctx.save();
  // Drawing settings: render solid alpha
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = font;

  // Place text roughly in center with baseline control.
  const cx = w / 2;
  const cy = h / 2;

  ctx.translate(cx, cy);
  if (rot !== 0) {
    ctx.rotate((rot * Math.PI) / 180);
  }

  // We want text's ink bbox centered at (0,0), but metrics are relative to baseline.
  // Compute draw point so that ink bbox center aligns near origin.
  //
  // Ink bbox in local coords (no rotation):
  // x from -left to right, y from -ascent to descent (baseline at y=0)
  const inkCx = (-left + right) / 2;
  const inkCy = (-ascent + descent) / 2;

  const drawX = -inkCx;
  const drawY = -inkCy;

  ctx.fillText(safeText, drawX, drawY);
  ctx.restore();

  // 2) Convert alpha to mask + compute tight bbox
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;

  const mask = new Uint8Array(W * H);

  let x0 = W, y0 = H, x1 = -1, y1 = -1;

  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const p = row + x;
      const a = data[p * 4 + 3];
      if (a >= alphaThreshold) {
        mask[p] = 1;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }

  // If the word produced no pixels (edge case), create a 1x1 empty bbox
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = 0;
    y1 = 0;
  }

  // 3) Crop to tight bbox + re-add padding (all in CSS px)
  const padPx = Math.max(0, Math.floor(padding));
  const cropX0 = clamp(x0 - padPx, 0, W - 1);
  const cropY0 = clamp(y0 - padPx, 0, H - 1);
  const cropX1 = clamp(x1 + padPx, 0, W - 1);
  const cropY1 = clamp(y1 + padPx, 0, H - 1);

  const CW = cropX1 - cropX0 + 1;
  const CH = cropY1 - cropY0 + 1;

  const cropped = new Uint8Array(CW * CH);
  for (let yy = 0; yy < CH; yy++) {
    const srcRow = (cropY0 + yy) * W + cropX0;
    const dstRow = yy * CW;
    cropped.set(mask.subarray(srcRow, srcRow + CW), dstRow);
  }

  // bbox in the cropped sprite coords (tight-ish, includes padding now)
  const bbox = {
    x0: padPx,
    y0: padPx,
    x1: CW - 1 - padPx,
    y1: CH - 1 - padPx,
  };

  /** @type {import("./spriteWordMask.js").WordSprite} */
  const sprite = {
    text: safeText,
    width: CW,
    height: CH,
    mask: cropped,
    bbox,
    origin: {
      // These are in CSS px before DPR; provided only for debugging
      drawX,
      drawY,
    },
    rotate: rot,
    padding,
  };

  return sprite;
}
