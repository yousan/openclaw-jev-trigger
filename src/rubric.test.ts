import { describe, expect, it } from "vitest";
import { buildBatch, clip, interpret, QUESTION_ID } from "./rubric.js";

const ok = (p: number) =>
  ({
    status: "ok",
    result: { model: "jev-1.13.0", answers: { [QUESTION_ID]: { type: "boolean", probabilityTrue: p } }, usage: { inputTokens: 120 } },
    provenance: { providerId: "typesafe", rubricVersion: "1", runtimeGeneration: "g" },
  }) as const;

describe("buildBatch", () => {
  it("puts the condition only in the labels, never in the instructions", () => {
    const { batch } = buildBatch({ when: "CI turned red", notWhen: "CI is still running", evidence: "failed" });
    const q = batch.questions[QUESTION_ID] as any;
    expect(q.type).toBe("boolean");
    expect(q.criteria).toEqual({ true: "CI turned red", false: "CI is still running" });
    expect(String(q.instructions)).not.toContain("CI turned red");
    expect(batch.state).toEqual({ observation: "failed" });
  });

  it("uses previous/current state for change conditions", () => {
    const { batch } = buildBatch({ when: "the price dropped", evidence: "$9", previous: "$10" });
    expect(batch.state).toEqual({ previous_observation: "$10", current_observation: "$9" });
    expect((batch.questions[QUESTION_ID] as any).criteria.false).toBe("Not the case: the price dropped");
  });

  it("serialises JSON evidence and rejects an empty condition", () => {
    const { batch } = buildBatch({ when: "x", evidence: { conclusion: "failure" } });
    expect((batch.state as any).observation).toContain('"conclusion": "failure"');
    expect(() => buildBatch({ when: "  ", evidence: "" })).toThrow();
  });
});

describe("clip", () => {
  it("keeps the tail by default and marks truncation", () => {
    expect(clip("abcdef", 3, "tail")).toEqual({ text: "…def", truncated: true });
    expect(clip("abcdef", 3, "head")).toEqual({ text: "abc…", truncated: true });
    expect(clip(" ab ", 3, "tail")).toEqual({ text: "ab", truncated: false });
  });
  it("flags truncation through buildBatch", () => {
    expect(buildBatch({ when: "x", evidence: "y".repeat(500), maxEvidenceChars: 200 }).truncated).toBe(true);
  });
});

describe("interpret", () => {
  it("fires at or above the threshold", () => {
    expect(interpret(ok(0.7) as any, 0.7, 12.4, false)).toMatchObject({ matched: true, probability: 0.7, model: "jev-1.13.0", provider: "typesafe", inputTokens: 120, latencyMs: 12 });
    expect(interpret(ok(0.69) as any, 0.7, 1, false).matched).toBe(false);
  });
  it("treats unavailable as 'no answer', not as 'no'", () => {
    const v = interpret({ status: "unavailable", reason: "deadline" }, 0.7, 5, false);
    expect(v).toMatchObject({ matched: false, probability: null, unavailable: "deadline" });
  });
  it("rejects a non-boolean answer shape", () => {
    const bad = { ...ok(0.9), result: { model: "m", answers: { [QUESTION_ID]: { type: "choice", choice: "a", probabilities: { a: 1 } } } } };
    expect(interpret(bad as any, 0.7, 1, false).unavailable).toBe("invalid-response");
  });
});
