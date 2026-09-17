import { Button } from '@base-ui/react/button';
import { Package } from 'lucide-react';
import { useEffect } from 'react';
import { money } from '../browse';
import { useRequests } from '../hooks/useRequests';
import './requests.css';

export function RequestsPage({ slug }: { slug: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `PayMore | ${slug} requests`;
    return () => { document.title = previous; };
  }, [slug]);
  const { requests, connection, error, pending, rowError, now, update } = useRequests(slug);
  return <main className="requests-page">
    <header className="requests-header">
      <div><img className="wordmark" src="/paymore-logo.png" alt="PayMore" width="156" height="50" /><h1>Item requests</h1><p>{slug}</p></div>
      <a className="button secondary" href={`/${slug}`}>View products</a>
    </header>
    <p>Requests clear automatically after 1 hour. Requests do not reserve items.</p>
    {connection === 'disconnected' && <p className="notice" role="alert">{error} Updates are paused until reconnected.</p>}
    {connection === 'loading' ? <p role="status">Loading requests…</p> : requests.length === 0 ? <section className="empty-state"><Package size={32}/><h2>{connection === 'connected' ? 'No pending requests' : 'Requests unavailable'}</h2></section> : <div className="request-list">
      {requests.map(request => <article className="request-card" key={request.id}>
        {request.imageUrl ? <img className="request-photo" src={request.imageUrl} alt={request.title} /> : <div className="request-photo request-no-photo"><Package size={32}/></div>}
        <div className="request-copy">
          <div className="request-meta"><strong>{request.status === 'found' ? 'Found' : 'Waiting'}</strong><span>{Math.max(0, Math.floor((now - request.createdAt) / 60000))} min ago · expires in {Math.max(1, Math.ceil((request.expiresAt - now) / 60000))} min</span></div>
          <h2>{request.title}</h2>
          {request.variantTitle && request.variantTitle !== 'Default Title' && <p>{request.variantTitle}</p>}
          <div className="request-sku"><span>SKU</span><strong>{request.sku || 'Not provided'}</strong><span>{money(request.priceCents)}</span></div>
          <div className="request-actions">
            <Button className="button secondary" disabled={connection !== 'connected' || pending !== null || request.status === 'found'} onClick={() => void update(request.id, 'found')}>Found</Button>
            <Button className="button primary" disabled={connection !== 'connected' || pending !== null} onClick={() => void update(request.id, 'shown')}>Shown</Button>
            <Button className="button primary" disabled={connection !== 'connected' || pending !== null} onClick={() => void update(request.id, 'given')}>Given to customer</Button>
            <Button className="button secondary" disabled={connection !== 'connected' || pending !== null} onClick={() => void update(request.id, 'cleared')}>Clear</Button>
          </div>
          {pending === request.id && <p role="status">Saving…</p>}
          {rowError?.id === request.id && <p className="request-error" role="alert">{rowError.message}</p>}
        </div>
      </article>)}
    </div>}
  </main>;
}
