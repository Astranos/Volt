// Internal identifiers stay here. Add approved franchises to this registry.
const stores = new Map([
  ['taylormi', {
    internalCode: 'MI01',
    slug: 'taylormi',
    name: 'Taylor',
    region: 'Michigan',
    address: '9058 Telegraph Road',
    storefrontUrl: 'https://taylormi.paymore.com',
  }],
]);

export function getStore(slug: string) {
  const store = stores.get(slug);
  if (!store) return null;
  const { internalCode, ...publicStore } = store;
  return publicStore;
}
