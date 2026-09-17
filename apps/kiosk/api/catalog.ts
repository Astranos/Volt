import { createCatalogService } from '../server/catalog';

const service = createCatalogService();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
  const params = new URL(request.url).searchParams;
  const slug = params.get('store');
  if (!slug || !/^[a-z0-9-]{1,60}$/.test(slug) || params.getAll('store').length !== 1) {
    return Response.json({ error: 'A valid store is required.' }, { status: 400, headers });
  }
  try {
    return Response.json(await service.getCatalog(slug), { headers });
  } catch (error) {
    const status = error instanceof Error && 'statusCode' in error && error.statusCode === 404 ? 404 : 503;
    return Response.json({ error: status === 404 ? 'Store not found.' : 'Inventory is temporarily unavailable. Please ask an associate.' }, { status, headers });
  }
}
