import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Vercel Serverless Path Normalizer: If Vercel rewrote the URL to the function entry, restore original path
app.use((req, res, next) => {
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-real-path'];
  if (matchedPath && (req.url === '/api/index.js' || req.url === '/api/index' || req.url === '/api' || req.url === '/index.js' || req.url === '/')) {
    req.url = matchedPath;
  }
  next();
});

// Mount API routes at both /api and / to support all serverless rewrite scenarios
app.use('/api', apiRouter);
app.use((req, res, next) => {
  // If request doesn't have /api prefix but is handled by apiRouter
  if (req.path.startsWith('/api')) return next();
  // Check if it's an API route without /api prefix
  const apiPaths = ['/extract', '/convert', '/bundle', '/download', '/qr', '/library', '/kindle', '/settings', '/read', '/health', '/stats'];
  const matchesApi = apiPaths.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (matchesApi) {
    return apiRouter(req, res, next);
  }
  next();
});

// Static frontend assets (served natively on local node, or via Vercel edge on deployment)
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// Fallback route for SPA or API 404 (safe on serverless when public/ is on edge CDN)
app.use((req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (!req.path.startsWith('/api') && fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).json({ error: `Endpoint ${req.path} not found` });
});

// Global error handler - guaranteed JSON response
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

export default app;

