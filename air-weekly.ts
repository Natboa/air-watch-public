#!/usr/bin/env bun
/**
 * air-weekly.ts — the Friday summary: renders data/weekly.png (last 7 days
 * from data/history.jsonl) and prints the Hebrew caption on stdout. Greg-Bot's
 * air-weekly.sh sends both; this repo never talks to Telegram.
 *
 *   bun run air-weekly.ts                       last 7 days, prunes history to 60 days
 *   bun run air-weekly.ts --history f --out p   any history file / output path, no pruning (previews)
 *   --to <ISO>                                  end of the week (default: now)
 *
 * Exit 3 = not enough data this week (under 72 covered hours, e.g. the first,
 * partial week): nothing is printed and the wrapper sends nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { parseHistory, pruneHistory } from "./src/history";
import { summarizeWeek, renderWeekSvg, formatWeeklyHe, hasEnoughData } from "./src/weekly";
import { svgToPng } from "./src/png";

const MIN_COVERED_HOURS = 72;
const DIR = process.env.AIR_DIR ?? `${import.meta.dir}/data`;
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? undefined : process.argv[i + 1]; };
const historyPath = arg("history") ?? `${DIR}/history.jsonl`;
const outPath = arg("out") ?? `${DIR}/weekly.png`;
const toArg = arg("to");

const to = toArg ? new Date(toArg) : new Date();
const from = new Date(to.getTime() - 7 * 86_400_000);
const text = existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "";
const entries = parseHistory(text);

// Keep the live history bounded; previews from another file leave it alone.
if (!arg("history") && text) {
  writeFileSync(`${historyPath}.tmp`, pruneHistory(text, to, 60));
  renameSync(`${historyPath}.tmp`, historyPath);
}

const summary = summarizeWeek(entries, from, to);
if (!hasEnoughData(summary, MIN_COVERED_HOURS)) {
  console.error(`[air-weekly] only ${168 - summary.missingHours} covered hours (< ${MIN_COVERED_HOURS}); skipping this week`);
  process.exit(3);
}

mkdirSync(DIR, { recursive: true });
writeFileSync(outPath, svgToPng(renderWeekSvg(entries, from, to)));
console.log(formatWeeklyHe(summary));
