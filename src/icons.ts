/**
 * Icons for the e-ink dashboard. Weather/UI icons are Lucide (ISC, see
 * assets/icons/LICENSE-lucide.txt), drawn as 24×24 strokes and scaled; the
 * window icon is ours. Everything is pure black on white for a 1-bit panel.
 */
import { readFileSync } from "fs";

const DIR = `${import.meta.dir}/../assets/icons`;
const cache = new Map<string, string>();

function inner(name: string): string {
  let body = cache.get(name);
  if (body === undefined) {
    let raw: string;
    try { raw = readFileSync(`${DIR}/${name}.svg`, "utf8"); }
    catch { throw new Error(`icon not found: ${name}`); }
    body = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
    cache.set(name, body);
  }
  return body;
}

/**
 * A Lucide icon `size` px wide at (x, y). `stroke` is in output pixels, so
 * icons of different sizes keep the same line weight.
 */
export function icon(name: string, x: number, y: number, size: number, opts: { stroke?: number; rotate?: number; color?: string } = {}): string {
  const s = size / 24;
  const sw = ((opts.stroke ?? 2.5) / s).toFixed(2).replace(/\.?0+$/, "");
  const rot = opts.rotate ? ` rotate(${opts.rotate} 12 12)` : "";
  return `<g transform="translate(${x} ${y}) scale(${+s.toFixed(4)})${rot}" fill="none" stroke="${opts.color ?? "#000"}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner(name)}</g>`;
}

/** A window, `size` px square: open = sash swung out, closed = shut and latched. */
export function windowIcon(open: boolean, x: number, y: number, size: number): string {
  const s = size / 80;
  const frame = `<rect x="6" y="6" width="68" height="68" rx="4" fill="none" stroke="#000" stroke-width="5"/>`;
  const body = open
    // Left half as glass, right sash swung outwards (drawn in perspective), plus moving-air lines.
    ? `<line x1="40" y1="6" x2="40" y2="74" stroke="#000" stroke-width="4"/>
       <path d="M40 10 L62 18 L62 62 L40 70 Z" fill="#fff" stroke="#000" stroke-width="4" stroke-linejoin="round"/>
       <path d="M14 30 h16 M14 40 h20 M14 50 h12" stroke="#000" stroke-width="3.5" stroke-linecap="round"/>`
    // Two closed panes with a solid latch between them.
    : `<line x1="40" y1="6" x2="40" y2="74" stroke="#000" stroke-width="4"/>
       <line x1="6" y1="40" x2="74" y2="40" stroke="#000" stroke-width="4"/>
       <rect x="34" y="31" width="12" height="18" rx="3" fill="#000"/>`;
  return `<g class="${open ? "window-open" : "window-closed"}" transform="translate(${x} ${y}) scale(${+s.toFixed(4)})">${frame}${body}</g>`;
}
