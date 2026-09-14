import { app } from '../server.js';

export default function handler(req: any, res: any) {
  try {
    // Vercel Serverless URL Normalization:
    // When vercel.json rewrites `/api/(.*)` to `/api/index` or `/api`,
    // Vercel delivers the client's actual path in standard proxy headers.
    const rawForwarded = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.headers['x-original-url'];
    if (typeof rawForwarded === 'string' && rawForwarded.startsWith('/api')) {
      req.url = rawForwarded;
    }

    return app(req, res);
  } catch (err: any) {
    console.error('[Vercel Serverless Crash]:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error in Serverless Function',
        message: err?.message || String(err)
      });
    }
  }
}

