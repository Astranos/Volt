import { useEffect, useState } from "react";
import { ArrowUpRight, Boxes } from "lucide-react";
import { KIOSK_API_BASE, kioskProductAdminUrl, waitedFor, type KioskRequest } from "../../kiosk/kiosk-requests";
import "./kiosk-requests.css";

// Buttons live inside cmdk's list; keep Enter from selecting a search result instead.
const keepEnter = (event: React.KeyboardEvent) => { if (event.key === "Enter") event.stopPropagation(); };

/** Customers' "Ask to see item" requests from the store kiosk, with the staff page's main actions. */
export function KioskRequestList({
  store,
  shop,
  requests,
  clockOffset,
  error,
  onUpdate,
  onOpen,
}: {
  store: string;
  shop: string | null;
  requests: KioskRequest[];
  clockOffset: number;
  error: string | null;
  onUpdate: (request: KioskRequest, status: "found" | "shown") => void;
  onOpen: (url: string) => void;
}) {
  // Waiting times read "4 min"; refresh them without waiting for the next change.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const waiting = requests.filter((request) => request.status === "waiting").length;
  const found = requests.length - waiting;

  return <section aria-label="Kiosk requests" className="kiosk-requests">
    <div className="kiosk-requests-heading">
      <span aria-hidden="true" className={waiting > 0 ? "kiosk-requests-dot is-waiting" : "kiosk-requests-dot"} />
      <span>Kiosk requests</span>
      <span className="kiosk-requests-summary">
        · {store} · {waiting} waiting{found > 0 ? `, ${found} found` : ""}
      </span>
      <a className="kiosk-requests-queue" href={`${KIOSK_API_BASE}/${store}/requests`} onKeyDown={keepEnter} rel="noopener noreferrer" target="_blank">
        Staff queue <ArrowUpRight aria-hidden="true" size={12} />
      </a>
    </div>
    {error && <p className="kiosk-requests-error" role="alert">{error}</p>}
    <ul className="kiosk-requests-list">
      {requests.map((request) => {
        const adminUrl = kioskProductAdminUrl(shop, request.productId);
        const variant = request.variantTitle && request.variantTitle !== "Default Title" ? request.variantTitle : null;
        return <li className="kiosk-request" key={request.id}>
          <span className="kiosk-request-thumb">
            <Boxes aria-hidden="true" size={16} />
            {request.imageUrl && <img alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} src={request.imageUrl} />}
          </span>
          <span className="kiosk-request-body">
            <span className="kiosk-request-title" title={request.title}>{request.title}{variant ? ` — ${variant}` : ""}</span>
            <span className="kiosk-request-meta">
              <span className={request.status === "found" ? "kiosk-request-status is-found" : "kiosk-request-status"}>
                {request.status === "found" ? "Found" : "Waiting"}
              </span>
              {request.sku && <span>SKU {request.sku}</span>}
              <span>{waitedFor(now + clockOffset - request.createdAt)}</span>
            </span>
          </span>
          <span className="kiosk-request-actions">
            {request.status === "waiting" && <button className="kiosk-request-button is-primary" data-tooltip="Staff found the item" onClick={() => onUpdate(request, "found")} onKeyDown={keepEnter} type="button">Found</button>}
            <button className="kiosk-request-button" data-tooltip="Customer was shown the item" onClick={() => onUpdate(request, "shown")} onKeyDown={keepEnter} type="button">Shown</button>
            {adminUrl && <button aria-label={`Open ${request.title} in Shopify`} className="kiosk-request-button is-icon" data-tooltip="Open in Shopify" onClick={() => onOpen(adminUrl)} onKeyDown={keepEnter} type="button">
              <ArrowUpRight aria-hidden="true" size={14} />
            </button>}
          </span>
        </li>;
      })}
    </ul>
  </section>;
}
