/** Israel wall-clock helpers. Kept here so air-watch never depends on Greg-Bot's lib/tz.ts. */
export const HOME_TZ = "Asia/Jerusalem";

/** Hour 0..23 in `tz`. Some ICU builds print midnight as "24" with hour12:false, hence the % 24. */
export function hourIn(d: Date, tz: string = HOME_TZ): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d)) % 24;
}
