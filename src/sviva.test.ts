import { test, expect } from "bun:test";
import { parseRegions, parseAverage, normalizeValue, apiDay, SvivaClient } from "./sviva";

const REGIONS = [{
  regionId: 2, name: "חיפה", stations: [
    { stationId: 602, name: "ניידת 9", location: { latitude: 32.812108, longitude: 35.107611 }, active: true, mobile: true, address: "קריית אתא, רח חנקין 12", monitors: [] },
    { stationId: 1, name: "no location", location: { latitude: 0, longitude: 0 }, active: false, mobile: false, address: "", monitors: [] },
  ],
}];

// Shape captured live on 2026-10-15. "µg/m³" really arrives mangled like this.
const AVG = {
  data: [
    { datetime: "2026-10-15T21:00:00+02:00", channels: [
      { name: "Benzene", value: 1.5, valid: true, status: 1, units: "�g/m�" },
      { name: "NO2", value: 10, valid: true, status: 1, units: "ppb" },
      { name: "PM2.5", value: 99, valid: false, status: 2, units: "�g/m�" },
      { name: "WD", value: 250, valid: true, status: 1, units: "deg" },
    ] },
    { datetime: "garbage", channels: [] },
  ],
};

test("parseRegions keeps located stations and their flags", () => {
  const s = parseRegions(REGIONS);
  expect(s).toHaveLength(1);
  expect(s[0]).toEqual({ id: 602, name: "ניידת 9", lat: 32.812108, lon: 35.107611, active: true, mobile: true, address: "קריית אתא, רח חנקין 12" });
  expect(() => parseRegions({})).toThrow();
});

test("parseAverage drops invalid channels and bad timestamps, normalises units", () => {
  const s = parseAverage(AVG);
  expect(s).toHaveLength(1);
  expect(s[0].t.toISOString()).toBe("2026-10-15T19:00:00.000Z");
  expect(s[0].values.Benzene).toBe(1.5);
  expect(s[0].values.NO2).toBeCloseTo(18.8);
  expect(s[0].values.WD).toBe(250);
  expect("PM2.5" in s[0].values).toBe(false);
  expect(() => parseAverage([])).toThrow();
});

test("normalizeValue: ppb converts for known gases, unknown ppb is dropped", () => {
  expect(normalizeValue("Benzene", 1, "ppb")).toBeCloseTo(3.19);
  expect(normalizeValue("Mystery", 1, "ppb")).toBeNull();
  expect(normalizeValue("WS", 2.5, "m/s")).toBe(2.5);
});

test("apiDay uses the API's fixed UTC+2 clock", () => {
  expect(apiDay(new Date("2026-10-15T21:59:00Z"))).toBe("2026-10-15");
  expect(apiDay(new Date("2026-10-15T22:30:00Z"))).toBe("2026-10-16");
});

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    return key ? routes[key]() : new Response("not found", { status: 404 });
  };
  return { fn, calls };
}

test("SvivaClient authenticates in two steps and sends token + cookie", async () => {
  const { fn, calls } = fakeFetch({
    GetApiToken: () => new Response('"tok123"'),
    GenerateToken: () => new Response("", { headers: { "set-cookie": "X-Access-Token=abc.def; path=/; HttpOnly" } }),
    regions: () => Response.json(REGIONS),
    "/Average": () => Response.json(AVG),
  });
  const c = new SvivaClient(fn);
  await c.auth();
  expect((await c.stations())[0].id).toBe(602);
  const h = calls.find((x) => x.url.includes("regions"))!.init!.headers as Record<string, string>;
  expect(h.authorization).toBe("ApiToken tok123");
  expect(h.cookie).toBe("X-Access-Token=abc.def");
  await c.samples(602, "2026-10-15", "2026-10-15");
  const avgUrl = calls.find((x) => x.url.includes("/Average"))!.url;
  expect(avgUrl).toContain("stations/602/Average?");
  expect(avgUrl).toContain("from=2026-10-15T00%3A00%3A00");
  expect(avgUrl).toContain("unitConversion=true");
});

test("a silent station (HTTP 204, seen live on 2026-10-15) yields no samples, not a crash", async () => {
  const { fn } = fakeFetch({
    GetApiToken: () => new Response('"tok123"'),
    GenerateToken: () => new Response("", { headers: { "set-cookie": "X-Access-Token=abc.def" } }),
    "/Average": () => new Response(null, { status: 204 }),
  });
  const c = new SvivaClient(fn);
  await c.auth();
  expect(await c.samples(627, "2026-10-15", "2026-10-15")).toEqual([]);
});

test("a transient 401 (seen live on 2026-10-15) re-authenticates once and retries", async () => {
  let gen = 0, avgCalls = 0;
  const { fn } = fakeFetch({
    GetApiToken: () => new Response('"tok123"'),
    GenerateToken: () => new Response("", { headers: { "set-cookie": `X-Access-Token=jwt${++gen}` } }),
    "/Average": () => (++avgCalls === 1 ? new Response("", { status: 401 }) : Response.json(AVG)),
  });
  const c = new SvivaClient(fn);
  await c.auth();
  expect(await c.samples(602, "2026-10-15", "2026-10-15")).toHaveLength(1);
  expect(gen).toBe(2);
});

test("a 401 that survives re-authentication still fails", async () => {
  const { fn } = fakeFetch({
    GetApiToken: () => new Response('"tok123"'),
    GenerateToken: () => new Response("", { headers: { "set-cookie": "X-Access-Token=abc" } }),
    "/Average": () => new Response("", { status: 401 }),
  });
  const c = new SvivaClient(fn);
  await c.auth();
  await expect(c.samples(602, "2026-10-15", "2026-10-15")).rejects.toThrow(/HTTP 401/);
});

test("SvivaClient fails loudly when no token cookie comes back", async () => {
  const { fn } = fakeFetch({
    GetApiToken: () => new Response('"tok123"'),
    GenerateToken: () => new Response("{}"),
  });
  await expect(new SvivaClient(fn).auth()).rejects.toThrow(/X-Access-Token/);
});
