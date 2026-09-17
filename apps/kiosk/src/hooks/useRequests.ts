import { useEffect, useRef, useState } from 'react';
import { productRequestSchema, queueResponseSchema, type ProductRequest, type RequestUpdateStatus } from '../requests';

export function activeRequests(requests: ProductRequest[], now: number) {
  return requests.filter(request => request.expiresAt > now && (request.status === 'waiting' || request.status === 'found')).sort((a, b) => a.createdAt - b.createdAt);
}

export async function requestJson(url: string, init: RequestInit) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  init.signal?.addEventListener('abort', cancel, { once: true });
  if (init.signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 15000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : 'Could not connect. Try again.';
      throw new Error(message);
    }
    return body;
  } catch (failure) {
    if (controller.signal.aborted) throw new Error('Connection timed out. Try again.');
    throw failure;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', cancel);
  }
}

export function useRequests(storeSlug: string) {
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [connection, setConnection] = useState<'loading' | 'connected' | 'disconnected'>('loading');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const revision = useRef(0);
  const offset = useRef(0);
  const updateController = useRef<AbortController | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    async function poll() {
      controller = new AbortController();
      const currentRevision = revision.current;
      try {
        const result = queueResponseSchema.parse(await requestJson(`/api/requests?store=${encodeURIComponent(storeSlug)}`, { signal: controller.signal }));
        if (stopped || currentRevision !== revision.current) return;
        offset.current = result.serverNow - Date.now();
        setNow(result.serverNow);
        setRequests(result.requests);
        setConnection('connected');
        setError('');
      } catch (failure) {
        if (stopped || controller.signal.aborted || currentRevision !== revision.current) return;
        setConnection('disconnected');
        setError(failure instanceof Error ? failure.message : 'Could not connect.');
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    const clock = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const offline = () => { setConnection('disconnected'); setError('Offline. Reconnecting…'); };
    window.addEventListener('offline', offline);
    return () => {
      stopped = true;
      controller?.abort();
      updateController.current?.abort();
      clearTimeout(timer);
      clearInterval(clock);
      window.removeEventListener('offline', offline);
    };
  }, [storeSlug]);

  async function update(id: string, status: RequestUpdateStatus) {
    if (updateController.current || connection !== 'connected') return;
    const controller = new AbortController();
    updateController.current = controller;
    revision.current += 1;
    setPending(id);
    setRowError(null);
    try {
      const result = productRequestSchema.parse(await requestJson('/api/requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeSlug, id, status }), signal: controller.signal }));
      if (!controller.signal.aborted) setRequests(current => current.map(request => request.id === id ? result : request));
    } catch (failure) {
      if (!controller.signal.aborted) setRowError({ id, message: failure instanceof Error ? failure.message : 'Could not update request. Try again.' });
    } finally {
      revision.current += 1;
      updateController.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  }
  return { requests: activeRequests(requests, now), connection, error, pending, rowError, now, update };
}
