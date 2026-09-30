import { describe, expect, it, vi } from "vitest";
import { evaluateWhen } from "./when.js";

describe("evaluateWhen", () => {
  it("passes agentId, purpose, rubric version and deadline to the host runtime", async () => {
    const evaluate = vi.fn(async () => ({
      status: "ok" as const,
      result: { model: "jev", answers: { when: { type: "boolean" as const, probabilityTrue: 0.91 } } },
      provenance: { providerId: "typesafe", rubricVersion: "1", runtimeGeneration: "g" },
    }));
    let t = 100;
    const v = await evaluateWhen({ evaluate }, { when: "done", evidence: "Done." }, { agentId: "ops", timeoutMs: 5000, now: () => (t += 40) });
    expect(v).toMatchObject({ matched: true, probability: 0.91, latencyMs: 40 });
    const [, opts] = evaluate.mock.calls[0] as any;
    expect(opts).toMatchObject({ agentId: "ops", purpose: "jev-trigger.when", rubricVersion: "1", timeoutMs: 5000 });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("lets cancellation reject instead of quietly returning 'no'", async () => {
    const evaluate = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(evaluateWhen({ evaluate }, { when: "done", evidence: "x" })).rejects.toThrow("aborted");
  });

  it("validates the threshold", async () => {
    await expect(evaluateWhen({ evaluate: vi.fn() }, { when: "a", evidence: "b", threshold: 1.5 })).rejects.toThrow();
  });
});
