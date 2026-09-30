#!/usr/bin/env node
// Summarises bench/results/*.json into the Markdown tables used in the README.
import { readFileSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { threshold: { type: "string" }, detail: { type: "boolean" } } });
const T = Number(values.threshold ?? 0.7);
// TypeSafe list price for hosted Jev input tokens (output is free), USD per token.
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1e6;

const dir = new URL("results/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const pct = (x) => `${Math.round(x * 100)}%`;
const q = (xs, p) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};

function score(rows, t) {
  let tp = 0, fp = 0, fn = 0, tn = 0, na = 0;
  for (const r of rows) {
    if (r.probability == null) { na++; if (r.expected) fn++; else tn++; continue; }
    const fire = r.probability >= t;
    if (fire && r.expected) tp++; else if (fire) fp++; else if (r.expected) fn++; else tn++;
  }
  return { n: rows.length, acc: (tp + tn) / rows.length, fp, fn, na };
}

const tasks = ["thread-done", "ci-red", "price-drop"];
const out = [];
out.push(`| judge | all (${"n=" + JSON.parse(readFileSync(new URL(files[0], dir))).rows.length}) | thread-done | ci-red | price-drop | false wakes | missed | p50 / p95 latency | $ per check |`);
out.push("|---|---|---|---|---|---|---|---|---|");
for (const f of files) {
  const { label, model, rows } = JSON.parse(readFileSync(new URL(f, dir)));
  const isJs = label === "js-baseline";
  const t = isJs ? 0.5 : T;
  const all = score(rows, t);
  const per = tasks.map((k) => pct(score(rows.filter((r) => r.task === k), t).acc));
  const lat = rows.map((r) => r.latencyMs);
  const tok = rows.map((r) => r.inputTokens).filter((x) => x != null);
  const meanTok = tok.length ? tok.reduce((a, b) => a + b, 0) / tok.length : null;
  const usd = isJs || (model ?? "").includes("gliclass") || (model ?? "").includes("deberta") || label.startsWith("kev")
    ? "$0 (local)"
    : meanTok != null ? `$${(meanTok * JEV_USD_PER_INPUT_TOKEN).toExponential(1)} (${Math.round(meanTok)} tok)` : "n/a";
  const latency = isJs ? "<1 ms" : `${q(lat, 0.5)} / ${q(lat, 0.95)} ms`;
  out.push(`| ${label}${model && !isJs ? ` (\`${model}\`)` : ""} | **${pct(all.acc)}** | ${per.join(" | ")} | ${all.fp} | ${all.fn}${all.na ? ` (${all.na} n/a)` : ""} | ${latency} | ${usd} |`);
}
console.log(out.join("\n"));
console.log(`\nThreshold ${T} for model judges (probability >= threshold fires). JS rules are yes/no.`);

if (values.detail) {
  for (const f of files) {
    const { label, rows } = JSON.parse(readFileSync(new URL(f, dir)));
    const t = label === "js-baseline" ? 0.5 : T;
    const wrong = rows.filter((r) => r.probability == null || (r.probability >= t) !== r.expected);
    console.log(`\n${label} wrong: ${wrong.map((r) => `${r.id}(${r.probability})`).join(" ")}`);
    if (label !== "js-baseline") {
      const sweep = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((x) => `${x}:${pct(score(rows, x).acc)}`);
      console.log(`  threshold sweep ${sweep.join(" ")}`);
    }
  }
}
