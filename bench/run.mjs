#!/usr/bin/env node
// Runs every case through a live OpenClaw Gateway: POST /tools/invoke -> jev_when
// -> api.runtime.decisions.evaluate -> the agent's decisionModel. Sequential, so
// latencies are not inflated by queueing.
//
//   OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789 OPENCLAW_GATEWAY_TOKEN=... \
//     node bench/run.mjs --label jev-latest
//   node bench/run.mjs --baseline        # the JavaScript rules, no Gateway
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { rules } from "./baseline.mjs";

const { values } = parseArgs({
  options: {
    label: { type: "string" },
    baseline: { type: "boolean" },
    only: { type: "string" },
    "max-evidence": { type: "string" },
  },
});
const dir = new URL(".", import.meta.url);
const cases = readFileSync(new URL("cases.jsonl", dir), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l))
  .filter((c) => !values.only || c.task === values.only);
mkdirSync(new URL("results/", dir), { recursive: true });

const rows = [];
if (values.baseline) {
  for (const c of cases) {
    const t0 = performance.now();
    const fired = rules[c.task](c);
    rows.push({ id: c.id, task: c.task, lang: c.lang, expected: c.expected, probability: fired ? 1 : 0, latencyMs: performance.now() - t0 });
  }
  writeFileSync(new URL("results/js-baseline.json", dir), JSON.stringify({ label: "js-baseline", rows }, null, 1));
  console.log(`js-baseline: ${rows.filter((r) => (r.probability >= 0.5) === r.expected).length}/${rows.length}`);
  process.exit(0);
}

const url = (process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789").replace(/\/$/, "");
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!token || !values.label) {
  console.error("need OPENCLAW_GATEWAY_TOKEN and --label <name>");
  process.exit(2);
}

let model = null;
for (const c of cases) {
  const args = { when: c.when, notWhen: c.notWhen, evidence: c.evidence, threshold: 0.5 };
  if (c.previous !== undefined) args.previous = c.previous;
  const t0 = performance.now();
  const res = await fetch(`${url}/tools/invoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ tool: "jev_when", args }),
  });
  const wallMs = performance.now() - t0;
  const body = await res.json();
  const d = body?.result?.details;
  if (!res.ok || !d) {
    console.error(c.id, res.status, JSON.stringify(body).slice(0, 300));
    rows.push({ id: c.id, task: c.task, lang: c.lang, expected: c.expected, probability: null, unavailable: `http-${res.status}` });
    continue;
  }
  model ??= d.model;
  rows.push({
    id: c.id, task: c.task, lang: c.lang, expected: c.expected,
    probability: d.probability, unavailable: d.unavailable,
    latencyMs: d.latencyMs, wallMs: Math.round(wallMs), inputTokens: d.inputTokens, model: d.model,
  });
  process.stderr.write(`${c.id} expected=${c.expected} p=${d.probability} ${d.latencyMs}ms${d.unavailable ? " " + d.unavailable : ""}\n`);
}
writeFileSync(new URL(`results/${values.label}.json`, dir), JSON.stringify({ label: values.label, model, rows }, null, 1));
console.log(`wrote results/${values.label}.json`);
