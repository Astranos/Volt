import { defineConfig, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { GET } from './api/catalog';

// Both local modes exercise the same server boundary that Vercel serves.
function catalogApi(): Plugin {
  const middleware = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/catalog') {
      next();
      return;
    }
    try {
      const result = await GET(new Request(url, { method: request.method }));
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

export default defineConfig({
  plugins: [catalogApi(), tailwindcss(), react()],
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
});
