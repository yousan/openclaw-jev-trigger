import { describe, expect, it } from "vitest";
import { renderScript } from "./script.js";

// Run a generated script the way the trigger executor does: tools as async
// globals, frozen trigger.state, json() captures the result.
async function run(script: string, env: { obs: string; verdict: any; state?: any }) {
  let out: any;
  const calls: any[] = [];
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const fn = new AsyncFunction("trigger", "exec", "web_fetch", "jev_when", "json", script);
  await fn(
    Object.freeze({ state: env.state ? Object.freeze(env.state) : undefined }),
    async () => ({ aggregated: env.obs }),
    async () => ({ text: env.obs }),
    async (args: any) => (calls.push(args), env.verdict),
    (v: any) => (out = v),
  );
  return { out, calls };
}

const yes = { matched: true, probability: 0.93, threshold: 0.7, model: "jev", unavailable: null };
const no = { ...yes, matched: false, probability: 0.1 };

describe("renderScript", () => {
  const base = { when: "CI turned red", source: { kind: "exec" as const, command: "gh run list" } };

  it("fires only on the false -> true edge by default", async () => {
    const s = renderScript(base);
    expect((await run(s, { obs: "failed", verdict: yes })).out.fire).toBe(true);
    expect((await run(s, { obs: "failed", verdict: yes, state: { matched: true } })).out.fire).toBe(false);
    expect((await run(s, { obs: "ok", verdict: no, state: { matched: true } })).out).toMatchObject({ fire: false, state: { matched: false } });
  });

  it("--level fires on every match", async () => {
    const s = renderScript({ ...base, level: true });
    expect((await run(s, { obs: "failed", verdict: yes, state: { matched: true } })).out.fire).toBe(true);
  });

  it("--compare passes last observation and stores the new one", async () => {
    const s = renderScript({ ...base, when: "price dropped", compare: true, source: { kind: "fetch", url: "https://shop.example/p/1" } });
    const { out, calls } = await run(s, { obs: "$9", verdict: yes, state: { last: "$10" } });
    expect(calls[0]).toMatchObject({ when: "price dropped", evidence: "$9", previous: "$10" });
    expect(out.state.last).toBe("$9");
  });

  it("alerts once after N unavailable judgements, never counts them as 'no'", async () => {
    const s = renderScript({ ...base, alertAfter: 2 });
    const un = { ...no, unavailable: "deadline" };
    const r1 = await run(s, { obs: "x", verdict: un, state: { matched: true } });
    expect(r1.out).toMatchObject({ fire: false, state: { matched: true, misses: 1 } });
    const r2 = await run(s, { obs: "x", verdict: un, state: r1.out.state });
    expect(r2.out.fire).toBe(true);
    expect(r2.out.message).toContain("unavailable 2 times");
  });

  it("escapes user text safely and passes notWhen / threshold", async () => {
    const when = 'it says "done" `now` ${x}';
    const s = renderScript({ ...base, when, notWhen: "only waiting", threshold: 0.8 });
    const { calls, out } = await run(s, { obs: "o", verdict: yes });
    expect(calls[0]).toMatchObject({ when, notWhen: "only waiting", threshold: 0.8 });
    expect(out.message).toContain(when);
  });

  it("rejects a bad tool name", () => {
    expect(() => renderScript({ ...base, source: { kind: "tool", name: "a(b)", args: {} } })).toThrow();
  });
});
