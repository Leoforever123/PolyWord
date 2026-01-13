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
 */

/**
 * Place words using spiral + pixel occupancy + shape constraint.
 *
 * @param {WordInput[]} words should already be filtered/sorted; typically sort by size desc
 * @param {PlaceOptions} opts
 * @returns {{ placements: Placement[], occupiedMask: Uint8Array }}
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

  const wordPadding = Math.max(0, Math.floor(opts.wordPadding ?? 2)); // tight default = 2
  const maxTriesPerWord = Math.max(50, Math.floor(opts.maxTriesPerWord ?? 5000));
  const spiralStep = Math.max(1, Number(opts.spiralStep ?? 2));
  const spiralTurns = Math.max(1, Number(opts.spiralTurns ?? 120));
  const startJitter = Math.max(0, Number(opts.startJitter ?? 4));
  const devicePixelRatio = opts.devicePixelRatio;

  // Occupancy grid: 1 means occupied by previously placed words.
  const occupiedMask = new Uint8Array(width * height);

  const placements = [];

  // Center start
  const cx = width / 2;
  const cy = height / 2;

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

    // Candidate generator: spiral around center (with slight random jitter per word)
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
    // else: skip the word if cannot place. Later we can add fallback:
    // - reduce font size and retry
    // - relax padding
    // - increase maxTries
  }

  return { placements, occupiedMask };
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

  // Spiral parameters:
  // Use an Archimedean spiral: r = a + b * t
  // where t increases; step controls b.
  const maxT = spiralTurns * Math.PI * 2;

  let tries = 0;

  for (let t = 0; t <= maxT && tries < maxTries; t += 0.07) {
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
 * Check both:
 * - shape constraint: word pixels must be inside allowedMask (if provided)
 * - collision: word pixels must not overlap occupiedMask
 */
function canPlaceAt(sprite, x, y, canvasW, canvasH, allowedMask, occupiedMask) {
  const sw = sprite.width;
  const sh = sprite.height;
  const sm = sprite.mask;

  // (x,y) guaranteed inside canvas by caller, but keep safe bounds if used elsewhere
  if (x < 0 || y < 0 || x + sw > canvasW || y + sh > canvasH) return false;

  // Tight bbox to reduce scan
  const bb = sprite.bbox;
  const x0 = clampInt(bb.x0, 0, sw - 1);
  const y0 = clampInt(bb.y0, 0, sh - 1);
  const x1 = clampInt(bb.x1, 0, sw - 1);
  const y1 = clampInt(bb.y1, 0, sh - 1);

  for (let yy = y0; yy <= y1; yy++) {
    const sy = yy * sw;
    const cy = (y + yy) * canvasW;
    for (let xx = x0; xx <= x1; xx++) {
      const sp = sy + xx;
      if (sm[sp] !== 1) continue;

      const cp = cy + (x + xx);

      // Shape constraint
      if (allowedMask && allowedMask[cp] !== 1) return false;

      // Collision constraint
      if (occupiedMask[cp] === 1) return false;
    }
  }

  return true;
}

/**
 * OR sprite pixels into occupiedMask.
 */
function stampOccupied(sprite, x, y, canvasW, occupiedMask) {
  const sw = sprite.width;
  const sh = sprite.height;
  const sm = sprite.mask;

  const bb = sprite.bbox;
  const x0 = clampInt(bb.x0, 0, sw - 1);
  const y0 = clampInt(bb.y0, 0, sh - 1);
  const x1 = clampInt(bb.x1, 0, sw - 1);
  const y1 = clampInt(bb.y1, 0, sh - 1);

  for (let yy = y0; yy <= y1; yy++) {
    const sy = yy * sw;
    const cy = (y + yy) * canvasW;
    for (let xx = x0; xx <= x1; xx++) {
      const sp = sy + xx;
      if (sm[sp] !== 1) continue;
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
