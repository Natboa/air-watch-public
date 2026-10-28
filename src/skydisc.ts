/**
 * The day/night disc in the dashboard's top-left corner, styled like a watch
 * complication: an arched aperture with a minute-track rim, behind it a disc
 * that is half day (white, sun rays, the engraved sun) and half night (black,
 * stars, the moon), turning once a day. See sky.ts for what is real about it.
 *
 * The sun is a 1-bit engraving (assets/art/sun-48.png, an AI illustration
 * made for this project and thresholded). The moon is NASA's photo for the
 * phase (moon.ts), lightened and turned here, then dithered by eink.ts; under
 * 12% lit its sliver is thinner than 2 px at this size, so it is drawn as a
 * vector crescent instead, and at new moon only its outline is left.
 */
import { readFileSync } from "fs";
import { moonPhase, onDisc, sunAngle, towardSunDeg } from "./sky";
import { moonPhotoFor } from "./moon";

/** The corner's size; the caller translates it into place. */
export const DISC_W = 158, DISC_H = 88;
const CX = 79, BASE = 74, R = 70, ORBIT = 43, SUN = 48, MOON = 38;
const B = "#000", Wt = "#fff";

let sunArt: string | null = null;
const sunHref = () => (sunArt ??= `data:image/png;base64,${readFileSync(`${import.meta.dir}/../assets/art/sun-48.png`).toString("base64")}`);

/** Stars ride on the night half: [degrees from the moon's direction, radius, size]. */
const STARS: [number, number, number][] = [[-62, 30, 2.2], [-40, 62, 3], [-28, 20, 1.6], [32, 22, 1.8], [40, 62, 2.6], [64, 34, 2.2], [-74, 58, 1.8], [76, 60, 1.6], [0, 66, 2], [0, 16, 1.6]];
const sparkle = (x: number, y: number, s: number) =>
  `<path d="M${x} ${y - s}L${x + s * 0.25} ${y - s * 0.25}L${x + s} ${y}L${x + s * 0.25} ${y + s * 0.25}L${x} ${y + s}L${x - s * 0.25} ${y + s * 0.25}L${x - s} ${y}L${x - s * 0.25} ${y - s * 0.25}Z" fill="${Wt}"/>`;
const f1 = (n: number) => +n.toFixed(1);

/**
 * Lit part of a moon of radius r at (x, y), lit side on the right; the caller
 * turns it. A crescent is kept at least 3 px thick so the panel can show it.
 */
export function litPath(x: number, y: number, r: number, fraction: number): string {
  const top = `${f1(x)} ${f1(y - r)}`, bottom = `${f1(x)} ${f1(y + r)}`;
  if (fraction <= 0.5) {
    const rx = Math.min(r - 3, r * (1 - 2 * fraction));
    return `M${top} A${r} ${r} 0 0 1 ${bottom} A${f1(rx)} ${r} 0 0 0 ${top}Z`;
  }
  return `M${top} A${r} ${r} 0 0 1 ${bottom} A${f1(r * (2 * fraction - 1))} ${r} 0 0 1 ${top}Z`;
}

export interface SkyDisc {
  svg: string;
  /** The moon photo's circle, in corner coordinates: eink.ts dithers inside it. */
  dither: { cx: number; cy: number; r: number } | null;
  phi: number;
}

export function renderSkyDisc(now: Date, lat: number, lon: number, photoFor: (phase: number) => Uint8Array | null = moonPhotoFor): SkyDisc {
  const phi = sunAngle(now, lat, lon), moon = moonPhase(now);
  const moonJpeg = moon.fraction >= 0.12 ? photoFor(moon.phase) : null;
  const [sx, sy] = onDisc(CX, BASE, phi, ORBIT), [mx, my] = onDisc(CX, BASE, phi + 180, ORBIT);
  const toSun = towardSunDeg(phi), mr = MOON / 2;
  const out: string[] = [`<g class="sky-disc">`];
  out.push(`<defs><clipPath id="sky-ap"><path d="M${CX - R} ${BASE} A${R} ${R} 0 0 1 ${CX + R} ${BASE}Z"/></clipPath>`,
    `<clipPath id="sky-moon"><circle cx="${f1(mx)}" cy="${f1(my)}" r="${mr}"/></clipPath>`,
    // Earthshine (the faintly lit dark side, under ~20% grey) goes to black, or dithering speckles it;
    // then the rest is lifted so the dim limb by the terminator survives.
    `<filter id="sky-lift" color-interpolation-filters="sRGB">`,
    `<feComponentTransfer>${["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="1.25" intercept="-0.25"/>`).join("")}</feComponentTransfer>`,
    `<feComponentTransfer>${["R", "G", "B"].map((c) => `<feFunc${c} type="gamma" amplitude="1" exponent="0.6" offset="0"/>`).join("")}</feComponentTransfer>`,
    `</filter></defs>`);
  out.push(`<g clip-path="url(#sky-ap)">`, `<rect width="${DISC_W}" height="${BASE}" fill="${Wt}"/>`);
  // Day half: fine rays out of the sun.
  for (let i = 0; i < 36; i++) {
    const a = (Math.PI * 2 * i) / 36;
    out.push(`<line x1="${f1(sx + 30 * Math.cos(a))}" y1="${f1(sy + 30 * Math.sin(a))}" x2="${f1(sx + 140 * Math.cos(a))}" y2="${f1(sy + 140 * Math.sin(a))}" stroke="${B}" stroke-width="0.7"/>`);
  }
  // Night half: everything on the moon's side of the line through the centre.
  const [ax, ay] = onDisc(CX, BASE, phi + 90, 95), [bx, by] = onDisc(CX, BASE, phi + 270, 95);
  out.push(`<path class="night" d="M${f1(ax)} ${f1(ay)} A95 95 0 0 1 ${f1(bx)} ${f1(by)}Z" fill="${B}"/>`);
  for (const [o, r, s] of STARS) { const [x, y] = onDisc(CX, BASE, phi + 180 + o, r); out.push(sparkle(f1(x), f1(y), s)); }
  out.push(`<image class="sun" href="${sunHref()}" x="${f1(sx - SUN / 2)}" y="${f1(sy - SUN / 2)}" width="${SUN}" height="${SUN}" style="image-rendering:pixelated"/>`);

  let dither: SkyDisc["dither"] = null;
  const ring = `<circle class="moon-ring" cx="${f1(mx)}" cy="${f1(my)}" r="${mr}" fill="none" stroke="${Wt}" stroke-width="0.8" stroke-dasharray="1.5 2.5"/>`;
  if (moon.fraction < 0.03) {
    out.push(ring);                                                                     // new moon: only where it is
  } else if (moonJpeg && moon.fraction >= 0.12) {
    // NASA frames are north-up: a waxing moon is lit on the right, a waning one on the left.
    const turn = f1(toSun - (moon.waxing ? 90 : 270));
    out.push(`<g clip-path="url(#sky-moon)"><image class="moon" href="data:image/jpeg;base64,${Buffer.from(moonJpeg).toString("base64")}" x="${f1(mx - mr)}" y="${f1(my - mr)}" width="${MOON}" height="${MOON}" filter="url(#sky-lift)" transform="rotate(${turn} ${f1(mx)} ${f1(my)})"/></g>`);
    dither = { cx: f1(mx), cy: f1(my), r: mr };
  } else {
    out.push(`<path class="moon-vector" d="${litPath(mx, my, mr, moon.fraction)}" fill="${Wt}" transform="rotate(${f1(toSun - 90)} ${f1(mx)} ${f1(my)})"/>`, ring);
  }
  out.push(`</g>`);
  // Rim: arch, minute track and base bar.
  out.push(`<path d="M${CX - R} ${BASE} A${R} ${R} 0 0 1 ${CX + R} ${BASE}" fill="none" stroke="${B}" stroke-width="2.5"/>`);
  for (let i = 0; i <= 30; i++) {
    const a = Math.PI + (Math.PI * i) / 30, major = i % 5 === 0, r1 = R + 2, r2 = R + (major ? 9 : 5);
    out.push(`<line x1="${f1(CX + r1 * Math.cos(a))}" y1="${f1(BASE + r1 * Math.sin(a))}" x2="${f1(CX + r2 * Math.cos(a))}" y2="${f1(BASE + r2 * Math.sin(a))}" stroke="${B}" stroke-width="${major ? 2 : 1}"/>`);
  }
  out.push(`<rect x="${CX - R - 10}" y="${BASE}" width="${2 * R + 20}" height="3" fill="${B}"/>`);
  out.push(`</g>`);
  return { svg: out.join("\n"), dither, phi };
}
