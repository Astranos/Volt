import { defineConfig, loadEnv, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { GET } from './api/catalog';
import { GET as listRequests, POST as createRequest, PATCH as updateRequest } from './api/requests';

// Both local modes exercise the same server boundary that Vercel serves.
function catalogApi(): Plugin {
  const middleware = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1:4175'}`);
    if (url.pathname !== '/api/catalog' && url.pathname !== '/api/requests') {
      next();
      return;
    }
    try {
      const method = request.method ?? 'GET';
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (value) for (const entry of value) headers.append(name, entry);
      }
      let body: string | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          if (!Buffer.isBuffer(chunk)) throw new Error('Invalid request body');
          bytes += chunk.length;
          if (bytes > 8192) {
            response.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Request is too large.' }));
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      const handler = url.pathname === '/api/catalog' ? GET
        : method === 'GET' ? listRequests : method === 'POST' ? createRequest : method === 'PATCH' ? updateRequest : null;
      const result = handler
        ? await handler(new Request(url, { method, headers, body }))
        : Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { Allow: 'GET, POST, PATCH' } });
      result.headers.forEach((value, key) => response.setHeader(key, value));
      response.writeHead(result.status).end(await result.text());
    } catch {
      response.setHeader('Content-Type', 'application/json');
      response.writeHead(500).end(JSON.stringify({ error: 'Inventory is temporarily unavailable.' }));
    }
  };
  return {
    name: 'paymore-catalog-api',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'KIOSK_');
  for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
  return {
    plugins: [catalogApi(), tailwindcss(), react()],
    server: { host: '127.0.0.1', port: 4175, strictPort: true },
  };
});
