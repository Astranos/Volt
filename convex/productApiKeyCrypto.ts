const PRODUCT_API_KEY_PREFIX = "volt_pd_";
const PRODUCT_API_KEY_RANDOM_BYTES = 24;
const PRODUCT_API_KEY_DISPLAY_LENGTH = PRODUCT_API_KEY_PREFIX.length + 8;

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createProductApiKeyToken(): { token: string; prefix: string } {
  const token = `${PRODUCT_API_KEY_PREFIX}${randomHex(PRODUCT_API_KEY_RANDOM_BYTES)}`;
  return { token, prefix: token.slice(0, PRODUCT_API_KEY_DISPLAY_LENGTH) };
}

export function hasProductApiKeyFormat(value: string): boolean {
  return /^volt_pd_[a-f0-9]{48}$/.test(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
