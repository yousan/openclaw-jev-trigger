#!/usr/bin/env node
// openclaw-jev-trigger: print a trigger script for `openclaw automations add --trigger-script`.
import { parseArgs } from "node:util";
import { renderScript, type Source } from "./script.js";

const HELP = `openclaw-jev-trigger — write an automation condition in plain language

Usage:
  openclaw-jev-trigger --when "<condition>" (--exec "<cmd>" | --fetch <url> | --tool <name> [--args <json>]) [options] > watch.js
  openclaw automations add --every 5m --trigger-script ./watch.js --message "<what to do>" --session isolated

Options:
  --when <text>        condition that should wake the model (required)
  --not-when <text>    look-alike that must NOT fire ("only waiting for a reply")
  --exec <cmd>         observe with the exec tool (stdout)
  --fetch <url>        observe with the web_fetch tool
  --tool <name>        observe with any tool; --args '{"k":"v"}'
  --compare            also pass last run's observation (for "dropped", "changed")
  --level              fire on every matching run (default: only when it becomes true)
  --threshold <p>      probability needed to fire (default: plugin config, 0.7)
  --keep head|tail     which end of long evidence to keep (default tail)
  --alert-after <n>    fire one alert after n unavailable judgements in a row (default 3, 0 = never)
`;

const { values } = parseArgs({
  options: {
    when: { type: "string" },
    "not-when": { type: "string" },
    exec: { type: "string" },
    fetch: { type: "string" },
    tool: { type: "string" },
    args: { type: "string" },
    compare: { type: "boolean" },
    level: { type: "boolean" },
    threshold: { type: "string" },
    keep: { type: "string" },
    "alert-after": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

function fail(msg: string): never {
  process.stderr.write(`${msg}\n\n${HELP}`);
  process.exit(2);
}

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (!values.when) fail("--when is required");

const sources = [values.exec, values.fetch, values.tool].filter((v) => v !== undefined);
if (sources.length !== 1) fail("give exactly one of --exec, --fetch, --tool");
let source: Source;
if (values.exec !== undefined) source = { kind: "exec", command: values.exec };
else if (values.fetch !== undefined) source = { kind: "fetch", url: values.fetch };
else {
  let args: Record<string, unknown> = {};
  try {
    args = values.args ? JSON.parse(values.args) : {};
  } catch {
    fail("--args must be JSON");
  }
  source = { kind: "tool", name: values.tool!, args };
}

const threshold = values.threshold === undefined ? undefined : Number(values.threshold);
if (threshold !== undefined && !(threshold > 0 && threshold <= 1)) fail("--threshold must be in (0, 1]");
if (values.keep && values.keep !== "head" && values.keep !== "tail") fail("--keep must be head or tail");

try {
  process.stdout.write(
    renderScript({
      when: values.when,
      notWhen: values["not-when"],
      source,
      compare: values.compare,
      level: values.level,
      threshold,
      keep: values.keep as "head" | "tail" | undefined,
      alertAfter: values["alert-after"] === undefined ? undefined : Number(values["alert-after"]),
    }),
  );
} catch (e) {
  fail((e as Error).message);
}
