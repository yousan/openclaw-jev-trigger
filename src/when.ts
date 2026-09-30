// One evaluation of a plain-language condition through the host's
// decisionModel role. The runtime is injected so tests can fake it.

import type { DecisionRuntimeV1 } from "openclaw/plugin-sdk/decisions";
import {
  buildBatch,
  DEFAULTS,
  interpret,
  PURPOSE,
  RUBRIC_VERSION,
  type WhenInput,
  type WhenVerdict,
} from "./rubric.js";

export type WhenOptions = {
  agentId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
};

export async function evaluateWhen(
  runtime: Pick<DecisionRuntimeV1, "evaluate">,
  input: WhenInput,
  options: WhenOptions = {},
): Promise<WhenVerdict> {
  const threshold = input.threshold ?? DEFAULTS.threshold;
  if (!(threshold > 0 && threshold <= 1)) throw new Error("`threshold` must be in (0, 1]");
  const { batch, truncated } = buildBatch(input);
  const now = options.now ?? (() => performance.now());
  const started = now();
  // Cancellation must reject, not turn into a quiet "no" (host contract).
  const outcome = await runtime.evaluate(batch, {
    ...(options.agentId ? { agentId: options.agentId } : {}),
    purpose: PURPOSE,
    rubricVersion: RUBRIC_VERSION,
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    signal: options.signal ?? new AbortController().signal,
  });
  return interpret(outcome, threshold, now() - started, truncated);
}
