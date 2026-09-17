import { createHmac } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { z } from 'zod';
import { createCatalogService } from './catalog.js';
import { isStoreSlug } from './stores.js';
import { createRequestInputSchema, updateRequestInputSchema, queueResponseSchema, requestReceiptSchema, productRequestSchema } from '../src/requests.js';
import type { ProductRequest, RequestReceipt, QueueResponse, UpdateRequestInput } from '../src/requests.js';

type Snapshot = Pick<ProductRequest, 'productId' | 'variantId' | 'title' | 'variantTitle' | 'sku' | 'imageUrl' | 'priceCents' | 'productUrl'>;
type EnqueueArgs = { secret: string; storeSlug: string; requestKey: string; clientHash: string; product: Snapshot };
type Config = { url: string; secret: string };
export type RequestBackend = {
  enqueue(args: EnqueueArgs): Promise<RequestReceipt>;
  list(args: { secret: string; storeSlug: string }): Promise<QueueResponse>;
  setStatus(args: UpdateRequestInput & { secret: string }): Promise<ProductRequest | null>;
};
const catalogService = createCatalogService();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const failure = (status: number, message: string) => Object.assign(new Error(message), { status });
function parseBackend<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw failure(503, 'Item requests are temporarily unavailable. Please ask an associate.');
  return parsed.data;
}

function config(): Config {
  const url = process.env.KIOSK_CONVEX_URL;
  const secret = process.env.KIOSK_REQUEST_SECRET;
  if (!url || !secret || secret.length < 32) throw failure(503, 'Item requests are not configured yet. Please ask an associate.');
  return { url, secret };
}

function backend(configuration: Config, signal: AbortSignal): RequestBackend {
  // A client per HTTP request keeps cancellation isolated from other kiosks.
  const client = new ConvexHttpClient(configuration.url, {
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });
  return {
    enqueue: args => client.mutation(makeFunctionReference<'mutation', EnqueueArgs, RequestReceipt>('kioskRequests:enqueue'), args),
    list: args => client.query(makeFunctionReference<'query', typeof args & { now: number }, QueueResponse>('kioskRequests:list'), { ...args, now: Date.now() }),
    setStatus: args => client.mutation(makeFunctionReference<'mutation', typeof args, ProductRequest | null>('kioskRequests:setStatus'), args),
  };
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw failure(400, 'Send a JSON request.');
  if (Number(request.headers.get('content-length')) > 8192) throw failure(400, 'Request is too large.');
  if (!request.body) throw failure(400, 'Request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 8192) throw failure(400, 'Request is too large.');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure(400, 'Invalid JSON request.'); }
}

function errorResponse(error: unknown): Response {
  let status = 503;
  let message = 'Item requests are temporarily unavailable. Please ask an associate.';
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
    status = error.status; message = error.message;
  } else if (error instanceof z.ZodError) {
    status = 400; message = 'Invalid request.';
  } else if (error instanceof Error && 'statusCode' in error && error.statusCode === 404) {
    status = 404; message = 'Store not found.';
  } else if (error instanceof ConvexError) {
    const data = z.object({ code: z.string() }).safeParse(error.data);
    switch (data.success ? data.data.code : '') {
      case 'RATE_LIMITED': case 'QUEUE_FULL': status = 429; message = 'The request queue is busy. Please ask an associate or try again shortly.'; break;
      case 'CONFLICT': status = 409; message = 'This request is already closed or conflicts with an earlier request.'; break;
      case 'INVALID_INPUT': status = 400; message = 'Invalid request.'; break;
    }
  }
  return Response.json({ error: message }, { status, headers });
}

export function createRequestHandlers({ getCatalog = catalogService.getCatalog, getConfig = config, createBackend = backend, now = Date.now }: {
  getCatalog?: typeof catalogService.getCatalog;
  getConfig?: () => Config;
  createBackend?: (config: Config, signal: AbortSignal) => RequestBackend;
  now?: () => number;
} = {}) {
  async function handle(request: Request): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = async () => {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(request.url).origin) throw failure(400, 'Use this store’s website to send requests.');
        if (!['GET', 'POST', 'PATCH'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: 'GET, POST, PATCH' } });
        const configuration = getConfig();
        const db = createBackend(configuration, controller.signal);
        if (request.method === 'GET') {
          const params = new URL(request.url).searchParams;
          const storeSlug = params.get('store');
          if (!storeSlug || params.getAll('store').length !== 1 || !isStoreSlug(storeSlug)) throw failure(400, 'A valid store is required.');
          return Response.json(parseBackend(queueResponseSchema, await db.list({ secret: configuration.secret, storeSlug })), { headers });
        }
        const raw = await readJson(request);
        if (request.method === 'PATCH') {
          const input = updateRequestInputSchema.parse(raw);
          if (!isStoreSlug(input.storeSlug)) throw failure(400, 'A valid store is required.');
          const result = await db.setStatus({ ...input, secret: configuration.secret });
          if (!result) throw failure(404, 'Request not found or expired.');
          return Response.json(parseBackend(productRequestSchema, result), { headers });
        }
        const input = createRequestInputSchema.parse(raw);
        if (!isStoreSlug(input.storeSlug) || input.requestKey.split(':')[1] !== input.variantId) throw failure(400, 'Invalid request.');
        const catalog = await getCatalog(input.storeSlug);
        if (catalog.status !== 'fresh' || now() - Date.parse(catalog.checkedAt) >= 60_000) throw failure(503, 'Inventory needs to refresh before requesting this item.');
        const product = catalog.products.find(item => item.id === input.productId);
        if (!product) throw failure(404, 'This item is no longer available.');
        const variant = product.variants.find(item => item.id === input.variantId);
        if (!variant) throw failure(409, 'This item is no longer available.');
        if (controller.signal.aborted) throw failure(503, 'Item requests timed out. Please try again.');
        const result = await db.enqueue({
          secret: configuration.secret, storeSlug: input.storeSlug, requestKey: input.requestKey,
          clientHash: createHmac('sha256', configuration.secret).update(input.requestKey.slice(0, input.requestKey.indexOf(':')).toLowerCase()).digest('hex'),
          product: { productId: product.id, variantId: variant.id, title: product.title.slice(0, 500), variantTitle: variant.title.slice(0, 300), sku: variant.sku, imageUrl: product.images[0] ?? null, priceCents: variant.priceCents, productUrl: product.url },
        });
        return Response.json(parseBackend(requestReceiptSchema, result), { headers });
      };
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(failure(503, 'Item requests timed out. Please try again.')); }, 12_000);
      });
      return await Promise.race([operation(), timeout]);
    } catch (error) { return errorResponse(error); }
    finally { if (timer) clearTimeout(timer); }
  }
  return { GET: handle, POST: handle, PATCH: handle };
}
