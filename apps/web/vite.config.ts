import { defineConfig, type Plugin } from 'vite';

/**
 * The UI is the Claude Design bundle served VERBATIM — index.html and support.js are
 * byte-for-byte copies from design/ (checked by scripts/check-design-verbatim.sh).
 * Nothing here alters the design. This plugin only injects the runtime's official
 * `window.__resources` override at SERVE TIME so React/Babel load from local copies
 * in offline environments (the files on disk stay untouched; with normal internet the
 * design also works without this, straight from its CDN URLs).
 */
function localCdnResources(): Plugin {
  const map = {
    'https://unpkg.com/react@18.3.1/umd/react.production.min.js': '/vendor/react.production.min.js',
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': '/vendor/react-dom.production.min.js',
    'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js': '/vendor/babel.min.js',
  };
  // Data-adapter fallback wrapping: fixture consts become `window.__weweData.X || <fixture>`.
  // Serve-time only — the design file on disk stays byte-identical (cmp-guarded).
  const WIRED = ['TXNS', 'BUDGET_ROWS', 'QB_EXCEPTIONS', 'AUDIT_LOG', 'GRANTS', 'STAFF', 'VENDORS', 'ASSETS', 'INV_ITEMS', 'FINDINGS', 'LEAVE', 'USERS', 'NOTIFICATIONS', 'SESSIONS_MINE', 'DELEGATIONS_MINE', 'BULK_QUEUE',
    // Phase G — extended live reads (payroll, timesheets, procurement, documents/e-sign, admin permissions, retirements)
    'PAYROLL', 'TIMESHEET', 'RFQ_VENDORS', 'QUOTES', 'DOCS', 'SIGNERS', 'CERT_SIGNERS', 'RESOLVED', 'PERM_CHANGES', 'RET_LINES'];
  const DATA_WRAPS: [string, string][] = WIRED.map((k) => [
    `const ${k} = [`,
    `const ${k} = (window.__weweData && window.__weweData.${k}) || [`,
  ]);
  // PAGE_SPECS: per-route live override (Object.assign so unwired routes keep fixtures)
  DATA_WRAPS.push(['const PAGE_SPECS = {', 'const PAGE_SPECS = Object.assign({']);
  // DASH: per-persona live dashboard override (active ?as persona only)
  DATA_WRAPS.push(['const DASH = {', 'const DASH = Object.assign({']);
  DATA_WRAPS.push(["]\n  }\n};\n\nconst PAGE_SPECS", "]\n  }\n}, window.__weweDash || {});\n\nconst PAGE_SPECS"]);
  DATA_WRAPS.push([",'g:LIVE']] } }\n};", ",'g:LIVE']] } }\n}, window.__wewePageSpecs || {});"]);
  // Phase 2 object consts: per-key live override, fixture keys survive (manifest: partial coverage is safe)
  DATA_WRAPS.push(['const TXN_DETAIL = {', 'const TXN_DETAIL = Object.assign({']);
  DATA_WRAPS.push(["','amber']] }\n};", "','amber']] }\n}, (window.__weweData && window.__weweData.TXN_DETAIL) || {});"]);
  DATA_WRAPS.push(['const CHAIN_TYPES = {', 'const CHAIN_TYPES = Object.assign({']);
  DATA_WRAPS.push(["'Second signature, always required' }\n  ]\n};", "'Second signature, always required' }\n  ]\n}, (window.__weweData && window.__weweData.CHAIN_TYPES) || {});"]);
  // Phase 1.11 procurement: RFQ rounds (keyed by RFQ ref, carrying the quotes the award
  // screen picks from) and PO records (keyed by PO ref, carrying the lines a goods receipt
  // counts against). Both are objects, so they merge per-key like TXN_DETAIL — a live round
  // overrides its fixture, and rounds we have no data for keep theirs.
  DATA_WRAPS.push(['const RFQ_ROUNDS = {', 'const RFQ_ROUNDS = Object.assign({']);
  DATA_WRAPS.push(["000, days:5, valid:14, blacklisted:false, note:'' }\n    ] }\n};", "000, days:5, valid:14, blacklisted:false, note:'' }\n    ] }\n}, (window.__weweData && window.__weweData.RFQ_ROUNDS) || {});"]);
  DATA_WRAPS.push(['const PO_RECORDS = {', 'const PO_RECORDS = Object.assign({']);
  DATA_WRAPS.push(["partial delivery accepted','04/08/2026 · 16:22','amber']] }\n};", "partial delivery accepted','04/08/2026 · 16:22','amber']] }\n}, (window.__weweData && window.__weweData.PO_RECORDS) || {});"]);
  // FIX (serve-time, design file stays byte-identical): the register rows hardcode the demo
  // detail ref REQ-2026-0187, which doesn't exist under live data → clicking a requisition
  // opened a blank detail. Open the row's OWN ref instead (the adapter wires real detail for
  // every live requisition), and make detailFor tolerant so any stray 0187 link never blanks.
  DATA_WRAPS.push([
    "onClick: () => this.go('/requisitions/REQ-2026-0187')",
    "onClick: () => this.go('/requisitions/' + t.ref)",
  ]);
  DATA_WRAPS.push([
    "    const t = TXNS.find(x => x.ref === ref);\n    if (!t) return null;",
    "    let t = TXNS.find(x => x.ref === ref) || TXNS[0];\n    if (!t) return null;",
  ]);
  return {
    name: 'wewe-local-cdn-resources',
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => {
        let out = html;
        for (const [from, to] of DATA_WRAPS) out = out.replace(from, to);
        return {
          html: out,
          tags: [
            // The design's font stack is "Google Sans", "Google Sans Text", Figtree, system-ui.
            // Loading Google Sans from Google Fonts activates the first-choice family everywhere;
            // if unavailable, the browser ignores this and the design's own Figtree link applies.
            { tag: 'link', injectTo: 'head-prepend' as const, attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Google+Sans+Text:wght@400;500;600;700&display=swap' } },
            { tag: 'script', injectTo: 'head-prepend' as const, children: `window.__resources=${JSON.stringify(map)};` },
            // adapter runs synchronously BEFORE support.js so live data exists at design boot
            { tag: 'script', injectTo: 'head-prepend' as const, attrs: { src: '/adapter.js' } },
          ],
        };
      },
    },
  };
}

export default defineConfig({
  plugins: [localCdnResources()],
  server: {
    port: 5173,
    proxy: { '/v1': 'http://localhost:3001' },
  },
});
