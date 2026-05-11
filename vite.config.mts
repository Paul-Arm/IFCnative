import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const fromRoot = (...parts: string[]) => path.resolve(projectRoot, ...parts);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: fromRoot('src') },
      { find: /^react$/, replacement: fromRoot('node_modules/react') },
      { find: /^react\/jsx-runtime$/, replacement: fromRoot('node_modules/react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: fromRoot('node_modules/react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: fromRoot('node_modules/react-dom') },
      { find: /^react-dom\/client$/, replacement: fromRoot('node_modules/react-dom/client.js') },
      { find: /^react-dom\/server$/, replacement: fromRoot('node_modules/react-dom/server.browser.js') },
      { find: /^react-native$/, replacement: 'react-native-web' },
    ],
    dedupe: ['react', 'react-dom'],
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});