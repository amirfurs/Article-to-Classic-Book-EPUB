/**
 * Vercel Serverless Function Entry Point
 * Explicit 2-argument handler wrapping Express to ensure @vercel/node treats it
 * as a standard (req, res) serverless function instead of a callback-style function.
 */
import app from '../server/app.js';

export default function handler(req, res) {
  try {
    return app(req, res);
  } catch (err) {
    console.error('Fatal Serverless Handler Error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
    }
  }
}
