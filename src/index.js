'use strict';

const express = require('express');
const pkg = require('../package.json');

// All environment settings are read and frozen in one place. See src/config.js.
const { config, warnAboutMissingEnvVars } = require('./config');

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const app = express();

// Railway and most hosts sit behind a proxy. This makes req.ip report the
// real visitor address instead of the proxy's — we need that to be correct,
// because we record the customer's IP as legal proof of SMS consent.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check. Hosting platforms ping this to decide whether the app is
// alive; you can also just open it in a browser to confirm things work.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lyndry',
    version: pkg.version,
    env: config.env,
    model: config.anthropicModel,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// The real website arrives in phase 5. Until then, a plain placeholder.
app.get('/', (req, res) => {
  res.type('text/plain').send('LYNDRY — laundry pickup and delivery. Site coming soon.');
});

// Anything else is a 404.
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Last line of defence. If any route throws, we log the real error for
// ourselves and return something generic to the caller.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const server = app.listen(config.port, () => {
  console.log(`LYNDRY v${pkg.version} listening on port ${config.port}`);
  console.log(`  environment : ${config.env}`);
  console.log(`  base url    : ${config.baseUrl}`);
  console.log(`  ai model    : ${config.anthropicModel}`);
  warnAboutMissingEnvVars();
});

// When the host wants to stop or redeploy us it sends SIGTERM. Finish the
// requests already in flight, then exit, rather than dropping them.
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  // If something hangs, don't wait forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, config };
