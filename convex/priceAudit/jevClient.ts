import type { ChoiceAnswer, ChoiceQuestion, JevClient } from "../../packages/extension/src/price-audit/types.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const REQUEST_TIMEOUT_MS = 30_000;
const failure = () => new Error("Jev could not return a valid decision. Please retry the audit.");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isProbability = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function parseAnswers(value: unknown, questions: Record<string, ChoiceQuestion>): Record<string, ChoiceAnswer> {
  if (!isRecord(value) || !isRecord(value.answers)) throw failure();
  if (Object.keys(value.answers).length !== Object.keys(questions).length) throw failure();
  const answers: Record<string, ChoiceAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = value.answers[id];
    if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string"
      || !Object.hasOwn(question.criteria, answer.choice) || !isProbability(answer.confidence)
      || !isRecord(answer.probabilities)) throw failure();
    const options = Object.keys(question.criteria);
    const probabilities = answer.probabilities;
    if (Object.keys(probabilities).length !== options.length
      || options.some((option) => !Object.hasOwn(probabilities, option) || !isProbability(probabilities[option]))) throw failure();
    const values = Object.values(probabilities).filter(isProbability);
    const selected = probabilities[answer.choice];
    if (!isProbability(selected) || Math.abs(values.reduce((sum, probability) => sum + probability, 0) - 1) > 0.02
      || values.some((probability) => probability > selected)) throw failure();
    answers[id] = { choice: answer.choice, probability: selected, confidence: answer.confidence };
  }
  return answers;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    function abort() { clearTimeout(timer); reject(new DOMException("Audit stopped", "AbortError")); }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function createJevClient({ apiKey, onRequest, beforeRequest, fetchImpl = fetch }: {
  apiKey: string;
  onRequest?: () => void;
  beforeRequest?: () => Promise<void>;
  fetchImpl?: typeof fetch;
}): JevClient {
  return {
    async choose(state, questions, signal) {
      const requested = Object.values(questions);
      if (requested.length === 0 || requested.length > 255 || requested.some((question) => {
        const count = Object.keys(question.criteria).length;
        return count === 0 || count > 255;
      })) throw failure();
      let body: string;
      try { body = JSON.stringify({ model: "jev-latest", state, questions }); }
      catch { throw failure(); }
      if (body.length > 90_000) throw new Error("Jev request exceeds the audit context limit.");
      for (let attempt = 0; attempt < 3; attempt++) {
        signal.throwIfAborted();
        await beforeRequest?.();
        signal.throwIfAborted();
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
        let retry = false;
        let safeFailureMessage = failure().message;
        try {
          onRequest?.();
          const response = await fetchImpl(ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body,
            signal: controller.signal,
            credentials: "omit",
            redirect: "error",
          });
          if ((response.status === 429 || response.status === 529) && attempt < 2) retry = true;
          else {
            if (response.status === 401 || response.status === 403) safeFailureMessage = "Jev rejected the API key. Check the key and its access permissions.";
            if (response.status === 429 || response.status === 529) safeFailureMessage = "Jev is rate limited or temporarily unavailable. Please retry later.";
            if (!response.ok) throw failure();
            const value: unknown = await response.json();
            signal.throwIfAborted();
            return parseAnswers(value, questions);
          }
        } catch {
          if (signal.aborted) throw new DOMException("Audit stopped", "AbortError");
          throw new Error(safeFailureMessage);
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
        }
        if (retry) await pause(500 * 2 ** attempt, signal);
      }
      throw failure();
    },
  };
}
