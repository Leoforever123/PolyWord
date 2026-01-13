// frontend/src/advancedCloud/maskUtils.js
// Shape mask utilities for advanced word cloud placement.
//
// Mask convention:
// - Uint8Array length = width * height
// - 1 means "allowed/inside shape", 0 means "forbidden/outside shape"
//
// Notes:
// - This file is framework-agnostic (no React/D3 dependency).
// - Works in browser environment.

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  
  function idx(x, y, w) {
    return y * w + x;
  }
  
  /**
   * Create an offscreen canvas (works in modern browsers).
   */
  export function createOffscreenCanvas(width, height) {
    // OffscreenCanvas is not available in all environments, fallback to normal canvas.
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(width, height);
    }
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  
  /**
   * Convert canvas alpha to a binary mask.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {object} opts
   * @param {number} opts.alphaThreshold 0..255, default 1
   * @returns {Uint8Array} mask
   */
  export function alphaToMask(ctx, width, height, opts = {}) {
    const alphaThreshold = opts.alphaThreshold ?? 1;
    const img = ctx.getImageData(0, 0, width, height);
    const data = img.data;
    const mask = new Uint8Array(width * height);
    for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
      const a = data[i + 3];
      mask[p] = a >= alphaThreshold ? 1 : 0;
    }
    return mask;
  }
  
  /**
   * Convert canvas luminance to a binary mask.
   * Useful for black/white mask images where alpha is not used.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {object} opts
   * @param {number} opts.threshold 0..255, default 200 (lower = more inside for dark masks)
   * @param {"dark"|"light"} opts.mode - "dark": dark pixels are inside; "light": light pixels are inside
   * @returns {Uint8Array}
   */
  export function luminanceToMask(ctx, width, height, opts = {}) {
    const threshold = opts.threshold ?? 200;
    const mode = opts.mode ?? "dark"; // most common: black shape on white background
    const img = ctx.getImageData(0, 0, width, height);
    const data = img.data;
    const mask = new Uint8Array(width * height);
    for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
  
      // If fully transparent, treat as outside
      if (a === 0) {
        mask[p] = 0;
        continue;
      }
  
      // Perceptual luminance
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  
      if (mode === "dark") {
        mask[p] = lum <= threshold ? 1 : 0;
      } else {
        mask[p] = lum >= threshold ? 1 : 0;
      }
    }
    return mask;
  }
  
  /**
   * Basic binary morphology (dilate/erode) with Manhattan radius.
   * This is not the fastest possible implementation, but it's deterministic
   * and good enough for typical wordcloud canvas sizes (e.g., 800x600).
   *
   * @param {Uint8Array} mask input
   * @param {number} width
   * @param {number} height
   * @param {number} radius >=0 in pixels
   * @param {"dilate"|"erode"} op
   * @returns {Uint8Array} output
   */
  export function morphMask(mask, width, height, radius, op) {
    const r = Math.max(0, Math.floor(radius || 0));
    if (r === 0) return mask.slice();
  
    // For each pixel, check neighborhood in a diamond (Manhattan) radius.
    const out = new Uint8Array(width * height);
  
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let keep;
        if (op === "dilate") keep = 0;
        else keep = 1; // erode
  
        // Early exits: handle center first
        const center = mask[idx(x, y, width)];
        if (op === "dilate" && center === 1) {
          out[idx(x, y, width)] = 1;
          continue;
        }
        if (op === "erode" && center === 0) {
          out[idx(x, y, width)] = 0;
          continue;
        }
  
        // Neighborhood scan (diamond)
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) {
            if (op === "erode") {
              keep = 0; // outside considered 0 => erode fails
              break;
            }
            continue;
          }
          const rem = r - Math.abs(dy);
          const x0 = x - rem;
          const x1 = x + rem;
          for (let xx = x0; xx <= x1; xx++) {
            if (xx < 0 || xx >= width) {
              if (op === "erode") {
                keep = 0;
                break;
              }
              continue;
            }
            const v = mask[idx(xx, yy, width)];
            if (op === "dilate") {
              if (v === 1) {
                keep = 1;
                dy = r + 1; // break outer
                break;
              }
            } else {
              // erode
              if (v === 0) {
                keep = 0;
                dy = r + 1; // break outer
                break;
              }
            }
          }
        }
        out[idx(x, y, width)] = keep ? 1 : 0;
      }
    }
    return out;
  }
  
  /**
   * Render a built-in shape to mask.
   * @param {object} params
   * @param {number} params.width
   * @param {number} params.height
   * @param {"circle"|"heart"|"roundedRect"|"star"} params.shape
   * @param {number} [params.margin] padding to keep away from canvas edges
   * @param {number} [params.shapePadding] positive => erode (shrink allowed area), negative => dilate
   * @returns {{mask: Uint8Array, width: number, height: number}}
   */
  export function createBuiltInShapeMask(params) {
    const width = params.width;
    const height = params.height;
    const shape = params.shape || "circle";
    const margin = Math.max(0, Math.floor(params.margin ?? 8));
    const shapePadding = Math.floor(params.shapePadding ?? 0);
  
    const canvas = createOffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
  
    // Paint shape as opaque white on transparent background
    ctx.save();
    ctx.translate(width / 2, height / 2);
  
    const W = width - 2 * margin;
    const H = height - 2 * margin;
    const s = Math.min(W, H);
  
    ctx.fillStyle = "rgba(255,255,255,1)";
  
    if (shape === "circle") {
      const r = s * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    } else if (shape === "roundedRect") {
      const rw = W;
      const rh = H;
      const radius = Math.max(6, Math.floor(Math.min(rw, rh) * 0.12));
      roundRectPath(ctx, -rw / 2, -rh / 2, rw, rh, radius);
      ctx.fill();
    } else if (shape === "star") {
      const outerR = s * 0.5;
      const innerR = outerR * 0.45;
      starPath(ctx, 0, 0, 5, outerR, innerR);
      ctx.fill();
    } else if (shape === "heart") {
      // Parametric-ish heart by bezier curves
      const scale = s * 0.48;
      ctx.beginPath();
      ctx.moveTo(0, -0.25 * scale);
      ctx.bezierCurveTo(0.6 * scale, -0.9 * scale, 1.2 * scale, -0.1 * scale, 0, 0.75 * scale);
      ctx.bezierCurveTo(-1.2 * scale, -0.1 * scale, -0.6 * scale, -0.9 * scale, 0, -0.25 * scale);
      ctx.closePath();
      ctx.fill();
    } else {
      // fallback circle
      const r = s * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
  
    ctx.restore();
  
    let mask = alphaToMask(ctx, width, height, { alphaThreshold: 1 });
  
    // Apply shapePadding: positive -> erode (shrink allowed area), negative -> dilate
    if (shapePadding !== 0) {
      if (shapePadding > 0) {
        mask = morphMask(mask, width, height, shapePadding, "erode");
      } else {
        mask = morphMask(mask, width, height, -shapePadding, "dilate");
      }
    }
  
    return { mask, width, height };
  }
  
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = clamp(r, 0, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
  
  function starPath(ctx, cx, cy, spikes, outerR, innerR) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;
  
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerR;
      y = cy + Math.sin(rot) * outerR;
      ctx.lineTo(x, y);
      rot += step;
  
      x = cx + Math.cos(rot) * innerR;
      y = cy + Math.sin(rot) * innerR;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
  }
  
  /**
   * Load an image (File/Blob or URL) and convert to mask at target resolution.
   *
   * @param {object} params
   * @param {File|Blob|string} params.source - File/Blob from <input> or URL string
   * @param {number} params.width
   * @param {number} params.height
   * @param {"alpha"|"luminance"} [params.mode] - default "alpha"
   * @param {number} [params.alphaThreshold] for alpha mode
   * @param {number} [params.luminanceThreshold] for luminance mode
   * @param {"dark"|"light"} [params.luminanceMode] for luminance mode
   * @param {number} [params.shapePadding] positive => erode, negative => dilate
   * @returns {Promise<{mask: Uint8Array, width: number, height: number}>}
   */
  export async function loadImageMask(params) {
    const {
      source,
      width,
      height,
      mode = "alpha",
      alphaThreshold = 1,
      luminanceThreshold = 200,
      luminanceMode = "dark",
      shapePadding = 0,
    } = params;
  
    const img = await loadImageElement(source);
  
    const canvas = createOffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
  
    // Fit image into canvas (contain). You can change to "cover" if you prefer.
    ctx.clearRect(0, 0, width, height);
  
    const fit = containFit(img.width, img.height, width, height);
    ctx.drawImage(img, fit.dx, fit.dy, fit.dw, fit.dh);
  
    let mask;
    if (mode === "luminance") {
      mask = luminanceToMask(ctx, width, height, {
        threshold: luminanceThreshold,
        mode: luminanceMode,
      });
    } else {
      mask = alphaToMask(ctx, width, height, { alphaThreshold });
    }
  
    if (shapePadding !== 0) {
      if (shapePadding > 0) {
        mask = morphMask(mask, width, height, shapePadding, "erode");
      } else {
        mask = morphMask(mask, width, height, -shapePadding, "dilate");
      }
    }
  
    return { mask, width, height };
  }
  
  function containFit(srcW, srcH, dstW, dstH) {
    const s = Math.min(dstW / srcW, dstH / srcH);
    const dw = Math.round(srcW * s);
    const dh = Math.round(srcH * s);
    const dx = Math.floor((dstW - dw) / 2);
    const dy = Math.floor((dstH - dh) / 2);
    return { dx, dy, dw, dh };
  }
  
  async function loadImageElement(source) {
    // If it's a File/Blob, create object URL
    let url;
    if (typeof source === "string") {
      url = source;
    } else {
      url = URL.createObjectURL(source);
    }
  
    try {
      const img = new Image();
      img.decoding = "async";
      // Important: for remote URLs, CORS may taint canvas unless server allows it.
      if (typeof source === "string") img.crossOrigin = "anonymous";
  
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = url;
      });
      return img;
    } finally {
      if (typeof source !== "string") {
        URL.revokeObjectURL(url);
      }
    }
  }
  
  /**
   * Helper: visualize mask to a canvas context for debugging.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Uint8Array} mask
   * @param {number} width
   * @param {number} height
   * @param {object} opts
   * @param {string} [opts.insideColor] default "rgba(0,0,0,0.35)"
   * @param {string} [opts.outsideColor] default "rgba(0,0,0,0)"
   */
  export function drawMaskDebug(ctx, mask, width, height, opts = {}) {
    const insideColor = opts.insideColor ?? "rgba(0,0,0,0.35)";
    const outsideColor = opts.outsideColor ?? "rgba(0,0,0,0)";
  
    const img = ctx.createImageData(width, height);
    const data = img.data;
  
    // Parse insideColor roughly (assume rgba)
    // For simplicity, we just render inside as black with alpha 90 and outside transparent
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (mask[p]) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 90;
      } else {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
  
    ctx.putImageData(img, 0, 0);
  
    // If user passed explicit colors, overlay them (optional, keep lightweight)
    // (left as-is; current debug view is usually sufficient)
    void insideColor;
    void outsideColor;
  }
  