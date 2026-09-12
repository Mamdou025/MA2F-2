import react from '@vitejs/plugin-react';
import { localAuthPlugin } from './server/localAuthPlugin';
import { odooHealthPlugin } from './server/odooHealthPlugin';
import { odooIntegrationPlugin } from './server/odooIntegrationPlugin';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import {
  clerkVerificationAuth,
  clerkVerificationErrorHandler,
  clerkVerificationHandler,
} from './server/clerkVerification';

function clerkVerificationDevApi(): Plugin {
  return {
    name: 'ma2f-clerk-verification-api',
    configureServer(server) {
      server.middlewares.use('/api/clerk-verification', (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }
        clerkVerificationAuth(req as any, res as any, (error?: unknown) => {
          if (error) {
            clerkVerificationErrorHandler(error, req as any, res as any, next);
            return;
          }
          clerkVerificationHandler(req as any, res as any, next);
        });
      });
    },
  };
}

// Replit has its own preview. No Manus runtime, telemetry collector or storage proxy.
export default defineConfig({
  plugins: [localAuthPlugin(), odooHealthPlugin(), odooIntegrationPlugin(), clerkVerificationDevApi(), react(), tailwindcss({ optimize: false })],
  root: path.resolve(import.meta.dirname, 'client'),
  envDir: path.resolve(import.meta.dirname),
  resolve: { alias: {
    '@': path.resolve(import.meta.dirname, 'client/src'),
    '@shared': path.resolve(import.meta.dirname, 'shared'),
    '@assets': path.resolve(import.meta.dirname, 'attached_assets'),
  } },
  build: { outDir: path.resolve(import.meta.dirname, 'dist/public'), emptyOutDir: true },
  server: {
    host: '0.0.0.0', port: 3000, strictPort: true,
    allowedHosts: ['.replit.dev', '.replit.app', 'localhost', '127.0.0.1'],
    fs: { strict: true, deny: ['**/.*', '**/.!(pnpm)/**', '**/!(node_modules)/.pnpm/**', '**/pilot/.local/**', '**/migration-private/**'] },
  },
});
