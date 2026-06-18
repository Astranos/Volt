export function createId(prefix: string) {
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createSecret(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createMessageId(prefix: string) {
  return createId(prefix).replace(/[^a-zA-Z0-9_-]/g, "_");
}
