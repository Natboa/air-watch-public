/**
 * SVG → the PNG the panel shows. The TRMNL OG panel takes a 1-bit image
 * (black/white) or, on firmware ≥ 1.6, a 2-bit one (4 greys); which one the
 * kit really shows is to be checked on the device, so both are produced.
 *
 * Drawing and text are snapped to the nearest grey, which keeps lines crisp
 * (and, in 2-bit, leaves anti-aliased edges as real greys). Photos — today
 * only the moon — are Floyd–Steinberg dithered instead, inside the circles
 * the caller passes, since snapping a photo leaves flat blobs. The PNG is
 * written at the panel's own bit depth (greyscale 1 or 2 bits per pixel).
 */
import { Resvg } from "@resvg/resvg-js";
import { deflateSync } from "zlib";

const FONTS = `${import.meta.dir}/../assets/fonts`;
const FONT_FILES = ["Regular", "Bold", "Black"].map((w) => `${FONTS}/Heebo-${w}.ttf`);

export type Bits = 1 | 2;
export interface Circle { cx: number; cy: number; r: number }

const levels = (bits: Bits) => (bits === 1 ? [0, 255] : [0, 85, 170, 255]);

/**
 * Greys (one byte per pixel, 0–255) → greys on the panel's levels: dithered
 * inside the circles, snapped to the nearest level everywhere else.
 */
export function quantize(grey: Uint8Array, w: number, h: number, bits: Bits, dither: Circle[] = []): Uint8Array {
  const lv = levels(bits), step = 255 / (lv.length - 1);
  const snap = (v: number) => lv[Math.max(0, Math.min(lv.length - 1, Math.round(v / step)))];
  const inside = new Uint8Array(w * h);
  for (const c of dither) {
    for (let y = Math.max(0, Math.floor(c.cy - c.r)); y <= Math.min(h - 1, Math.ceil(c.cy + c.r)); y++) {
      for (let x = Math.max(0, Math.floor(c.cx - c.r)); x <= Math.min(w - 1, Math.ceil(c.cx + c.r)); x++) {
        if ((x + 0.5 - c.cx) ** 2 + (y + 0.5 - c.cy) ** 2 <= c.r * c.r) inside[y * w + x] = 1;
      }
    }
  }
  const err = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) { out[i] = snap(grey[i]); continue; }
      const v = Math.max(0, Math.min(255, grey[i] + err[i]));
      const q = snap(v), e = v - q;
      out[i] = q;
      // Error spreads only to neighbours inside the photo, so it never leaks onto the drawing.
      const push = (dx: number, dy: number, f: number) => {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < w && yy < h && inside[yy * w + xx]) err[yy * w + xx] += e * f;
      };
      push(1, 0, 7 / 16); push(-1, 1, 3 / 16); push(0, 1, 5 / 16); push(1, 1, 1 / 16);
    }
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Greys already on the panel's levels → a greyscale PNG at 1 or 2 bits per pixel. */
export function encodePng(grey: Uint8Array, w: number, h: number, bits: Bits): Uint8Array {
  const perByte = 8 / bits, stride = Math.ceil(w / perByte), maxCode = (1 << bits) - 1;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);                                // filter byte 0 (none), then packed pixels, MSB first
    for (let x = 0; x < w; x++) {
      const code = Math.round((grey[y * w + x] / 255) * maxCode);
      raw[row + 1 + Math.floor(x / perByte)] |= code << (8 - bits * (1 + (x % perByte)));
    }
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr.set([bits, 0, 0, 0, 0], 8);                               // bit depth, greyscale, deflate, no filter, no interlace
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Render an SVG and turn it into the panel's PNG. */
export function svgToEinkPng(svg: string, bits: Bits, dither: Circle[] = []): Uint8Array {
  const img = new Resvg(svg, { background: "#ffffff", font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Heebo" } }).render();
  const { width: w, height: h } = img, px = img.pixels;
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
  return encodePng(quantize(grey, w, h, bits, dither), w, h, bits);
}
