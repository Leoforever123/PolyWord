// frontend/src/advancedCloud/spriteWordMask.js
//
// Rasterize a word into a binary pixel mask ("sprite") for pixel-perfect collision.
// Intended for advanced word cloud placement (mask + occupancy grid).
//
// Sprite mask convention:
// - Uint8Array length = spriteWidth * spriteHeight
// - 1 means "ink pixel" (occupied by this word), 0 means empty
//
// Coordinate notes:
// - Sprite is in its own coordinate system (0..w-1, 0..h-1)
// - The caller places it at some (x, y) in the world canvas by aligning sprite's
//   top-left to (x, y) (or use returned bbox/offsets as needed).

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
 * Simple LRU cache.
 */
class LRUCache {
  constructor(limit = 256) {
    this.limit = limit;
    this.map = new Map(); // key -> value, insertion order = recency
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
 * Rasterize a word into a sprite mask.
 *
 * @param {object} params
 * @param {string} params.text
 * @param {string} [params.fontFamily] e.g. "serif", "Arial"
 * @param {string|number} [params.fontWeight] e.g. 400/"bold"
 * @param {string} [params.fontStyle] e.g. "normal"/"italic"
 * @param {number} params.fontSize in px (CSS px in the final SVG; sprite uses DPR scaling)
 * @param {number} [params.rotate] degrees, typically 0 (you want all horizontal)
 * @param {number} [params.padding] extra empty pixels around ink (affects collision distance)
 * @param {number} [params.alphaThreshold] 0..255, default 16
 * @param {number} [params.devicePixelRatio] defaults to window.devicePixelRatio (clamped)
 * @param {LRUCache} [params.cache] optional custom cache
 * @returns {WordSprite}
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

  // Safety
  const safeText = (text ?? "").toString();
  const safeSize = Math.max(1, Number(fontSize || 1));
  const rot = ((rotate % 360) + 360) % 360;

  // 1) Measure text in a small canvas to estimate required sprite size
  const measCanvas = createOffscreenCanvas(16, 16);
  const mctx = measCanvas.getContext("2d");
  mctx.textBaseline = "alphabetic";
  mctx.textAlign = "left";

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

  // Apply DPR scaling for more accurate mask at high zoom
  const W = Math.max(8, Math.ceil(w * devicePixelRatio));
  const H = Math.max(8, Math.ceil(h * devicePixelRatio));

  const canvas = createOffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

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

  // 3) Crop to tight bbox + re-add padding (in DPR pixels) so caller has margin control
  const padPx = Math.max(0, Math.floor(padding * devicePixelRatio));
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
