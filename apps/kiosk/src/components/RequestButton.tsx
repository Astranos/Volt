import { Button } from '@base-ui/react/button';
import { useEffect, useRef, useState } from 'react';
import { requestReceiptSchema, type RequestReceipt } from '../requests';
import { requestJson } from '../hooks/useRequests';
import './requests.css';

type SendState = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; receipt: RequestReceipt } | { kind: 'error'; message: string };
export function RequestButton({ storeSlug, visitorId, productId, variantId, enabled }: { storeSlug: string; visitorId: string; productId: string; variantId: string; enabled: boolean }) {
  const [state, setState] = useState<SendState>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function send() {
    if (!enabled || controller.current || state.kind === 'sent') return;
    const current = new AbortController();
    controller.current = current;
    setState({ kind: 'sending' });
    try {
      const receipt = requestReceiptSchema.parse(await requestJson('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeSlug, productId, variantId, requestKey: `${visitorId}:${variantId}` }), signal: current.signal }));
      if (!current.signal.aborted) setState({ kind: 'sent', receipt });
    } catch (failure) {
      if (!current.signal.aborted) setState({ kind: 'error', message: failure instanceof Error ? failure.message : 'Could not send request. Try again.' });
    } finally { controller.current = null; }
  }
  const sent = state.kind === 'sent';
  const active = sent && (state.receipt.status === 'waiting' || state.receipt.status === 'found');
  return <div className="request-button-box">
    <Button className="button primary" disabled={!enabled || state.kind === 'sending' || sent} onClick={() => void send()}>
      {state.kind === 'sending' ? 'Sending…' : sent ? active ? 'Requested' : 'Request completed' : 'Ask to see item'}
    </Button>
    {sent && <p role="status">{active ? 'Sent to the counter. An associate will help when available.' : 'This request has been closed.'}</p>}
    {state.kind === 'error' && <p className="request-error" role="alert">{state.message}</p>}
  </div>;
}
