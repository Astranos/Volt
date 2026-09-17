import { load } from 'cheerio';
import { isTag, type AnyNode } from 'domhandler';
import type { DetailBlock } from '../src/catalog';

const MAX_BLOCKS = 200;
const MAX_TEXT = 2000;
const MAX_ITEMS = 80;
const structuralTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'table', 'div', 'section', 'article']);

export function parseListingContent(html: string, productTitle: string): DetailBlock[] {
  const $ = load(html);
  $('script,style,noscript,form,img,svg,iframe,object,embed,video,audio,template').remove();
  $('br').replaceWith(' ');
  const textOf = (nodes: AnyNode | AnyNode[]) => $(nodes).text().replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  const result: DetailBlock[] = [];
  const add = (block: DetailBlock) => { if (result.length < MAX_BLOCKS) result.push(block); };

  function walk(nodes: AnyNode[]) {
    let inline: AnyNode[] = [];
    const flush = () => {
      const text = textOf(inline);
      if (text) add({ kind: 'paragraph', text });
      inline = [];
    };
    for (const element of nodes) {
      if (result.length >= MAX_BLOCKS) break;
      if (!isTag(element) || (!structuralTags.has(element.tagName.toLowerCase()) && !$(element).find('h1,h2,h3,h4,h5,h6,p,ul,ol,table,div,section,article').length)) {
        inline.push(element);
        continue;
      }
      flush();
      const tag = element.tagName.toLowerCase();
      const node = $(element);
      if (/^h[1-6]$/.test(tag)) {
        const text = textOf(element);
        if (text && text.localeCompare(productTitle.trim(), undefined, { sensitivity: 'accent' }) !== 0) add({ kind: 'heading', text });
      } else if (tag === 'p') {
        const text = textOf(element);
        if (text) add({ kind: 'paragraph', text });
      } else if (tag === 'ul' || tag === 'ol') {
        const items = node.children('li').toArray().map(textOf).filter(Boolean).slice(0, MAX_ITEMS);
        if (items.length) add({ kind: 'list', items });
      } else if (tag === 'table') {
        const rows = node.find('tr').toArray().flatMap(row => {
          const cells = $(row).children('th,td').toArray().map(textOf);
          if (cells.length < 2 || !cells[0]) return [];
          return [{ label: cells[0].replace(/\s*:\s*$/, ''), value: cells.slice(1).join(' · ').slice(0, MAX_TEXT) }];
        }).slice(0, MAX_ITEMS);
        if (rows.length) add({ kind: 'specifications', rows });
      } else {
        walk(node.contents().toArray());
      }
    }
    flush();
  }

  walk($('body').contents().toArray());
  return result;
}
