import { Button } from "@base-ui/react/button";
import { MapPin, RotateCcw } from "lucide-react";
import type { Store } from "../catalog";
import "./store-header.css";

type StoreHeaderProps = { slug: string; store: Store | null } & (
  | { page: "catalog"; onReset: () => void }
  | { page: "requests" }
);

export function PayMoreLogo() {
  return <img className="wordmark" src="/paymore-logo.png" alt="PayMore" width="156" height="50" />;
}

export function StoreHeader(props: StoreHeaderProps) {
  const { slug, store, page } = props;
  const storeLabel = store ? [store.name, store.region].filter(Boolean).join(", ") : slug;
  const storePath = `/${encodeURIComponent(slug)}`;

  return (
    <header className="site-header store-header">
      <div className="header-inner">
        <PayMoreLogo />
        <div className="store-location">
          <MapPin size={17} aria-hidden="true" />
          <span>{storeLabel}</span>
        </div>
        <nav className="store-navigation" aria-label="Store navigation">
          <a href={storePath} aria-current={page === "catalog" ? "page" : undefined}>Products</a>
        </nav>
        {props.page === "catalog" ? (
          <Button className="button reset-button" aria-label="Start over" onClick={props.onReset}>
            <RotateCcw size={18} aria-hidden="true" />
            <span>Start over</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
