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
  return {
    name: 'wewe-local-cdn-resources',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{
        tag: 'script',
        injectTo: 'head-prepend',
        children: `window.__resources=${JSON.stringify(map)};`,
      }],
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
