/**
 * Sun and moon for the dashboard's day/night disc. It is drawn like a watch
 * complication: one disc turning through the day, sun and moon on opposite
 * sides. Two things are kept true to the sky over home: the sun sits exactly
 * on the horizon at the real sunrise and sunset (so the day half is the real
 * length of the day), and the moon shows tonight's real phase, with its lit
 * side facing the sun. Positions come from suncalc (BSD-2), no network.
 */
import SunCalc from "suncalc";

/**
 * Where the sun is on the disc, in degrees: 0 on the east horizon (left) at
 * sunrise, 90 at the top, 180 on the west horizon at sunset, 180–360 through
 * the night (hidden below the horizon). Day and night each take half a turn,
 * so the disc runs a little faster by day in summer and by night in winter.
 */
export function sunAngle(now: Date, lat: number, lon: number): number {
  const times = (d: Date) => SunCalc.getTimes(d, lat, lon);
  const t = now.getTime(), day = 86_400_000;
  const today = times(now);
  const frac = (a: Date, b: Date) => (t - a.getTime()) / (b.getTime() - a.getTime());
  if (t < today.sunrise.getTime()) return 180 + 180 * frac(times(new Date(t - day)).sunset, today.sunrise);
  if (t <= today.sunset.getTime()) return 180 * frac(today.sunrise, today.sunset);
  return 180 + 180 * frac(today.sunset, times(new Date(t + day)).sunrise);
}

export interface MoonPhase {
  /** 0–1 of the disc lit. */
  fraction: number;
  /** suncalc's phase: 0 new → 0.5 full → 1 new. */
  phase: number;
  waxing: boolean;
  nameHe: string;
}

/**
 * Hebrew phase name. New and full cover the moon ≤ 2% / ≥ 98% lit (±0.045 of
 * the cycle), so a 99% moon is never called waning; quarters get ±0.03.
 */
export function phaseHe(p: number): string {
  return p < 0.045 || p > 0.955 ? "מולד" : p < 0.22 ? "סהר מתמלא" : p < 0.28 ? "רבע ראשון" : p < 0.455 ? "ירח מתמלא"
    : p < 0.545 ? "ירח מלא" : p < 0.72 ? "ירח מתמעט" : p < 0.78 ? "רבע אחרון" : "סהר מתמעט";
}

export function moonPhase(now: Date): MoonPhase {
  const m = SunCalc.getMoonIllumination(now);
  return { fraction: m.fraction, phase: m.phase, waxing: m.phase < 0.5, nameHe: phaseHe(m.phase) };
}

/** A point on the disc at angle deg (same convention as sunAngle) and radius r, around (cx, cy). */
export function onDisc(cx: number, cy: number, deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx - r * Math.cos(a), cy - r * Math.sin(a)];
}

/** Screen direction from the moon towards the sun, in degrees clockwise from straight up. */
export function towardSunDeg(phi: number): number {
  // The moon sits at phi + 180, so the sun is straight across the centre: direction = the sun's own bearing from the centre.
  const [x, y] = onDisc(0, 0, phi, 1);
  return ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
}
