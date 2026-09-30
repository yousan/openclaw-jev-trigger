// The kind of JavaScript condition you write first. Kept deliberately honest:
// these are the rules a trigger script would start with, not strawmen.

const lastAssistant = (text) =>
  text.split("\n").filter((l) => l.startsWith("[assistant]")).pop() ?? "";

export const rules = {
  // "Is the thread finished?" — look for done-words in the last assistant line,
  // and don't fire on a question.
  "thread-done": ({ evidence }) => {
    const line = lastAssistant(evidence);
    return /\b(done|finished|complete|completed|merged|deployed|wraps up|closing)\b|完了|終わ|終了|以上/i.test(line) &&
      !/[?？]\s*$/.test(line);
  },
  // "Did CI go red?" — the first status token we can find.
  "ci-red": ({ evidence }) => {
    const m = evidence.match(/"conclusion":\s*"(\w+)"|conclusion:\s*(\w+)|\b(failed|failure|FAILED|success|PASSED|passed)\b|(失敗|成功)|(✗|✓)/);
    if (!m) return false;
    const tok = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "").toLowerCase();
    return ["failure", "failed", "失敗", "✗"].includes(tok);
  },
  // "Did the price drop?" — first number on the Price line (or JSON amount).
  "price-drop": ({ evidence, previous }) => {
    const num = (t) => {
      const m = t.match(/"amount":\s*([\d.]+)|Price:[^\d]*([\d,]+(?:\.\d+)?)/);
      return m ? Number((m[1] ?? m[2]).replace(/,/g, "")) : NaN;
    };
    const a = num(previous ?? ""), b = num(evidence);
    return Number.isFinite(a) && Number.isFinite(b) && b < a;
  },
};
