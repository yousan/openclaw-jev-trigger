// Pure helpers: turn a plain-language condition into a decision batch, and a
// decision outcome into a fire / don't-fire verdict. No OpenClaw runtime here,
// so everything in this file is unit-testable.

import type { DecisionBatch, DecisionOutcome } from "openclaw/plugin-sdk/decisions";

export const RUBRIC_VERSION = "1";
export const PURPOSE = "jev-trigger.when";
export const QUESTION_ID = "when";

export const DEFAULTS = {
  threshold: 0.7,
  timeoutMs: 10_000,
  maxEvidenceChars: 4_000,
} as const;

export type WhenInput = {
  /** The condition in plain language, e.g. "CI turned red". */
  when: string;
  /** Optional description of the look-alike that must NOT fire. */
  notWhen?: string;
  /** What the watcher observed this time (text or JSON). */
  evidence: unknown;
  /** What it observed last time; enables change conditions ("the price dropped"). */
  previous?: unknown;
  /** Probability at or above which the condition counts as met. */
  threshold?: number;
  /** Which end of long evidence to keep. Thread logs want the tail. */
  keep?: "head" | "tail";
  maxEvidenceChars?: number;
};

export type WhenVerdict = {
  matched: boolean;
  probability: number | null;
  threshold: number;
  model: string | null;
  provider: string | null;
  unavailable: string | null;
  latencyMs: number;
  inputTokens: number | null;
  truncated: boolean;
};

/** Evidence as text, trimmed to a budget from the chosen end. */
export function clip(
  value: unknown,
  max: number,
  keep: "head" | "tail",
): { text: string; truncated: boolean } {
  const text =
    value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 1);
  const trimmed = text.trim();
  if (trimmed.length <= max) return { text: trimmed, truncated: false };
  const cut = keep === "tail" ? trimmed.slice(-max) : trimmed.slice(0, max);
  return { text: keep === "tail" ? `…${cut}` : `${cut}…`, truncated: true };
}

export function buildBatch(input: WhenInput): { batch: DecisionBatch; truncated: boolean } {
  const when = input.when.trim();
  if (!when) throw new Error("`when` must be a non-empty condition");
  const max = input.maxEvidenceChars ?? DEFAULTS.maxEvidenceChars;
  const keep = input.keep ?? "tail";
  const now = clip(input.evidence, max, keep);
  const hasPrevious = input.previous !== undefined && input.previous !== null;
  const before = hasPrevious ? clip(input.previous, max, keep) : null;

  const state: Record<string, string> = before
    ? { previous_observation: before.text, current_observation: now.text }
    : { observation: now.text };

  // The condition lives only in the labels. Repeating it in the instructions
  // leaks it into the premise, and entailment-style models then say "yes" to
  // everything (measured: 50% on the benchmark, every case p > 0.93).
  const instructions = before
    ? "Compare the previous and current observations. Which description is true now?"
    : "Read the observation. Which description is true now?";

  // Parallel labels: small zero-shot classifiers (ONNX) compare the two texts,
  // so both sides should read like the same kind of statement.
  const falseText = input.notWhen?.trim() ? input.notWhen.trim() : `Not the case: ${when}`;

  return {
    batch: {
      state,
      questions: {
        [QUESTION_ID]: {
          type: "boolean",
          instructions,
          criteria: { true: when, false: falseText },
        },
      },
    },
    truncated: now.truncated || Boolean(before?.truncated),
  };
}

export function interpret(
  outcome: DecisionOutcome,
  threshold: number,
  latencyMs: number,
  truncated: boolean,
): WhenVerdict {
  const base = { threshold, latencyMs: Math.round(latencyMs), truncated };
  if (outcome.status !== "ok") {
    return {
      ...base,
      matched: false,
      probability: null,
      model: null,
      provider: null,
      unavailable: outcome.reason,
      inputTokens: null,
    };
  }
  const answer = outcome.result.answers[QUESTION_ID];
  if (!answer || answer.type !== "boolean") {
    return {
      ...base,
      matched: false,
      probability: null,
      model: outcome.result.model,
      provider: outcome.provenance.providerId,
      unavailable: "invalid-response",
      inputTokens: outcome.result.usage?.inputTokens ?? null,
    };
  }
  const p = answer.probabilityTrue;
  return {
    ...base,
    matched: p >= threshold,
    probability: Math.round(p * 1e4) / 1e4,
    model: outcome.result.model,
    provider: outcome.provenance.providerId,
    unavailable: null,
    inputTokens: outcome.result.usage?.inputTokens ?? null,
  };
}
