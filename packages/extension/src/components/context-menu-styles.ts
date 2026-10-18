import { openModeStyles } from "./open-mode-switch";

export const styles = () => `
      .volt-hugeicon{font-family:VoltHugeicons!important;font-weight:normal;font-style:normal;line-height:1}
      :host{all:initial}
      .volt-cm-root{position:fixed;inset:0;z-index:2147483647}
      .overlay{position:fixed;inset:0;background:transparent}
      .menu{position:absolute;box-sizing:border-box;width:min(296px,calc(100vw - 16px));max-height:calc(100vh - 16px);padding:6px;background:#fff;color:#0f172a;border:1px solid rgba(15,23,42,.08);border-radius:16px;box-shadow:0 24px 48px -12px rgba(15,23,42,.22),0 8px 16px -8px rgba(15,23,42,.12),0 0 0 1px rgba(15,23,42,.02);overflow-x:hidden;overflow-y:auto;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;transform-origin:top left;animation:volt-menu-enter 110ms cubic-bezier(.2,.9,.3,1)}
      .hdr{display:flex;justify-content:space-between;align-items:center;height:34px;padding:0 2px 0 8px}
      .brand{display:flex;align-items:center;gap:7px;color:#0f172a;font:700 13px/1 ui-sans-serif,system-ui,-apple-system;letter-spacing:-.01em}
      .brand-mark{width:16px;height:16px;fill:#34c759}
      .dismiss-btn{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;background:none;border:none;border-radius:8px;color:#94a3b8;cursor:pointer;transition:background .12s,color .12s}
      .dismiss-btn:hover{background:#f1f5f9;color:#334155}
      .dismiss-btn:focus-visible,.icon-btn:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      .quick-actions{display:flex;gap:2px;margin:2px 0 6px;padding:3px;border-radius:11px;background:#f6f7f9;border:1px solid #eef0f3}
      .icon-btn-wrapper{position:relative;display:flex;flex:1;min-width:0}
      .icon-btn{display:flex;align-items:center;justify-content:center;width:100%;height:30px;border-radius:8px;cursor:pointer;border:0;background:transparent;color:#475569;transition:background .12s,color .12s,box-shadow .12s,transform .12s}
      .icon-btn:hover:not(:disabled){background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,.08),0 0 0 1px rgba(15,23,42,.06)}
      .icon-btn:active:not(:disabled){transform:scale(.94)}
      .icon-btn:disabled{opacity:.3;cursor:not-allowed}
      .tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:5px 8px;border-radius:7px;font:500 11.5px/1.2 ui-sans-serif,system-ui,-apple-system;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s;z-index:10}
      .tooltip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#0f172a}
      .icon-btn-wrapper:hover .tooltip{opacity:1;transition-delay:.3s}
      .icon-btn:disabled + .tooltip{display:none}
      .selection-context{display:flex;align-items:center;gap:8px;margin:0 2px 2px;padding:7px 10px;border-radius:10px;background:#f0fdf4;border:1px solid #dcfce7;font-size:12px;line-height:1.3}
      .selection-context-label{flex:none;color:#16a34a;font:700 10px/1 ui-sans-serif,system-ui,-apple-system;text-transform:uppercase;letter-spacing:.06em}
      .selection-context-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#14532d;font:600 12.5px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
      .group{padding:0}
      .section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 2px 4px 0}
      .section-label{padding:8px 10px 6px;color:#94a3b8;font:700 10px/1 ui-sans-serif,system-ui,-apple-system;text-transform:uppercase;letter-spacing:.08em}
      .section-head .section-label{padding:0 10px}
${openModeStyles}
      .item{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 8px 0 6px;border-radius:9px;cursor:pointer;outline:none;font-size:14px;font-weight:450;transition:background .1s,color .1s;position:relative}
      .item:hover:not(.disabled){background:#f4f5f7}
      .item[data-active="true"]:not(.disabled),.item:focus:not(.disabled){background:#f1f3f6}
      .item.disabled{opacity:.42;cursor:not-allowed}
      .item-tooltip{position:absolute;left:calc(100% + 10px);top:50%;transform:translateY(-50%);background:#0f172a;color:#fff;padding:6px 10px;border-radius:7px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s;z-index:10;max-width:200px}
      .item-tooltip:empty{display:none}
      .item:hover .item-tooltip{opacity:1;transition-delay:.5s}
      .item.disabled .item-tooltip{display:none}
      .icon{flex:none;width:26px;height:26px;border-radius:7px;background:#f1f5f9;color:#475569;display:flex;align-items:center;justify-content:center;transition:background .1s,color .1s}
      .item[data-active="true"]:not(.disabled) .icon{background:#dcfce7;color:#15803d}
      .label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1e293b;font-size:13.5px;font-weight:500;line-height:1.4}
      .shortcut{display:flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border:1px solid #e2e8f0;border-bottom-width:2px;border-radius:6px;background:#fff;color:#64748b;font:600 10.5px/1 ui-sans-serif,system-ui,-apple-system}
      .sep{height:1px;background:#eef0f3;margin:6px 6px 2px}
      .empty-hint{margin:0 2px 2px;padding:8px 10px;border-radius:10px;background:#f8fafc;border:1px dashed #e2e8f0;font-size:12px;color:#94a3b8;text-align:left}
      .group .empty-hint{margin-top:4px}
      .footer{display:flex;gap:12px;margin:6px -6px -6px;padding:8px 12px;border-top:1px solid #eef0f3;background:#fafbfc;color:#94a3b8;font:500 11px/1 ui-sans-serif,system-ui,-apple-system}
      .footer span{display:flex;align-items:center;gap:3px}
      .footer kbd{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border:1px solid #e2e8f0;border-radius:4px;background:#fff;color:#64748b;font:600 10px/1 ui-sans-serif,system-ui,-apple-system}
      @keyframes volt-menu-enter{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
      @media (prefers-reduced-motion:reduce){.menu{animation:none}.item,.icon,.icon-btn,.dismiss-btn{transition:none}}
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
