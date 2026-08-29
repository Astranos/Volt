export type ParsedIdentity = {
  title: string;
  platform: string | null;
  edition: string | null;
};

const CONDITION_PREFIX = /^(new|used|sealed)\s+/i;
const COMPLETENESS_SUFFIX = /\s+(cartridge only|case only|disc only|cib)$/i;
const REGION_SUFFIX = /\s+(pal|ntsc-u|ntsc-j|ntsc)$/i;
const EDITION_BRACKETS = /\[([^\]]+)\]/g;
const TRAILING_PARENS = /\(([^)]+)\)\s*$/;
const YEAR_SUFFIX = /,\s*(?:19|20)\d{2}$/;

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseProductIdentity(rawTitle: string): ParsedIdentity {
  let remaining = collapseWhitespace(rawTitle);
  remaining = remaining.replace(COMPLETENESS_SUFFIX, "");
  remaining = remaining.replace(REGION_SUFFIX, "");

  let platform: string | null = null;
  const parens = remaining.match(TRAILING_PARENS);
  if (parens?.[1]) {
    platform = collapseWhitespace(parens[1].replace(YEAR_SUFFIX, ""));
    remaining = collapseWhitespace(remaining.slice(0, parens.index));
  }

  const editions: string[] = [];
  remaining = remaining.replace(EDITION_BRACKETS, (_match, edition: string) => {
    const cleaned = collapseWhitespace(edition);
    if (cleaned) editions.push(cleaned);
    return " ";
  });
  remaining = collapseWhitespace(remaining.replace(CONDITION_PREFIX, ""));

  return {
    title: remaining,
    platform: platform || null,
    edition: editions[0] ?? null,
  };
}
