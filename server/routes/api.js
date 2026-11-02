import express from 'express';
import QRCode from 'qrcode';
import fs from 'fs';
import { extractArticle } from '../services/extractor.js';
import { generateEpub } from '../services/epubGenerator.js';
import { db } from '../services/db.js';
import { kindleService } from '../services/kindleService.js';
import { parseEpubFile } from '../services/epubReader.js';
import { bufferCache } from '../services/bufferCache.js';

const router = express.Router();

/**
 * GET /api/health
 * Deployment health check endpoint (ideal for Vercel deployment verification)
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL ? 'vercel-serverless' : 'standalone-node'
  });
});

/**
 * POST /api/extract
 * Extracts article text, metadata, and reader content from a URL
 */
router.post('/extract', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Please enter a valid HTTP or HTTPS URL.' });
    }

    const article = await extractArticle(url);
    res.json({ success: true, article });
  } catch (err) {
    console.error('Extraction error:', err);
    res.status(500).json({ error: err.message || 'Failed to extract article content' });
  }
});

/**
 * POST /api/convert
 * Converts a single article into an EPUB
 */
router.post('/convert', async (req, res) => {
  try {
    const {
      url,
      title: customTitle,
      author: customAuthor,
      siteName: customSite,
      coverStyle = 'modern',
      includeImages = true,
      htmlContent: preExtractedHtml,
      leadImageUrl,
      wordCount: customWordCount,
      estimatedReadingTime: customReadingTime
    } = req.body;

    let articleData = null;

    if (preExtractedHtml && customTitle) {
      articleData = {
        title: customTitle,
        author: customAuthor || '',
        siteName: customSite || '',
        url: url || '',
        htmlContent: preExtractedHtml,
        leadImageUrl,
        wordCount: customWordCount || 0,
        readingTime: customReadingTime || 5
      };
    } else {
      if (!url) {
        return res.status(400).json({ error: 'Article URL or content is required.' });
      }
      const extracted = await extractArticle(url);
      articleData = {
        title: customTitle || extracted.title,
        author: customAuthor || extracted.author,
        siteName: customSite || extracted.siteName,
        url: extracted.url,
        htmlContent: extracted.htmlContent,
        leadImageUrl: leadImageUrl || extracted.leadImageUrl,
        wordCount: extracted.wordCount,
        readingTime: extracted.estimatedReadingTime
      };
    }

    const epubId = `epub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const epubResult = await generateEpub({
      id: epubId,
      title: articleData.title,
      author: articleData.author,
      siteName: articleData.siteName,
      coverStyle,
      includeImages,
      articles: [articleData]
    });

    const record = db.saveEpub({
      id: epubId,
      title: articleData.title,
      author: articleData.author,
      siteName: articleData.siteName,
      url: articleData.url,
      leadImageUrl: articleData.leadImageUrl,
      wordCount: articleData.wordCount,
      readingTime: articleData.readingTime,
      filename: epubResult.filename,
      filePath: epubResult.filePath,
      fileSize: epubResult.fileSize,
      coverStyle,
      isBundle: false,
      chaptersCount: 1
    });

    res.json({
      success: true,
      epub: record,
      epubBase64: epubResult.base64,
      downloadUrl: `/api/download/${epubId}`
    });
  } catch (err) {
    console.error('Convert error:', err);
    res.status(500).json({ error: err.message || 'Failed to convert article to EPUB' });
  }
});

/**
 * POST /api/bundle
 * Combines multiple article URLs or extracted articles into a single EPUB magazine/anthology
 */
router.post('/bundle', async (req, res) => {
  try {
    const {
      bundleTitle = 'Reading Digest',
      author = 'Various Authors',
      coverStyle = 'modern',
      includeImages = true,
      articles = []
    } = req.body;

    if (!articles || articles.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one article to bundle.' });
    }

    // Process articles - extract if only URL is given
    const processedArticles = [];
    for (let i = 0; i < articles.length; i++) {
      const item = articles[i];
      if (item.htmlContent && item.title) {
        processedArticles.push(item);
      } else if (item.url) {
        try {
          const extracted = await extractArticle(item.url);
          processedArticles.push({
            title: item.title || extracted.title,
            author: item.author || extracted.author,
            siteName: item.siteName || extracted.siteName,
            url: extracted.url,
            htmlContent: extracted.htmlContent,
            readingTime: extracted.estimatedReadingTime,
            wordCount: extracted.wordCount
          });
        } catch (itemErr) {
          console.warn(`Could not extract bundle article ${item.url}:`, itemErr.message);
        }
      }
    }

    if (processedArticles.length === 0) {
      return res.status(400).json({ error: 'Could not extract content from the provided article URLs.' });
    }

    const epubId = `bundle_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const totalWordCount = processedArticles.reduce((acc, a) => acc + (a.wordCount || 0), 0);
    const totalReadingTime = processedArticles.reduce((acc, a) => acc + (a.readingTime || 5), 0);

    const epubResult = await generateEpub({
      id: epubId,
      title: bundleTitle,
      author,
      siteName: 'Digest Anthology',
      coverStyle,
      includeImages,
      articles: processedArticles
    });

    const record = db.saveEpub({
      id: epubId,
      title: bundleTitle,
      author,
      siteName: `${processedArticles.length} Articles Digest`,
      url: processedArticles[0].url || '',
      leadImageUrl: null,
      wordCount: totalWordCount,
      readingTime: totalReadingTime,
      filename: epubResult.filename,
      filePath: epubResult.filePath,
      fileSize: epubResult.fileSize,
      coverStyle,
      isBundle: true,
      chaptersCount: processedArticles.length,
      articlesCount: processedArticles.length
    });

    res.json({
      success: true,
      epub: record,
      epubBase64: epubResult.base64,
      downloadUrl: `/api/download/${epubId}`
    });
  } catch (err) {
    console.error('Bundle error:', err);
    res.status(500).json({ error: err.message || 'Failed to create article bundle' });
  }
});

/**
 * GET /api/download/:id
 * Streams the EPUB file to the client for download
 */
router.get('/download/:id', (req, res) => {
  try {
    const { id } = req.params;
    const record = db.getEpubById(id);
    const cached = bufferCache.get(id);

    let buffer = null;
    let filename = record ? (record.filename || `${record.title || 'article'}.epub`) : 'article.epub';

    if (cached && cached.buffer) {
      buffer = cached.buffer;
      if (cached.filename) filename = cached.filename;
    } else if (record && record.filePath && fs.existsSync(record.filePath)) {
      buffer = fs.readFileSync(record.filePath);
    }

    if (!buffer) {
      return res.status(404).send('EPUB file not found or expired.');
    }

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    return res.end(buffer);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Error streaming EPUB file');
  }
});

/**
 * GET /api/qr/:id
 * Returns a QR Code Data URL for scanning on mobile phones or e-readers
 */
router.get('/qr/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const record = db.getEpubById(id);
    if (!record) {
      return res.status(404).json({ error: 'EPUB record not found' });
    }

    // Build absolute URL based on host header
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const downloadUrl = `${protocol}://${host}/api/download/${id}`;

    const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      qrDataUrl,
      downloadUrl
    });
  } catch (err) {
    console.error('QR error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

/**
 * GET /api/library
 * Returns the user's converted bookshelf
 */
router.get('/library', (req, res) => {
  try {
    const { search = '', tag = '', limit = 50, offset = 0 } = req.query;
    const result = db.getLibrary({
      search,
      tag,
      limit: Number(limit),
      offset: Number(offset)
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Library error:', err);
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

/**
 * DELETE /api/library/:id
 * Deletes an EPUB from the library and disk
 */
router.delete('/library/:id', (req, res) => {
  try {
    const { id } = req.params;
    const record = db.getEpubById(id);

    if (record && record.filePath && fs.existsSync(record.filePath)) {
      try {
        fs.unlinkSync(record.filePath);
      } catch (e) {
        console.warn('Could not delete file from disk:', e.message);
      }
    }

    db.deleteEpub(id);
    res.json({ success: true, message: 'EPUB deleted' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete EPUB' });
  }
});

/**
 * POST /api/kindle/send
 * Sends an EPUB to Kindle email
 */
router.post('/kindle/send', async (req, res) => {
  try {
    const { id, kindleEmail } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'EPUB ID is required' });
    }

    const record = db.getEpubById(id);
    if (!record) {
      return res.status(404).json({ error: 'EPUB not found' });
    }

    const email = kindleEmail || db.getSettings().kindleEmail;
    if (!email) {
      return res.status(400).json({ error: 'Kindle email address is required.' });
    }

    const result = await kindleService.sendToKindle({
      epubRecord: record,
      targetEmail: email
    });

    res.json(result);
  } catch (err) {
    console.error('Kindle send error:', err);
    res.status(500).json({ error: err.message || 'Failed to dispatch to Kindle' });
  }
});

/**
 * GET /api/settings and POST /api/settings
 */
router.get('/settings', (req, res) => {
  res.json({ success: true, settings: db.getSettings() });
});

router.post('/settings', (req, res) => {
  try {
    const updated = db.updateSettings(req.body);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /api/read/:id
 * Reads and unpacks EPUB for the web EPUB player
 */
router.get('/read/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const record = db.getEpubById(id);
    const cached = bufferCache.get(id);

    const source = (cached && cached.buffer) 
      || (record && record.filePath && fs.existsSync(record.filePath) ? record.filePath : null);

    if (!source) {
      return res.status(404).json({ error: 'EPUB file not found or expired' });
    }

    const parsed = await parseEpubFile(source);
    res.json({
      success: true,
      id: (record && record.id) || id,
      book: {
        id: (record && record.id) || id,
        ...parsed,
        title: (record && record.title) || parsed.title,
        author: (record && record.author) || parsed.author,
        readingTime: (record && record.readingTime) || 5
      }
    });
  } catch (err) {
    console.error('EPUB reader error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse EPUB file' });
  }
});

/**
 * POST /api/read/upload
 * Allows user to upload any external .epub file to play in the browser
 */
router.post('/read/upload', async (req, res) => {
  try {
    const { base64Data, filename } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'EPUB base64 data is required' });
    }

    const cleanBase64 = base64Data.replace(/^data:.*?;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const parsed = await parseEpubFile(buffer);
    res.json({
      success: true,
      book: {
        id: `upload_${Date.now()}`,
        filename: filename || 'uploaded.epub',
        ...parsed
      }
    });
  } catch (err) {
    console.error('EPUB upload read error:', err);
    res.status(500).json({ error: err.message || 'Failed to read uploaded EPUB file' });
  }
});

export default router;
