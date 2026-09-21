import { DANGEROUS_WORDS, safeAgentUrl, taskCandidates } from "./policy.ts";
import type { AgentBrowser, AgentObservation } from "./types.ts";

type LocalAction = { kind: "click" | "fill" | "select"; element: HTMLElement; fingerprint: string; value?: string }
  | { kind: "navigate"; url: string; element?: HTMLAnchorElement; fingerprint?: string } | { kind: "scroll"; direction: number } | { kind: "back"; url: string };
type PageSession = { documentId: string; url: string; actions: Map<string, LocalAction> };
declare global { interface Window { __voltAgent?: PageSession } }
type PageCommand = { kind: "observe"; values: string[]; urls: string[]; step: number; dangerousWords: string }
  | { kind: "execute"; documentId: string; url: string; candidateId: string; dangerousWords: string };

/** Bundled code only. Runs in Chrome's isolated world, not the page's main world. */
export function agentPage(command: PageCommand): AgentObservation | null {
  const blocked = new RegExp(command.dangerousWords, "i");
  const safeUrl = (value: string) => {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.port &&
        /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) &&
        !/(?:^|\.)(localhost|local|internal|test|invalid|example)$/i.test(url.hostname) && !blocked.test(decodeURIComponent(url.pathname));
    } catch { return false; }
  };
  const visible = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return element.isConnected && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.visibility !== "hidden" && style.display !== "none" && !element.closest('[hidden],[inert],[aria-hidden="true"]');
  };
  const label = (element: HTMLElement) => [element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("placeholder"), element.getAttribute("name"), element.innerText?.slice(0, 180), element.id].filter(Boolean).join(" ").trim().slice(0, 250);
  const fingerprint = (element: HTMLElement) => JSON.stringify([element.tagName, label(element), element.getAttribute("type"), element.getAttribute("href"), element.getAttribute("formaction"), element.closest("form")?.getAttribute("action")]);
  const sensitive = (element: HTMLElement) => blocked.test(label(element)) || /(?:cc-|credit|card|cvc|cvv|ssn|otp|one-time|email|tel|address|birth|auth|pass)/i.test([element.getAttribute("autocomplete"), element.getAttribute("name"), element.id, element.getAttribute("type")].join(" ")) || !!element.closest('form[action*="checkout"],form[action*="login"],form[action*="account"]');
  if (!safeUrl(location.href)) throw new Error("This page is outside the agent's public browsing scope.");
  if (/captcha|verify (?:you|that you)|access denied|pardon our interruption/i.test(document.title + " " + (document.body?.innerText ?? "").slice(0, 1000))) throw new Error("The site needs manual verification. Agent stopped.");

  if (command.kind === "execute") {
    const session = window.__voltAgent;
    if (!session || session.documentId !== command.documentId || session.url !== command.url || location.href !== command.url) throw new Error("The page changed. No action was executed.");
    const action = session.actions.get(command.candidateId);
    window.__voltAgent = undefined; // Single-use actions cannot be replayed.
    if (!action) throw new Error("The selected action is unavailable.");
    if (action.kind === "navigate" || action.kind === "back") {
      if (!safeUrl(action.url)) throw new Error("Navigation is blocked.");
      if (action.kind === "navigate" && action.element && (!visible(action.element) || sensitive(action.element) || action.element.href !== action.url || fingerprint(action.element) !== action.fingerprint)) throw new Error("The observed link changed. No navigation was executed.");
      location.assign(action.url);
    } else if (action.kind === "scroll") {
      window.scrollBy({ top: action.direction * Math.max(200, innerHeight * 0.8), behavior: "instant" });
    } else {
      const element = action.element;
      if (!visible(element) || sensitive(element) || fingerprint(element) !== action.fingerprint || element.matches(':disabled,[aria-disabled="true"]')) throw new Error("The element changed or is no longer safe. No action was executed.");
      if (action.kind === "click") {
        const form = element.closest("form");
        if (form && (form.method.toLowerCase() !== "get" || Array.from(form.querySelectorAll<HTMLElement>("input")).some((input) => sensitive(input)))) throw new Error("The form changed or contains sensitive fields. No action was executed.");
        element.click();
      }
      else if (action.kind === "fill" && element instanceof HTMLInputElement && /^(text|search)$/.test(element.type)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setter || action.value === undefined) throw new Error("The input is unavailable.");
        setter.call(element, action.value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (action.kind === "select" && element instanceof HTMLSelectElement && action.value !== undefined && Array.from(element.options).some((option) => option.value === action.value && !option.disabled && !blocked.test(option.text))) {
        element.value = action.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else throw new Error("The action no longer matches the element.");
    }
    return null;
  }

  const session: PageSession = { documentId: crypto.randomUUID(), url: location.href, actions: new Map() };
  const candidates: AgentObservation["candidates"] = [];
  const add = (action: LocalAction, description: string) => {
    if (candidates.length >= 60) return;
    const id = `action_${candidates.length}`;
    candidates.push({ id, kind: action.kind, description: description.slice(0, 350) });
    session.actions.set(id, action);
  };
  for (const url of command.urls) if (safeUrl(url)) add({ kind: "navigate", url }, `Navigate to task URL ${url}`);
  const elements = Array.from(document.querySelectorAll<HTMLElement>('a[href],button,input,select,[role="button"]')).filter(visible);
  for (const element of elements.slice(0, 150)) {
    if (sensitive(element) || element.matches(':disabled,[aria-disabled="true"]')) continue;
    const name = label(element);
    if (!name) continue;
    if (element instanceof HTMLAnchorElement && safeUrl(element.href)) add({ kind: "navigate", url: element.href, element, fingerprint: fingerprint(element) }, `Open link ${name}: ${element.href}`);
    else if (element instanceof HTMLInputElement && /^(text|search)$/.test(element.type)) {
      for (const value of command.values) add({ kind: "fill", element, fingerprint: fingerprint(element), value }, `Fill ${name} with task text: ${value}`);
    } else if (element instanceof HTMLSelectElement) {
      for (const option of Array.from(element.options).slice(0, 12)) if (!option.disabled && !blocked.test(option.text)) add({ kind: "select", element, fingerprint: fingerprint(element), value: option.value }, `Select ${option.text.slice(0, 100)} in ${name}`);
    } else if ((element instanceof HTMLButtonElement || element.getAttribute("role") === "button") && /\b(search|next|previous|more|filter|sort|expand|collapse|menu|close|back)\b/i.test(name)) {
      const form = element.closest("form");
      if (form && !/search/i.test([form.getAttribute("role"), form.getAttribute("action"), name].join(" "))) continue;
      if (form && (form.method.toLowerCase() !== "get" || Array.from(form.querySelectorAll<HTMLElement>("input")).some((input) => sensitive(input)))) continue;
      add({ kind: "click", element, fingerprint: fingerprint(element) }, `Click ${name}`);
    }
  }
  if (scrollY > 0) add({ kind: "scroll", direction: -1 }, "Scroll up");
  if (scrollY + innerHeight < document.documentElement.scrollHeight) add({ kind: "scroll", direction: 1 }, "Scroll down");
  // A concrete observed referrer is used instead of opaque history.back().
  if (document.referrer && safeUrl(document.referrer)) add({ kind: "back", url: document.referrer }, `Back to observed referring page ${document.referrer}`);
  const textElements = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,p,li,td,th,label,article"));
  const text = textElements.filter((element) => visible(element) && !sensitive(element) && !element.querySelector('input,textarea,[contenteditable="true"]')).map((element) => element.innerText).join("\n");
  window.__voltAgent = session;
  return { documentId: session.documentId, url: location.href, title: document.title.slice(0, 250), text: text.slice(0, 10000), truncated: text.length > 10000 || elements.length > 150 || candidates.length >= 60, step: command.step, candidates };
}

export async function createAgentBrowser(signal: AbortSignal): Promise<AgentBrowser> {
  signal.throwIfAborted();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  signal.throwIfAborted();
  if (tab?.id === undefined || !tab.url || !safeAgentUrl(tab.url)) throw new Error("Open a public website in the active tab before starting Agent.");
  const tabId = tab.id;
  let closed = false;
  const check = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (closed) throw new Error("Agent session ended.");
    const current = await chrome.tabs.get(tabId);
    signal.throwIfAborted();
    if (!current.active || !current.url || !safeAgentUrl(current.url)) throw new Error("The active tab changed or left the browsing scope. Agent stopped.");
    return current;
  };
  return {
    async observe(goal, step, signal) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const current = await check(signal);
        if (current.status === "complete") {
          const values = taskCandidates(goal);
          const result = await chrome.scripting.executeScript({ target: { tabId }, func: agentPage, args: [{ kind: "observe", ...values, step, dangerousWords: DANGEROUS_WORDS }] });
          signal.throwIfAborted();
          const observation = result[0]?.result;
          if (!observation) throw new Error("Could not observe the active page.");
          return observation;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("The active page did not finish loading.");
    },
    async execute(observation, candidateId, signal) {
      const current = await check(signal);
      if (current.url !== observation.url || current.pendingUrl) throw new Error("The page navigated before the action. Agent stopped.");
      await chrome.scripting.executeScript({ target: { tabId }, func: agentPage, args: [{ kind: "execute", documentId: observation.documentId, url: observation.url, candidateId, dangerousWords: DANGEROUS_WORDS }] });
      signal.throwIfAborted();
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      signal.throwIfAborted();
    },
    close() { closed = true; },
  };
}
