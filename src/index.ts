import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { DEFAULTS } from "./rubric.js";
import { evaluateWhen } from "./when.js";

const configSchema = Type.Object(
  {
    threshold: Type.Optional(
      Type.Number({
        minimum: 0.01,
        maximum: 1,
        description: `Default probability needed to fire (default ${DEFAULTS.threshold}).`,
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 30_000,
        description: `Decision deadline in ms (default ${DEFAULTS.timeoutMs}).`,
      }),
    ),
    maxEvidenceChars: Type.Optional(
      Type.Integer({
        minimum: 200,
        maximum: 200_000,
        description: `Evidence is clipped to this many characters (default ${DEFAULTS.maxEvidenceChars}). Local ONNX models need ~1500.`,
      }),
    ),
  },
  { additionalProperties: false },
);

const Observation = Type.Union([
  Type.String(),
  Type.Record(Type.String(), Type.Unknown()),
  Type.Array(Type.Unknown()),
  Type.Null(),
]);

const parameters = Type.Object(
  {
    when: Type.String({
      minLength: 1,
      description: 'The condition in plain language, e.g. "CI turned red" or "the work in this thread is finished".',
    }),
    notWhen: Type.Optional(
      Type.String({
        description: 'The look-alike that must NOT fire, e.g. "the assistant is only waiting for a reply".',
      }),
    ),
    evidence: Type.Unsafe<unknown>({
      ...Observation,
      description: "What the watcher observed this run (text or JSON).",
    }),
    previous: Type.Optional(
      Type.Unsafe<unknown>({
        ...Observation,
        description: 'What it observed last run. Pass it for change conditions ("the price dropped").',
      }),
    ),
    threshold: Type.Optional(Type.Number({ minimum: 0.01, maximum: 1 })),
    keep: Type.Optional(
      Type.Union([Type.Literal("head"), Type.Literal("tail")], {
        description: "Which end of long evidence to keep (default tail).",
      }),
    ),
  },
  { additionalProperties: false },
);

const outputSchema = Type.Object(
  {
    matched: Type.Boolean(),
    probability: Type.Union([Type.Number(), Type.Null()]),
    threshold: Type.Number(),
    model: Type.Union([Type.String(), Type.Null()]),
    provider: Type.Union([Type.String(), Type.Null()]),
    unavailable: Type.Union([Type.String(), Type.Null()]),
    latencyMs: Type.Number(),
    inputTokens: Type.Union([Type.Number(), Type.Null()]),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export default defineToolPlugin({
  id: "jev-trigger",
  name: "Jev Trigger",
  description:
    "Natural-language conditions for OpenClaw automations, judged by the decisionModel role (hosted Jev, local Kev, or ONNX).",
  configSchema,
  tools: (tool) => [
    tool({
      name: "jev_when",
      label: "Jev: is this condition true?",
      description:
        "Judge whether a plain-language condition holds for an observation, using the agent's decisionModel (e.g. typesafe/jev-latest). Returns matched + probability. Built for automation trigger scripts: fire only when matched.",
      parameters,
      factory: ({ api, config, toolContext }) => ({
        name: "jev_when",
        label: "Jev: is this condition true?",
        description:
          "Judge whether a plain-language condition holds for an observation, using the agent's decisionModel. Returns matched + probability.",
        parameters,
        outputSchema,
        hideFromChannelProgress: true,
        async execute(_toolCallId: string, params: any, signal?: AbortSignal) {
          const verdict = await evaluateWhen(
            api.runtime.decisions,
            {
              ...params,
              threshold: params.threshold ?? config.threshold,
              maxEvidenceChars: config.maxEvidenceChars,
            },
            { agentId: toolContext.agentId, timeoutMs: config.timeoutMs, signal },
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(verdict) }],
            details: verdict,
          };
        },
      }),
    }),
  ],
});
