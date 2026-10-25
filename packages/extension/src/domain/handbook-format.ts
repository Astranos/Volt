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

/** Joins address parts into one line: "9058 Telegraph Rd, Taylor, MI 48180". */
export function formatAddress({ street, city, state, zip }: AddressParts) {
  const region = [state.trim().toUpperCase(), zip.trim()].filter(Boolean).join(" ");
  return [street.trim(), city.trim(), region].filter(Boolean).join(", ");
}

/**
 * Best-effort split of a one-line US address, including loosely typed ones like
 * "9058 Telegraph Rd, Taylor MI, 48180". Anything it can't place stays in `street`.
 */
export function parseAddress(value: string): AddressParts {
  let rest = value.trim();
  const zip = rest.match(/(\d{5}(?:-\d{4})?)\s*$/)?.[1] ?? "";
  if (zip) rest = rest.slice(0, rest.length - zip.length).replace(/[\s,]+$/, "");
  const state = zip ? rest.match(/(?:^|[\s,])([A-Za-z]{2})$/)?.[1] ?? "" : "";
  if (state) rest = rest.slice(0, rest.length - state.length).replace(/[\s,]+$/, "");
  const comma = rest.lastIndexOf(",");
  return comma === -1 || !(zip || state)
    ? { street: rest, city: "", state: state.toUpperCase(), zip }
    : { street: rest.slice(0, comma).trim(), city: rest.slice(comma + 1).trim(), state: state.toUpperCase(), zip };
}

/** An address as two display lines: the street, then "City, ST ZIP". */
export function addressLines(value: string) {
  const { street, city, state, zip } = parseAddress(value);
  const region = [state, zip].filter(Boolean).join(" ");
  const second = [city, region].filter(Boolean).join(", ");
  return second ? [street, second] : [street];
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * The format a value entry is edited and shown with. Entries saved before formats
 * existed are inferred from their title, so an existing "Store address" still gets
 * address fields and two-line display.
 */
export function valueFormatOf(entry: Pick<HandbookEntry, "kind" | "title" | "value" | "valueFormat">): HandbookValueFormat {
  if (entry.kind !== "value") return "text";
  if (entry.valueFormat) return entry.valueFormat;
  const title = entry.title.toLowerCase();
  if (/address|location/.test(title)) return "address";
  if (/phone|police|fax|\bcell\b|\btel\b/.test(title) && formatPhoneInput(entry.value ?? "") === entry.value) return "phone";
  return "text";
}

/** The value as it should be shown and copied: addresses are normalized to one clean line. */
export function displayValue(entry: Pick<HandbookEntry, "kind" | "title" | "value" | "valueFormat">) {
  const value = entry.value ?? "";
  return valueFormatOf(entry) === "address" ? formatAddress(parseAddress(value)) : value;
}
