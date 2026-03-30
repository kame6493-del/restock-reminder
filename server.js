import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { shopifyApp } from './lib/shopify.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import webhookRoutes from './routes/webhooks.js';
import billingRoutes from './routes/billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// Webhooks need raw body - must be before json parser
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

// Standard middleware
app.use(compression());
app.use(express.json());
app.use(cookieParser());

// Debug endpoint (remove in production)
app.get('/debug/env', (req, res) => {
  const dbUrl = process.env.DATABASE_URL || 'NOT SET';
  res.json({
    DATABASE_URL_length: dbUrl.length,
    DATABASE_URL_chars: Array.from(dbUrl).map((c, i) => `${i}:${c.charCodeAt(0)}:${c}`).join(' '),
    HOST: process.env.HOST,
  });
});

// Auth routes (OAuth flow)
app.use('/auth', authRoutes);

// Billing routes
app.use('/billing', billingRoutes);

// API routes (protected - require valid session)
app.use('/api', apiRoutes);

// Serve frontend
app.use(express.static(join(__dirname, 'frontend', 'dist')));

// SPA fallback - serve index.html for all unmatched routes
app.get('*', (req, res) => {
  // If it's an API request that wasn't matched, return 404
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, 'frontend', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ReStock Reminder running on port ${PORT}`);
  console.log(`Open: ${process.env.HOST || `http://localhost:${PORT}`}`);
});
