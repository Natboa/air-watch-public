/**
 * The moon's picture for any moment, from a stored cycle: 60 frames of NASA
 * SVS "Dial-a-Moon" (public domain), one every ~12 h from the new moon of
 * 2026-10-10 11:57 UTC, cropped to the disc and shrunk to 152×152 grey JPEGs
 * in assets/moon. The look repeats with the phase, not the calendar (a cycle
 * is 29.5 days); what does differ between cycles — the slight wobble at the
 * edges and a few % in apparent size — is invisible at the panel's 38 px.
 * No network, so the corner never depends on NASA being up.
 */
import { readFileSync } from "fs";

export const MOON_FRAMES = 60;
const DIR = `${import.meta.dir}/../assets/moon`;
const cache = new Map<number, Uint8Array | null>();

/** Which stored frame shows a phase (suncalc's 0 new → 0.5 full → 1 new). */
export const frameFor = (phase: number) => ((Math.round(phase * MOON_FRAMES) % MOON_FRAMES) + MOON_FRAMES) % MOON_FRAMES;

/** JPEG bytes of the stored frame nearest this phase; null if it is missing (the disc then draws a vector moon). */
export function moonPhotoFor(phase: number): Uint8Array | null {
  const k = frameFor(phase);
  if (!cache.has(k)) {
    try { cache.set(k, readFileSync(`${DIR}/phase-${String(k).padStart(2, "0")}.jpg`)); }
    catch { cache.set(k, null); }
  }
  return cache.get(k)!;
}
