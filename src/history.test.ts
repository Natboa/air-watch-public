import { test, expect } from "bun:test";
import { historyEntry, parseHistory, pruneHistory } from "./history";
import { estimateUnavailable, type Estimate } from "./estimate";

const AT = new Date("2026-10-16T07:00:00Z");
const EST: Estimate = {
  at: AT, score: 132.4, level: 3,
  lead: { pollutant: "PM10", ugm3: 66, pct: 132.4, origin: "local" },
  wind: null, calm: true, upwind: null, local: [], nextBayWindAt: null, note: null,
  info: {}, benzene: 0.46,
};

test("historyEntry keeps what the weekly chart needs, rounded", () => {
  expect(historyEntry(EST, 3, true)).toEqual({
    at: "2026-10-16T07:00:00.000Z", score: 132, level: 3, confirmed: 3, lead: "PM10", benzene: 0.5, notified: true,
  });
  expect(historyEntry(estimateUnavailable(AT, "x"), null, false)).toEqual({
    at: "2026-10-16T07:00:00.000Z", score: null, level: null, confirmed: null, lead: null, benzene: null, notified: false,
  });
});

test("parseHistory skips blank and broken lines", () => {
  const good = JSON.stringify(historyEntry(EST, 3, false));
  const parsed = parseHistory(`${good}\n\nnot json\n${good}\n`);
  expect(parsed).toHaveLength(2);
  expect(parsed[0].score).toBe(132);
});

test("pruneHistory drops lines older than the cutoff and keeps order", () => {
  const line = (iso: string) => JSON.stringify({ ...historyEntry(EST, 3, false), at: iso });
  const text = [line("2026-08-01T00:00:00Z"), line("2026-10-01T00:00:00Z"), "garbage", line("2026-10-16T00:00:00Z")].join("\n") + "\n";
  const kept = pruneHistory(text, AT, 60);
  expect(kept.trim().split("\n")).toEqual([line("2026-10-01T00:00:00Z"), line("2026-10-16T00:00:00Z")]);
});
