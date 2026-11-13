import { Button } from '@base-ui/react/button';
import { Input } from '@base-ui/react/input';
import { useState } from 'react';
import { storeSlugFromInput } from '../browse';

export function StoreChooser() {
  const [address, setAddress] = useState('');
  const [error, setError] = useState(false);
  return <form className="store-form" onSubmit={event => {
    event.preventDefault();
    const slug = storeSlugFromInput(address);
    if (!slug) { setError(true); return; }
    window.location.assign(`/${slug}`);
  }}>
    <label htmlFor="store-address">PayMore store address</label>
    <Input id="store-address" value={address} onChange={event => { setAddress(event.target.value); setError(false); }}
      placeholder="your-store.myshopify.com" autoCapitalize="none" autoComplete="off" autoCorrect="off"
      aria-invalid={error} aria-describedby={error ? 'store-address-error' : 'store-address-help'} />
    <p id="store-address-help">Enter the store's .myshopify.com address, shop handle, or kiosk link.</p>
    {error && <p id="store-address-error" role="alert">Enter a Shopify store address, such as your-store.myshopify.com.</p>}
    <Button className="button primary" type="submit">Open store</Button>
  </form>;
}
