import 'dotenv/config';
import express from 'express';
import { createRequestHandler } from '@react-router/express';
import { createCronRoutes } from './cron.js';
import { createWebhookRoutes } from './webhooks.js';
// In production the build exists; in dev React Router handles this via HMR
const getBuild = async () => {
    if (process.env['NODE_ENV'] === 'production') {
        return import('../build/server/index.js');
    }
    // Dev: React Router dev server handles compilation
    return import('../build/server/index.js').catch(() => ({
        default: undefined,
    }));
};
const app = express();
// ─── Static assets ────────────────────────────────────────────────────────
app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }));
app.use(express.static('build/client', { maxAge: '1h' }));
// ─── Cron routes — protected by x-cron-secret header ─────────────────────
app.use('/cron', express.json(), createCronRoutes());
// ─── Shopify webhooks — raw body for HMAC verification ────────────────────
app.use('/webhooks', express.raw({ type: 'application/json' }), createWebhookRoutes());
// ─── React Router handles everything else ────────────────────────────────
app.all('*', createRequestHandler({
    // @ts-expect-error — build types resolved at runtime
    build: await getBuild(),
    getLoadContext() {
        return {};
    },
}));
const port = process.env['PORT'] ?? 3000;
app.listen(port, () => {
    console.log(`\n🌊 xdipx running on http://localhost:${port}\n`);
});
export default app;
