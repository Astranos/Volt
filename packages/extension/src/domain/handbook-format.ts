import type { HandbookEntry } from "./handbook";

export type HandbookValueFormat = NonNullable<HandbookEntry["valueFormat"]>;
export type AddressParts = { street: string; city: string; state: string; zip: string };

const EXTENSION = /\s*(?:x|ext\.?|extension)\s*(\d*)\s*$/i;

/**
 * Formats a US phone number as it's typed: "3136390861" becomes "313-639-0861", and a
 * trailing extension ("x6", "ext 6") is kept as " x6". Input that isn't a plain US
 * number (letters, a leading "+", more than 11 digits) is left exactly as typed.
 */
export function formatPhoneInput(value: string) {
  const extension = value.match(EXTENSION);
  const main = extension ? value.slice(0, extension.index) : value;
  if (!/^[\d\s().-]*$/.test(main)) return value;
  let digits = main.replace(/\D/g, "");
  const country = digits.length === 11 && digits.startsWith("1") ? "1-" : "";
  if (country) digits = digits.slice(1);
  if (digits.length > 10) return value;
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)].filter(Boolean);
  const suffix = extension ? ` x${extension[1]}` : "";
  return `${country}${parts.join("-")}${suffix}`;
}

/**
 * Formats a phone field after a keystroke and says where the caret goes: after the
 * same digit it followed before, or at the very end if it was typing at the end
 * (so "…6611" + "x" + "6" becomes "…6611 x6", not "…66116 x").
 */
export function formatPhoneTyping(raw: string, caret: number) {
  const value = formatPhoneInput(raw);
  if (value === raw) return { value, caret };
  if (caret >= raw.length) return { value, caret: value.length };
  const digitsBefore = raw.slice(0, caret).replace(/\D/g, "").length;
  let position = value.length;
  for (let index = 0, seen = 0; index < value.length; index++) {
    if (seen === digitsBefore) { position = index; break; }
    if (/\d/.test(value[index])) seen++;
  }
  return { value, caret: position };
}

/** Joins address parts into one line: "9058 Telegraph Rd, Taylor, MI 48180". */
export function formatAddress({ street, city, state, zip }: AddressParts) {
  const region = [state.trim().toUpperCase(), zip.trim()].filter(Boolean).join(" ");
  return [street.trim(), city.trim(), region].filter(Boolean).join(", ");
}

// "9058 Telegraph Rd, Taylor, MI 48180", also loosely typed as "…, Taylor MI, 48180".
// The street must start with a number, and a city and a two-letter state must follow it.
const US_ADDRESS = /^\s*(\d.*?),\s*([^,]+?),?\s+([A-Za-z]{2}),?\s+(\d{5}(?:-\d{4})?)\s*$/;
const US_ADDRESS_NO_ZIP = /^\s*(\d.*?),\s*([^,]+?),\s*([A-Za-z]{2})\s*$/;

/** The parts of a value that is clearly a US street address, or null. Nothing is guessed. */
export function recognizeAddress(value: string): AddressParts | null {
  // Real addresses are short; the length cap also keeps the patterns below fast on any input.
  if (value.length > 200) return null;
  const full = value.match(US_ADDRESS);
  if (full) return { street: full[1].trim(), city: full[2].trim(), state: full[3].toUpperCase(), zip: full[4] };
  const noZip = value.match(US_ADDRESS_NO_ZIP);
  if (noZip) return { street: noZip[1].trim(), city: noZip[2].trim(), state: noZip[3].toUpperCase(), zip: "" };
  return null;
}

/** Splits a value into address fields for editing; anything unrecognized stays whole in `street`. */
export function parseAddress(value: string): AddressParts {
  return recognizeAddress(value) ?? { street: value.trim(), city: "", state: "", zip: "" };
}

/** An address as two display lines: the street, then "City, ST ZIP". Unrecognized values stay as typed. */
export function addressLines(value: string) {
  const parts = recognizeAddress(value);
  if (!parts) return [value];
  return [parts.street, [parts.city, [parts.state, parts.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")];
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Titles that say "address" but aren't street addresses.
const NOT_STREET_ADDRESS = /\b(e-?mail|ip|mac|wallet|web|website|url|bitcoin|crypto)\b/;

/**
 * The format a value entry is edited and shown with. Entries saved before formats
 * existed are inferred, but only when both the title and the value agree, so an
 * existing "Store address" gets address fields while an "Email address" or a link
 * in a "Store location" entry is left alone.
 */
export function valueFormatOf(entry: Pick<HandbookEntry, "kind" | "title" | "value" | "valueFormat">): HandbookValueFormat {
  if (entry.kind !== "value") return "text";
  if (entry.valueFormat) return entry.valueFormat;
  const title = entry.title.toLowerCase();
  if (/\baddress\b/.test(title) && !NOT_STREET_ADDRESS.test(title) && recognizeAddress(entry.value ?? "")) return "address";
  if (/phone|police|fax|\bcell\b|\btel\b/.test(title) && formatPhoneInput(entry.value ?? "") === entry.value) return "phone";
  return "text";
}

/** The value as it should be shown and copied. A recognized address is normalized to one clean line; anything else is exact. */
export function displayValue(entry: Pick<HandbookEntry, "kind" | "title" | "value" | "valueFormat">) {
  const value = entry.value ?? "";
  const parts = valueFormatOf(entry) === "address" ? recognizeAddress(value) : null;
  return parts ? formatAddress(parts) : value;
}
