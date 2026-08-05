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
  const WIRED = ['TXNS', 'BUDGET_ROWS', 'QB_EXCEPTIONS', 'AUDIT_LOG', 'GRANTS', 'STAFF', 'VENDORS', 'ASSETS', 'INV_ITEMS', 'FINDINGS', 'LEAVE', 'USERS'];
  const DATA_WRAPS: [string, string][] = WIRED.map((k) => [
    `const ${k} = [`,
    `const ${k} = (window.__weweData && window.__weweData.${k}) || [`,
  ]);
  // PAGE_SPECS: per-route live override (Object.assign so unwired routes keep fixtures)
  DATA_WRAPS.push(['const PAGE_SPECS = {', 'const PAGE_SPECS = Object.assign({']);
  DATA_WRAPS.push([",'g:LIVE']] } }\n};", ",'g:LIVE']] } }\n}, window.__wewePageSpecs || {});"]);
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
