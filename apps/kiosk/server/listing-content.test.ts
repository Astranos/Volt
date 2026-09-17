import { describe, expect, it } from 'vitest';
import { parseListingContent } from './listing-content';

describe('parseListingContent', () => {
  it('keeps included-item exclusions inside span-wrapped divs as separate paragraphs', () => {
    expect(parseListingContent('<div><span><div>Game</div></span><span><div><b>Sorry, no box</b></div></span></div>', 'Game')).toEqual([
      { kind: 'paragraph', text: 'Game' }, { kind: 'paragraph', text: 'Sorry, no box' },
    ]);
  });
  it('keeps plain text and inline wrappers together without requiring paragraph tags', () => {
    expect(parseListingContent('Tested <strong>and working</strong>.', 'Phone')).toEqual([{ kind: 'paragraph', text: 'Tested and working.' }]);
  });
  it('preserves sections, lists, nested-cell specifications, and warnings', () => {
    const blocks = parseListingContent(`
      <h1>Apple iPad</h1><h2>Included</h2>
      <ul><li><span>Charger</span></li><li>Case</li></ul>
      <p><b>Important:</b> Battery tested.</p><h3>Specifications</h3>
      <table><tr><th><span>Storage</span></th><td><p>128 GB</p></td></tr>
      <tr><th>Condition</th><td><div>Good</div></td></tr></table>
      <h3>Cosmetic / Functionality</h3><p>Minor marks.</p>`, 'Apple iPad');
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Included' },
      { kind: 'list', items: ['Charger', 'Case'] },
      { kind: 'paragraph', text: 'Important: Battery tested.' },
      { kind: 'heading', text: 'Specifications' },
      { kind: 'specifications', rows: [{ label: 'Storage', value: '128 GB' }, { label: 'Condition', value: 'Good' }] },
      { kind: 'heading', text: 'Cosmetic / Functionality' },
      { kind: 'paragraph', text: 'Minor marks.' },
    ]);
  });

  it('escapes and skips executable or embedded content while retaining plain fallback text', () => {
    const blocks = parseListingContent('<script>alert(1)</script><p>Works &amp; tested <script>leak</script></p><div>Plain fallback</div><form>Ignore me</form><img src="x">', 'Phone');
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'Works & tested' }, { kind: 'paragraph', text: 'Plain fallback' }]);
  });

  it('does not emit duplicate flattened table content or empty noise', () => {
    const blocks = parseListingContent('<div><table><tbody><tr><td><span>Color</span></td><td><b>Black</b></td></tr></tbody></table></div><p> </p>', 'Phone');
    expect(blocks).toEqual([{ kind: 'specifications', rows: [{ label: 'Color', value: 'Black' }] }]);
  });
});
