// Mirrors the Kiosk listing parser (apps/kiosk/server/listing-content.ts) with
// the browser DOM, so compare columns read like the Kiosk product popup.
// Only text is extracted; listing HTML is never rendered.
export type DetailBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "specifications"; rows: Array<{ label: string; value: string }> };

const MAX_BLOCKS = 200;
const MAX_TEXT = 2000;
const MAX_ITEMS = 80;
const STRUCTURAL = "h1,h2,h3,h4,h5,h6,p,ul,ol,table,div,section,article";
const CONDITION_HEADING = /^(?:cosmetic(?:\s+condition)?|functionality(?:\s+condition)?|functional\s+condition)\s*:?$/i;

const textOf = (nodes: Node[]) => nodes.map((node) => node.textContent ?? "").join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

function includedItemLists(blocks: DetailBlock[]): DetailBlock[] {
  const output: DetailBlock[] = [];
  let items: string[] | null = null;
  const flush = () => {
    if (items?.length) output.push({ kind: "list", items });
    items = null;
  };
  for (const block of blocks) {
    if (block.kind === "heading") {
      flush();
      output.push(block);
      if (/^items included(?: in this sale)?\s*:?$/i.test(block.text.trim())) items = [];
    } else if (items !== null && block.kind === "paragraph" && !/^\*?\s*(?:please note\b|sorry\b|important\b|not included\b)/i.test(block.text)) {
      items.push(block.text);
    } else if (items !== null && block.kind === "list") {
      items.push(...block.items);
    } else {
      flush();
      output.push(block);
    }
  }
  flush();
  return output;
}

export function parseListingHtml(html: string, productTitle: string): DetailBlock[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  body.querySelectorAll("script,style,noscript,form,img,svg,iframe,object,embed,video,audio,template").forEach((node) => node.remove());
  body.querySelectorAll("br").forEach((node) => node.replaceWith(" "));
  const result: DetailBlock[] = [];
  const add = (block: DetailBlock) => { if (result.length < MAX_BLOCKS) result.push(block); };

  function walk(nodes: Node[]) {
    let inline: Node[] = [];
    const flush = () => {
      const text = textOf(inline);
      if (text) add({ kind: "paragraph", text });
      inline = [];
    };
    for (const node of nodes) {
      if (result.length >= MAX_BLOCKS) break;
      if (!(node instanceof Element) || (!node.matches(STRUCTURAL) && !node.querySelector(STRUCTURAL))) {
        inline.push(node);
        continue;
      }
      flush();
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = textOf([node]);
        if (text && text.localeCompare(productTitle.trim(), undefined, { sensitivity: "accent" }) !== 0) add({ kind: "heading", text });
      } else if (tag === "p") {
        const text = textOf([node]);
        if (text) add({ kind: "paragraph", text });
      } else if (tag === "ul" || tag === "ol") {
        const items = [...node.children].filter((child) => child.tagName === "LI").map((child) => textOf([child])).filter(Boolean).slice(0, MAX_ITEMS);
        if (items.length) add({ kind: "list", items });
      } else if (tag === "table") {
        const rows = [...node.querySelectorAll("tr")].flatMap((row) => {
          const cells = [...row.children].filter((cell) => cell.tagName === "TH" || cell.tagName === "TD").map((cell) => textOf([cell]));
          if (cells.length < 2 || !cells[0]) return [];
          return [{ label: cells[0].replace(/\s*:\s*$/, ""), value: cells.slice(1).join(" · ").slice(0, MAX_TEXT) }];
        }).slice(0, MAX_ITEMS);
        if (rows.length) add({ kind: "specifications", rows });
      } else {
        walk([...node.childNodes]);
      }
    }
    flush();
  }

  walk([...body.childNodes]);
  return includedItemLists(result);
}

export function partitionListing(details: readonly DetailBlock[]): { conditionNotes: DetailBlock[]; mainDetails: DetailBlock[] } {
  const conditionNotes: DetailBlock[] = [];
  const mainDetails: DetailBlock[] = [];
  let inConditionSection = false;
  for (const block of details) {
    if (block.kind === "heading") inConditionSection = CONDITION_HEADING.test(block.text.trim());
    (inConditionSection ? conditionNotes : mainDetails).push(block);
  }
  return { conditionNotes, mainDetails };
}
