import { describe, expect, it } from 'vitest';
import { getStore, isStoreSlug, readStoreMetadata } from './stores.js';

function store(slug = 'southfieldmi') {
  const result = getStore(slug);
  if (!result) throw new Error('Invalid test store');
  return result;
}

describe('automatic franchise resolution', () => {
  it.each(['southfieldmi', 'taylormi', 'new-franchise42', '1stavenue', 'a', 'a'.repeat(63)])('accepts %s without a registry', (slug) => {
    expect(isStoreSlug(slug)).toBe(true);
    expect(getStore(slug)).toEqual({ slug, name: slug, region: '', address: '', storefrontUrl: `https://${slug}.paymore.com` });
  });
  it.each(['', 'Southfieldmi', 'mi01', 'MI01', 'ny123', 'www', 'api', 'admin', 'mail', 'shop', 'localhost', '-abc', 'abc-', 'a'.repeat(64), '127.0.0.1', 'abc.paymore.com', 'abc/def', 'abc?x=1', 'abc#x', 'abc:443', 'abc@evil.com', 'https://southfieldmi.paymore.com', 'abc%2fdef', 'abc\n'])('rejects unsafe or internal slug %s', (slug) => {
    expect(getStore(slug)).toBeNull();
  });
});

describe('optional storefront metadata', () => {
  it('reads Southfield source address and city', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ElectronicsStore', url: 'https://southfieldmi.paymore.com/', name: 'PAYMORE Southfield', address: { addressLocality: 'Southfield', addressRegion: 'Michigan', streetAddress: '123 Example Road' } })}</script>`;
    expect(readStoreMetadata(html, store())).toEqual({ ...store(), name: 'Southfield', region: 'Michigan', address: '123 Example Road' });
  });
  it('reads arrays and graphs, retaining approved URL and slug', () => {
    const html = '<script type="application/ld+json">[{"@graph":[{"@type":["LocalBusiness"],"url":"https://taylormi.paymore.com/","address":{"addressLocality":"Taylor","addressRegion":"MI"}}]}]</script>';
    expect(readStoreMetadata(html, store('taylormi'))).toEqual({ ...store('taylormi'), name: 'Taylor', region: 'MI' });
  });
  it('rejects mismatched business origins', () => {
    const html = '<script type="application/ld+json">{"@type":"LocalBusiness","url":"https://evil.example","address":{"addressLocality":"Wrong city"}}</script>';
    expect(readStoreMetadata(html, store())).toEqual(store());
  });
  it('uses readable meta and title fallbacks without fabricated geography', () => {
    expect(readStoreMetadata('<meta property="og:site_name" content="PAYMORE - Southfield">', store())).toEqual({ ...store(), name: 'Southfield' });
    expect(readStoreMetadata('<title>PayMore Taylor</title>', store('taylormi')).name).toBe('Taylor');
  });
  it.each(['', '<script type="application/ld+json">{bad}</script>', '<title>PayMore</title>', 'x'.repeat(1_000_001)])('gracefully retains defaults on missing or unusable metadata', (html) => {
    expect(readStoreMetadata(html, store())).toEqual(store());
  });
});
