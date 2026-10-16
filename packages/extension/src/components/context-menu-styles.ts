import { openModeStyles } from "./open-mode-switch";

export const styles = () => `
      .volt-hugeicon{font-family:VoltHugeicons!important;font-weight:normal;font-style:normal;line-height:1}
      :host{all:initial}
      .volt-cm-root{position:fixed;inset:0;z-index:2147483647}
      .overlay{position:fixed;inset:0;background:transparent}
      .menu{position:absolute;width:min(304px,calc(100vw - 16px));max-height:calc(100vh - 16px);background:#fff;color:#0f172a;border:1px solid rgba(148,163,184,.32);border-radius:14px;box-shadow:0 20px 50px rgba(15,23,42,.18),0 3px 10px rgba(15,23,42,.08);overflow-x:hidden;overflow-y:auto;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      .hdr{height:38px;padding:0 8px 0 14px;font:700 13px/1 ui-sans-serif,system-ui,-apple-system;color:#334155;background:#fff;display:flex;justify-content:space-between;align-items:center}
      .dismiss-btn{background:none;border:none;border-radius:7px;padding:6px 7px;color:#94a3b8;cursor:pointer;font:600 11px/1 ui-sans-serif,system-ui,-apple-system;transition:background .12s,color .12s}
      .dismiss-btn:hover{background:#f1f5f9;color:#475569}
      .dismiss-btn:focus-visible,.icon-btn:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      .quick-actions{display:flex;gap:4px;padding:0 8px 8px;border-bottom:1px solid #eef2f7;background:#fff}
      .icon-btn-wrapper{position:relative;display:flex;flex:1;min-width:0}
      .icon-btn{display:flex;align-items:center;justify-content:center;width:100%;height:34px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:#f8fafc;color:#334155;transition:background .12s,border-color .12s,color .12s,transform .12s}
      .icon-btn:hover:not(:disabled){background:#eef2f6;border-color:#e2e8f0;color:#0f172a}
      .icon-btn:active:not(:disabled){background:#e2e8f0;transform:scale(.97)}
      .icon-btn:disabled{opacity:0.35;cursor:not-allowed}
      .tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10}
      .tooltip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#111827}
      .icon-btn-wrapper:hover .tooltip{opacity:1}
      .icon-btn:disabled + .tooltip{display:none}
      .selection-context{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid #eef2f7;background:#fff;font-size:12px;line-height:1.3}
      .selection-context-label{flex:none;color:#94a3b8;font-weight:600}
      .selection-context-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-weight:600}
      .group{padding:4px 6px 6px}
      .section-label{padding:8px 10px 6px;color:#94a3b8;font:700 10px/1 ui-sans-serif,system-ui,-apple-system;text-transform:uppercase;letter-spacing:.08em}
      .open-mode-row{display:flex;align-items:center;gap:8px;padding:0 4px 6px 10px}
      .open-mode-caption{flex:none;color:#64748b;font:600 12px/1 ui-sans-serif,system-ui,-apple-system}
      .open-mode-row .open-mode{flex:1}
      .open-mode-row .open-mode-option{flex:1;justify-content:center;height:26px;font-size:12px}
${openModeStyles}
      .item{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 10px;border-radius:8px;cursor:pointer;outline:none;font-size:14px;font-weight:450;transition:background .12s,color .12s;position:relative}
      .item:hover:not(.disabled){background:#f1f5f9}
      .item[data-active="true"]:not(.disabled),.item:focus:not(.disabled){background:#e8eef5}
      .item.disabled{opacity:0.4;cursor:not-allowed}
      .item-tooltip{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);background:#111827;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10;max-width:200px}
      .item:hover .item-tooltip{opacity:1;transition-delay:0.5s}
      .item.disabled .item-tooltip{display:none}
      .icon{width:18px;height:18px;color:#6b7280;display:flex;align-items:center;justify-content:center}
      .label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13.5px;line-height:1.4}
      .shortcut{display:flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border:1px solid #e2e8f0;border-bottom-width:2px;border-radius:5px;background:#f8fafc;color:#64748b;font:600 10px/1 ui-sans-serif,system-ui,-apple-system}
      .sep{height:1px;background:#eef2f7;margin:6px 4px}
      .empty-hint{padding:10px 14px;border-bottom:1px solid #eef2f7;background:#fff;font-size:12px;color:#94a3b8;text-align:left}
    `;

export const selectionStyles = () => `
      .volt-hugeicon{font-family:VoltHugeicons!important;font-weight:normal;font-style:normal;line-height:1}
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
      .selection-action span{min-width:0;overflow:hidden;text-overflow:ellipsis}
      .selection-footer{grid-column:1/-1;display:flex;align-items:center;gap:6px;margin-top:2px;padding-top:3px;border-top:1px solid #eef2f7}
${openModeStyles}
      .selection-copy{box-sizing:border-box;display:flex;flex:1;align-items:center;justify-content:center;gap:7px;height:30px;border:0;border-radius:0 0 0 9px;background:transparent;color:#64748b;cursor:pointer;font:600 12px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;transition:background 100ms ease,color 100ms ease}
      .selection-copy:hover{background:#f1f5f9;color:#0f172a}
      .selection-copy:active{background:#e2e8f0}
      .selection-copy:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      @keyframes volt-selection-enter{from{opacity:0;transform:translateY(3px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
      @media (max-width:420px){.selection-search-action span:not(.volt-hugeicon){display:none}.selection-action{padding:0 8px}}
      @media (prefers-reduced-motion:reduce){.selection-pill{animation:none}.selection-action,.selection-copy{transition:none}}
    `;
