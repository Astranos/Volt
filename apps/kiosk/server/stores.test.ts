import { describe, expect, it } from 'vitest';
import { getStore, isStoreSlug, readStoreMetadata } from './stores.js';

function store(slug = 'paymore-southfield') {
  const result = getStore(slug);
  if (!result) throw new Error('Invalid test store');
  return result;
}

describe('Shopify shop resolution', () => {
  it.each(['paymore-southfield', 'paymore-taylor', 'new-store42', '1stavenue', 'a', 'a'.repeat(63)])('accepts %s without a registry', (slug) => {
    expect(isStoreSlug(slug)).toBe(true);
    expect(getStore(slug)).toEqual({ slug, name: slug, region: '', address: '', storefrontUrl: `https://${slug}.myshopify.com` });
  });
  it.each([['taylormi', 'paymore-taylor'], ['southfieldmi', 'paymore-southfield']])('maps legacy identity %s', (legacy, handle) => {
    expect(getStore(legacy)).toEqual(getStore(handle));
  });
  it.each(['', 'Uppercase', 'mi01', 'MI01', 'ny123', 'www', 'api', 'admin', 'mail', 'shop', 'localhost', '-abc', 'abc-', 'a'.repeat(64), '127.0.0.1', 'abc.myshopify.com', 'abc/def', 'abc?x=1', 'abc#x', 'abc:443', 'abc@evil.com', 'https://example.com', 'abc%2fdef', 'abc\n'])('rejects unsafe or internal slug %s', (slug) => {
    expect(getStore(slug)).toBeNull();
  });
});

describe('optional Shopify metadata', () => {
  it('reads the supplied name and region without fabricating a street address', () => {
    expect(readStoreMetadata({ name: 'PayMore Southfield', city: 'Southfield', province: 'Michigan', country: 'US' }, store()))
      .toEqual({ ...store(), name: 'PayMore Southfield', region: 'Southfield, Michigan, US', address: '' });
  });
  it('keeps partial metadata and never trusts a custom origin or identity', () => {
    expect(readStoreMetadata({ name: 'Taylor', domain: 'evil.example', myshopify_domain: 'other.myshopify.com' }, store('paymore-taylor')))
      .toEqual({ ...store('paymore-taylor'), name: 'Taylor' });
    expect(readStoreMetadata({ city: '  Southfield  ', country: 'US' }, store()).region).toBe('Southfield, US');
    expect(readStoreMetadata({ name: 'Store name', city: null, province: null }, store())).toEqual({ ...store(), name: 'Store name' });
  });
  it.each([null, '', '<html>Not JSON</html>', [], { name: 123 }, { name: 'x'.repeat(301) }])('retains defaults on unusable metadata %j', (value) => {
    expect(readStoreMetadata(value, store())).toEqual(store());
  });
});
