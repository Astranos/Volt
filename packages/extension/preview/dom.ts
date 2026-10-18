// Helpers for scenario `act` steps.

export async function waitFor<T extends Element>(selector: string, timeout = 5000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
    if (performance.now() - start > timeout) throw new Error(`Timed out waiting for ${selector}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Sets an input's value the way React notices, as if the user typed it. */
export async function typeInto(selector: string, text: string) {
  const input = await waitFor<HTMLInputElement>(selector);
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
