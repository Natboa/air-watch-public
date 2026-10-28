/**
 * MoEP air-monitoring API (air.sviva.gov.il, Envista). Public guest access:
 * GetApiToken → GenerateToken sets an X-Access-Token cookie (~1h). Each cron
 * run authenticates afresh, so no refresh logic is needed.
 * Reference wrapper: github.com/GuyKh/py-air-sviva-api.
 */
import type { LatLon } from "./geo";

export interface StationMeta extends LatLon { id: number; name: string; active: boolean; mobile: boolean; address: string }
/** One 5-minute point. Pollutants in µg/m³, WD in degrees, WS in m/s. */
export interface Sample { t: Date; values: Record<string, number> }
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const MAIN = "https://air.sviva.gov.il";
const API = "https://air-papi.sviva.gov.il/v1";
// The site's own requests carry these; the API checks them.
const BASE_HEADERS: Record<string, string> = {
  accept: "application/json",
  origin: MAIN,
  referer: `${MAIN}/`,
  domainname: "sviva",
  "envi-data-source": "MANA",
};
/** µg/m³ per ppb at 25 °C. Only used if a channel ever arrives in ppb despite unitConversion=true. */
const PPB_TO_UGM3: Record<string, number> = { Benzene: 3.19, Toluene: 3.77, NO2: 1.88, SO2: 2.62, O3: 1.96 };
/** "µg/m³" arrives as Latin-1 bytes ("�g/m�"), so match the ASCII part only. */
const UGM3 = /g\/m/i;

export function normalizeValue(name: string, value: number, units: string): number | null {
  if (UGM3.test(units)) return value;
  if (/ppb/i.test(units)) {
    const f = PPB_TO_UGM3[name];
    return f ? value * f : null;
  }
  return value; // WD (deg), WS (m/s), Temp, RH — used by channel name
}

export function parseRegions(json: unknown): StationMeta[] {
  if (!Array.isArray(json)) throw new Error("regions: expected an array");
  const out: StationMeta[] = [];
  for (const region of json as any[]) {
    for (const s of region?.stations ?? []) {
      const lat = Number(s?.location?.latitude);
      const lon = Number(s?.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0) continue;
      out.push({
        id: Number(s.stationId), name: String(s.name ?? ""), lat, lon,
        active: s.active === true, mobile: s.mobile === true, address: String(s.address ?? ""),
      });
    }
  }
  return out;
}

export function parseAverage(json: unknown): Sample[] {
  const data = (json as any)?.data;
  if (!Array.isArray(data)) throw new Error("average: expected { data: [] }");
  const out: Sample[] = [];
  for (const p of data) {
    const t = new Date(p?.datetime);
    if (Number.isNaN(t.getTime())) continue;
    const values: Record<string, number> = {};
    for (const ch of p?.channels ?? []) {
      if (ch?.valid !== true || typeof ch?.value !== "number") continue;
      const v = normalizeValue(String(ch.name), ch.value, String(ch.units ?? ""));
      if (v !== null) values[String(ch.name)] = v;
    }
    out.push({ t, values });
  }
  return out;
}

/** The API's clock is fixed UTC+2 (no DST); day boundaries must use it too. */
export function apiDay(d: Date): string {
  return new Date(d.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

export class SvivaClient {
  private apiToken = "";
  private jwt = "";
  constructor(private fetchFn: FetchFn = fetch) {}

  async auth(): Promise<void> {
    const r1 = await this.fetchFn(`${MAIN}/Account/GetApiToken`, {
      method: "POST",
      headers: { ...BASE_HEADERS, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ userName: "Guest" }),
    });
    if (!r1.ok) throw new Error(`GetApiToken HTTP ${r1.status}`);
    this.apiToken = (await r1.text()).replace(/"/g, "").trim();

    const r2 = await this.fetchFn(`${API}/GenerateToken`, {
      method: "POST",
      headers: { ...BASE_HEADERS, "content-type": "application/json", authorization: `ApiToken ${this.apiToken}` },
      body: "{}",
    });
    if (!r2.ok) throw new Error(`GenerateToken HTTP ${r2.status}`);
    const cookies = r2.headers.getSetCookie?.().join(";") ?? r2.headers.get("set-cookie") ?? "";
    const m = cookies.match(/X-Access-Token=([^;]+)/);
    if (!m) throw new Error("GenerateToken: no X-Access-Token cookie");
    this.jwt = m[1];
  }

  /** Parallel requests that all hit a 401 share one re-authentication. */
  private reauthing: Promise<void> | null = null;
  private reauth(): Promise<void> {
    this.reauthing ??= this.auth().finally(() => { this.reauthing = null; });
    return this.reauthing;
  }

  /**
   * null = HTTP 204: the station is listed but publishes nothing (Tashan 1–3 and
   * two Bazan fence stations, since Sep–Oct 2026). A 401 has been seen hitting
   * every request of a run right after a successful login, then never again —
   * so re-authenticate once and retry before giving up.
   */
  private async get(path: string, retried = false): Promise<unknown | null> {
    const r = await this.fetchFn(`${API}/envista/${path}`, {
      headers: { ...BASE_HEADERS, authorization: `ApiToken ${this.apiToken}`, cookie: `X-Access-Token=${this.jwt}` },
    });
    if (r.status === 401 && !retried) {
      await this.reauth();
      return this.get(path, true);
    }
    if (!r.ok) throw new Error(`${path.split("?")[0]} HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  async stations(): Promise<StationMeta[]> {
    return parseRegions(await this.get("regions"));
  }

  /** Every 5-minute point for whole API days fromDay..toDay (YYYY-MM-DD, UTC+2). */
  async samples(stationId: number, fromDay: string, toDay: string): Promise<Sample[]> {
    const q = new URLSearchParams({
      from: `${fromDay}T00:00:00`, to: `${toDay}T23:59:59`,
      fromTimebase: "5", toTimebase: "5", timeBeginning: "false", useBackWard: "true",
      includeSummary: "false", roundType: "1", unitid: "-1", unitConversion: "true",
    });
    const json = await this.get(`stations/${stationId}/Average?${q}`);
    return json === null ? [] : parseAverage(json);
  }
}
