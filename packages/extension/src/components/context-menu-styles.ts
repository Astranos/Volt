export const styles = () => `
      :host{all:initial}
      .volt-cm-root{position:fixed;inset:0;z-index:2147483647}
      .overlay{position:fixed;inset:0;background:transparent}
      .menu{position:absolute;width:min(312px,calc(100vw - 16px));max-height:calc(100vh - 16px);background:rgba(255,255,255,.99);color:#0f172a;border:1px solid rgba(148,163,184,.3);border-radius:16px;box-shadow:0 24px 60px rgba(15,23,42,.2),0 4px 14px rgba(15,23,42,.1);overflow-x:hidden;overflow-y:auto;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      .hdr{height:44px;padding:0 14px;border-bottom:1px solid #eef2f7;font:700 14px/1 ui-sans-serif,system-ui,-apple-system;color:#475569;background:#fff;display:flex;justify-content:space-between;align-items:center}
      .dismiss-btn{background:none;border:none;border-radius:7px;padding:6px 7px;color:#94a3b8;cursor:pointer;font:600 11px/1 ui-sans-serif,system-ui,-apple-system;transition:background .12s,color .12s}
      .dismiss-btn:hover{background:#f1f5f9;color:#475569}
      .dismiss-btn:focus-visible,.icon-btn:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      .quick-actions{display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid #eef2f7;background:#f8fafc}
      .icon-btn-wrapper{position:relative;display:flex;flex:1;min-width:0}
      .icon-btn{display:flex;align-items:center;justify-content:center;width:100%;height:40px;border-radius:10px;cursor:pointer;border:1px solid #e9eef5;background:#fff;color:#334155;box-shadow:0 1px 2px rgba(15,23,42,.04);transition:background .12s,border-color .12s,color .12s,transform .12s}
      .icon-btn:hover:not(:disabled){background:#f1f5f9;border-color:#dbe3ed;color:#0f172a}
      .icon-btn:active:not(:disabled){background:#e2e8f0;transform:scale(.97)}
      .icon-btn:disabled{opacity:0.4;cursor:not-allowed}
      .tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10}
      .tooltip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#111827}
      .icon-btn-wrapper:hover .tooltip{opacity:1}
      .icon-btn:disabled + .tooltip{display:none}
      .selection-context{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #eef2f7;background:#fff;font-size:12px;line-height:1.3}
      .selection-context-label{flex:none;color:#94a3b8;font-weight:600}
      .selection-context-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-weight:600}
      .group{padding:7px}
      .section-label{padding:7px 10px 5px;color:#94a3b8;font:700 10px/1 ui-sans-serif,system-ui,-apple-system;text-transform:uppercase;letter-spacing:.08em}
      .item{display:flex;align-items:center;gap:10px;min-height:40px;padding:0 10px;border-radius:9px;cursor:pointer;outline:none;font-size:14px;font-weight:450;transition:background .12s,color .12s;position:relative}
      .item:hover:not(.disabled){background:#f1f5f9}
      .item[data-active="true"]:not(.disabled),.item:focus:not(.disabled){background:#e8eef5}
      .item .new-tab-btn{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:#9ca3af;cursor:pointer;transition:all 0.15s;opacity:0;margin-left:4px}
      .item:hover .new-tab-btn{opacity:1}
      .item .new-tab-btn:hover{background:#d1d5db;color:#111827}
      .item .new-tab-btn:focus-visible{opacity:1;outline:2px solid #22c55e;outline-offset:1px}
      .item.disabled{opacity:0.4;cursor:not-allowed}
      .item-tooltip{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);background:#111827;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10;max-width:200px}
      .item:hover .item-tooltip{opacity:1;transition-delay:0.5s}
      .item.disabled .item-tooltip{display:none}
      .icon{width:18px;height:18px;color:#6b7280;display:flex;align-items:center;justify-content:center}
      .label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;line-height:1.5}
      .shortcut{color:#6b7280;font:600 11px/1 ui-sans-serif, system-ui, -apple-system}
      .sep{height:1px;background:#eef2f7;margin:6px 4px}
      .empty-hint{padding:10px 14px;border-bottom:1px solid #eef2f7;background:#fff;font-size:12px;color:#94a3b8;text-align:left}
    `;

export const selectionStyles = () => `
      :host{all:initial}
      .selection-pill{box-sizing:border-box;position:fixed;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:4px;background:rgba(255,255,255,.98);color:#1f2937;border:1px solid rgba(148,163,184,.32);border-radius:13px;box-shadow:0 12px 30px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.1);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:auto;isolation:isolate;animation:volt-selection-enter 90ms ease-out}
      .selection-pill::after{content:'';position:absolute;left:50%;width:10px;height:10px;background:#fff;border-right:1px solid rgba(148,163,184,.32);border-bottom:1px solid rgba(148,163,184,.32);transform:translateX(-50%) rotate(45deg);z-index:-1}
      .selection-pill[data-placement='above']::after{bottom:-6px}
      .selection-pill[data-placement='below']::after{top:-6px;transform:translateX(-50%) rotate(225deg)}
      .selection-action{box-sizing:border-box;display:flex;min-width:0;height:36px;align-items:center;justify-content:center;gap:7px;flex:1;border:0;border-radius:9px;background:transparent;color:#334155;padding:0 9px;cursor:pointer;font:600 12px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;transition:background 100ms ease,color 100ms ease,transform 100ms ease}
      .selection-action:hover{background:#f1f5f9;color:#0f172a}
      .selection-action:active{background:#e2e8f0;transform:scale(.98)}
      .selection-action:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      .selection-action svg{flex:none}
      .selection-copy{box-sizing:border-box;display:flex;grid-column:1/-1;align-items:center;justify-content:center;gap:7px;height:32px;margin-top:2px;border:0;border-top:1px solid #eef2f7;border-radius:0 0 9px 9px;background:transparent;color:#64748b;cursor:pointer;font:600 12px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;transition:background 100ms ease,color 100ms ease}
      .selection-copy:hover{background:#f1f5f9;color:#0f172a}
      .selection-copy:active{background:#e2e8f0}
      .selection-copy:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      @keyframes volt-selection-enter{from{opacity:0;transform:translateY(3px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
      @media (max-width:420px){.selection-search-action span{display:none}.selection-action{padding:0 8px}}
      @media (prefers-reduced-motion:reduce){.selection-pill{animation:none}.selection-action,.selection-copy{transition:none}}
    `;
