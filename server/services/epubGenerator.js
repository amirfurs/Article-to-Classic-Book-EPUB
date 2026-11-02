import JSZip from 'jszip';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { bufferCache } from './bufferCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serverless-safe downloads directory resolution (works on Vercel or local)
function resolveDownloadsDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'readcast-data', 'downloads');
  }

  const defaultDir = path.resolve(__dirname, '../../data/downloads');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    const testFile = path.join(defaultDir, `.test_${Date.now()}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return defaultDir;
  } catch (err) {
    return path.join(os.tmpdir(), 'readcast-data', 'downloads');
  }
}

const DOWNLOADS_DIR = resolveDownloadsDir();

// Ensure downloads directory exists
try {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
} catch (e) {
  // Silent fallback in serverless
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Determine MIME type from file extension or content-type
 */
function getMimeType(url, headerType = '') {
  if (headerType && headerType.startsWith('image/')) {
    return headerType.split(';')[0].trim();
  }
  const ext = path.extname(url).toLowerCase().split('?')[0];
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    default: return 'image/jpeg';
  }
}

/**
 * Download an image and return { buffer, mimeType, extension }
 */
async function fetchImage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    const mimeType = getMimeType(url, contentType);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Limit image size to 8MB
    if (buffer.length > 8 * 1024 * 1024) return null;

    let extension = 'jpg';
    if (mimeType === 'image/png') extension = 'png';
    else if (mimeType === 'image/gif') extension = 'gif';
    else if (mimeType === 'image/webp') extension = 'webp';
    else if (mimeType === 'image/svg+xml') extension = 'svg';

    return { buffer, mimeType, extension };
  } catch (e) {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Generate an authentic, collectible book cover SVG
 * Designed to resemble Penguin Classics, Library of America, and fine hardcover editions
 */
function generateCoverSvg({ title, author, siteName, date, coverStyle = 'modern', readingTime = 5 }) {
  const cleanTitle = escapeXml(title || 'Untitled Article');
  const cleanAuthor = escapeXml(author || siteName || 'ReadCast');
  const cleanSite = escapeXml(siteName || 'Web Article');
  const cleanDate = escapeXml(date || new Date().toISOString().split('T')[0]);

  // Wrap title text into balanced lines
  const words = (title || 'Untitled').split(' ');
  const lines = [];
  let currentLine = '';
  for (const w of words) {
    if ((currentLine + ' ' + w).length > 22) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = w;
    } else {
      currentLine = currentLine ? currentLine + ' ' + w : w;
    }
    if (lines.length >= 4) break;
  }
  if (currentLine && lines.length < 4) lines.push(currentLine.trim());

  let bgDef = '';
  let titleColor = '#f8fafc';
  let subtitleColor = '#94a3b8';
  let accentColor = '#2563eb';
  let badgeBg = '#1e293b';
  let borderColor = '#334155';
  let innerBorder = '#1e293b';
  let ornamentColor = '#3b82f6';
  let publisherTag = 'READCAST CLASSIC EDITIONS';
  let fontSerif = true;

  switch (coverStyle) {
    case 'literary':
      // Penguin / Everyman's Library Clothbound Style (Parchment & Warm Ink)
      bgDef = '<rect width="100%" height="100%" fill="#fbf8f1"/>';
      titleColor = '#1c1917';
      subtitleColor = '#78716c';
      accentColor = '#854d0e';
      badgeBg = '#f5f0e6';
      borderColor = '#b45309';
      innerBorder = '#d6cebe';
      ornamentColor = '#854d0e';
      publisherTag = 'READCAST LITERARY CLASSIC';
      fontSerif = true;
      break;

    case 'sunset':
      // Vintage Leather & Gold (Deep Burgundy / Twilight)
      bgDef = '<rect width="100%" height="100%" fill="#1a1523"/>';
      titleColor = '#fdf4ff';
      subtitleColor = '#cbd5e1';
      accentColor = '#e11d48';
      badgeBg = '#282038';
      borderColor = '#be123c';
      innerBorder = '#4a2545';
      ornamentColor = '#f43f5e';
      publisherTag = 'READCAST SPECIAL COLLECTION';
      fontSerif = true;
      break;

    case 'slate':
      // Minimal E-Ink Monochrome Hardcover (High contrast black & white)
      bgDef = '<rect width="100%" height="100%" fill="#0a0a0c"/>';
      titleColor = '#ffffff';
      subtitleColor = '#a1a1aa';
      accentColor = '#ffffff';
      badgeBg = '#18181b';
      borderColor = '#52525b';
      innerBorder = '#27272a';
      ornamentColor = '#d4d4d8';
      publisherTag = 'READCAST E-INK EDITION';
      fontSerif = false;
      break;

    case 'modern':
    default:
      // Hardcover Minimalist (Deep Oxford Navy & Crisp White)
      bgDef = '<rect width="100%" height="100%" fill="#0f172a"/>';
      titleColor = '#f8fafc';
      subtitleColor = '#94a3b8';
      accentColor = '#3b82f6';
      badgeBg = '#1e293b';
      borderColor = '#2563eb';
      innerBorder = '#334155';
      ornamentColor = '#60a5fa';
      publisherTag = 'READCAST CLASSIC EDITIONS';
      fontSerif = true;
      break;
  }

  const fontFamily = fontSerif 
    ? '"Georgia", "Charter", "Newsreader", "Times New Roman", serif' 
    : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const titleLinesSvg = lines.map((line, i) => {
    const y = 560 + (i * 72);
    return `<text x="500" y="${y}" font-family='${fontFamily}' font-size="54" font-weight="${fontSerif ? '700' : '800'}" fill="${titleColor}" letter-spacing="-0.01em" text-anchor="middle">${escapeXml(line)}</text>`;
  }).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500" width="1000" height="1500">
  ${bgDef}

  <!-- Outer Double Book Border -->
  <rect x="40" y="40" width="920" height="1420" rx="4" fill="none" stroke="${borderColor}" stroke-width="3"/>
  <rect x="56" y="56" width="888" height="1388" rx="2" fill="none" stroke="${innerBorder}" stroke-width="1.5"/>

  <!-- Ornate Corner Flourishes -->
  <g stroke="${ornamentColor}" stroke-width="1.5" fill="none">
    <path d="M 64 80 L 80 80 L 80 64" />
    <path d="M 936 80 L 920 80 L 920 64" />
    <path d="M 64 1420 L 80 1420 L 80 1436" />
    <path d="M 936 1420 L 920 1420 L 920 1436" />
  </g>

  <!-- Top Source Banner -->
  <g transform="translate(500, 160)">
    <text x="0" y="0" font-family='${fontFamily}' font-size="20" font-weight="700" fill="${ornamentColor}" letter-spacing="0.2em" text-anchor="middle" text-transform="uppercase">${cleanSite}</text>
    <line x1="-120" y1="18" x2="120" y2="18" stroke="${ornamentColor}" stroke-width="1"/>
  </g>

  <!-- Author Header Block -->
  <g transform="translate(500, 340)">
    <text x="0" y="0" font-family='${fontFamily}' font-size="18" font-weight="600" fill="${subtitleColor}" letter-spacing="0.25em" text-anchor="middle" text-transform="uppercase">WRITTEN BY</text>
    <text x="0" y="55" font-family='${fontFamily}' font-size="38" font-weight="700" fill="${titleColor}" text-anchor="middle" letter-spacing="0.04em">${cleanAuthor}</text>
  </g>

  <!-- Central Title Ornamental Divider -->
  <g transform="translate(500, 470)">
    <line x1="-180" y1="0" x2="-35" y2="0" stroke="${ornamentColor}" stroke-width="2"/>
    <text x="0" y="8" font-family='${fontFamily}' font-size="28" fill="${ornamentColor}" text-anchor="middle">❧</text>
    <line x1="35" y1="0" x2="180" y2="0" stroke="${ornamentColor}" stroke-width="2"/>
  </g>

  <!-- Title Lines -->
  ${titleLinesSvg}

  <!-- Reading Time & Metadata Emblem -->
  <g transform="translate(500, 960)">
    <rect x="-140" y="-22" width="280" height="44" rx="4" fill="${badgeBg}" stroke="${innerBorder}" stroke-width="1"/>
    <text x="0" y="6" font-family='${fontFamily}' font-size="16" font-weight="600" fill="${subtitleColor}" letter-spacing="0.12em" text-anchor="middle" text-transform="uppercase">${readingTime} MIN READ</text>
  </g>

  <!-- Bottom Publisher Mark -->
  <g transform="translate(500, 1340)">
    <line x1="-80" y1="-30" x2="80" y2="-30" stroke="${innerBorder}" stroke-width="1"/>
    <text x="0" y="0" font-family='${fontFamily}' font-size="16" font-weight="700" fill="${subtitleColor}" letter-spacing="0.22em" text-anchor="middle" text-transform="uppercase">${publisherTag}</text>
    <text x="0" y="28" font-family='${fontFamily}' font-size="14" font-weight="500" fill="${subtitleColor}" letter-spacing="0.08em" text-anchor="middle">${cleanDate}</text>
  </g>
</svg>`;
}

/**
 * Authentic Book CSS Stylesheet
 * Incorporates drop caps, paragraph indentation, justified alignment, fleurons, and e-ink optimizations
 */
const EPUB_STYLESHEET = `
@namespace "http://www.w3.org/1999/xhtml";

@page {
  margin: 6% 6%;
}

body {
  margin: 0;
  padding: 0;
  font-family: "Georgia", "Merriweather", "Charter", "Palatino", "Times New Roman", serif;
  font-size: 1.05em;
  line-height: 1.68;
  color: #1a1a1a;
  background-color: transparent;
  text-rendering: optimizeLegibility;
}

html[dir="rtl"] body, body.rtl {
  direction: rtl;
  text-align: right;
  font-family: "Amiri", "Traditional Arabic", "Scheherazade New", "Geeza Pro", "Georgia", serif;
  line-height: 1.9;
}

/* ==================== BOOK FRONT MATTER ==================== */
.title-page {
  text-align: center;
  padding: 18% 5% 10%;
  page-break-after: always;
  break-after: page;
}

.title-page-half {
  text-align: center;
  padding: 35% 5%;
  page-break-after: always;
  break-after: page;
}

.half-title-text {
  font-size: 1.6em;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #1a1a1a;
}

.book-title {
  font-size: 2.2em;
  font-weight: 700;
  line-height: 1.22;
  margin-bottom: 0.3em;
  letter-spacing: -0.01em;
  color: #0f172a;
}

.book-subtitle {
  font-size: 1.1em;
  font-style: italic;
  color: #475569;
  margin: 0.5em 0 1.5em;
}

.book-fleuron {
  font-size: 1.6em;
  color: #64748b;
  margin: 1.5em auto;
  line-height: 1;
}

.book-author-byline {
  font-size: 0.85em;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: #64748b;
  margin-top: 2em;
}

.book-author-name {
  font-size: 1.4em;
  font-weight: 700;
  letter-spacing: 0.05em;
  margin-top: 0.2em;
  color: #0f172a;
}

.book-publisher-imprint {
  margin-top: 5em;
  font-size: 0.82em;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #64748b;
}

.book-publisher-year {
  font-size: 0.78em;
  color: #94a3b8;
  margin-top: 0.3em;
}

/* Colophon / Copyright Page */
.colophon-page {
  padding: 15% 5% 5%;
  font-size: 0.88em;
  color: #475569;
  line-height: 1.75;
  page-break-after: always;
  break-after: page;
}

.colophon-heading {
  font-size: 1.05em;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 1.5em;
  color: #0f172a;
  border-bottom: 1px solid #cbd5e1;
  padding-bottom: 0.4em;
}

.colophon-item {
  margin-bottom: 0.75em;
}

.colophon-label {
  font-weight: 700;
  color: #1e293b;
}

.colophon-note {
  margin-top: 2.5em;
  padding-top: 1.5em;
  border-top: 1px dashed #cbd5e1;
  font-style: italic;
  font-size: 0.85em;
}

/* ==================== CHAPTER & ARTICLE TYPOGRAPHY ==================== */
.chapter-header {
  text-align: center;
  margin-bottom: 2.5em;
  padding-bottom: 1.5em;
  border-bottom: 1px solid #e2e8f0;
  page-break-after: avoid;
  break-after: avoid;
}

.chapter-number {
  font-size: 0.85em;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 0.5em;
}

.chapter-title {
  font-size: 2.1em;
  font-weight: 700;
  line-height: 1.25;
  margin: 0.2em 0 0.5em;
  color: #0f172a;
}

.chapter-meta {
  font-size: 0.88em;
  color: #64748b;
  margin-top: 0.8em;
}

.chapter-meta span {
  margin: 0 0.8em;
}

.chapter-source {
  font-size: 0.8em;
  color: #94a3b8;
  margin-top: 0.5em;
  word-break: break-all;
}

/* Book Paragraph Indentation (The Authentic Novel/Essay Look) */
.article-body p, .chapter-body p, p {
  margin: 0;
  text-align: justify;
  text-justify: inter-word;
  hyphens: auto;
  -webkit-hyphens: auto;
  adobe-hyphenate: auto;
  line-height: 1.68;
}

/* Subsequent paragraphs are indented by 1.5em */
.article-body p + p, .chapter-body p + p, p + p {
  text-indent: 1.5em;
  margin-top: 0;
}

/* Paragraphs directly following headings, quotes, or breaks do NOT indent */
h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p,
.chapter-header + p, .article-header + p,
blockquote + p, figure + p, hr + p, .ornament-break + p,
.no-indent, .lead {
  text-indent: 0;
  margin-top: 0.8em;
}

/* Illuminated Drop Cap on First Paragraph */
.chapter-body > p:first-of-type::first-letter,
.article-body > p:first-of-type::first-letter,
.dropcap {
  float: left;
  font-size: 3.3em;
  line-height: 0.82;
  margin: 0.08em 0.14em 0 0;
  font-family: "Georgia", "Newsreader", "Charter", "Times New Roman", serif;
  font-weight: 700;
  color: #0f172a;
}

/* RTL disables float for drop caps to preserve cursive letter joining */
html[dir="rtl"] .chapter-body > p:first-of-type::first-letter,
html[dir="rtl"] .article-body > p:first-of-type::first-letter,
html[dir="rtl"] .dropcap {
  float: none;
  font-size: 1.25em;
  font-weight: 700;
  margin: 0;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  font-family: "Georgia", "Charter", -apple-system, sans-serif;
  font-weight: 700;
  line-height: 1.28;
  color: #0f172a;
  margin-top: 1.8em;
  margin-bottom: 0.6em;
  page-break-after: avoid;
  break-after: avoid;
}

h1 { font-size: 1.75em; text-align: center; }
h2 { font-size: 1.35em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25em; }
h3 { font-size: 1.18em; }
h4 { font-size: 1.05em; font-style: italic; }

/* Links */
a {
  color: #2563eb;
  text-decoration: underline;
}

/* Bookish Blockquotes */
blockquote {
  margin: 1.6em 1.8em;
  padding: 0.6em 1.2em;
  border-left: 3px solid #2563eb;
  background-color: #f8fafc;
  font-style: italic;
  color: #334155;
  page-break-inside: avoid;
  break-inside: avoid;
}

html[dir="rtl"] blockquote {
  border-left: none;
  border-right: 3px solid #2563eb;
}

/* Ornamental Section Breaks */
hr, .ornament-break {
  border: none;
  text-align: center;
  margin: 2.2em auto;
  height: auto;
  line-height: 1;
  overflow: visible;
}

hr::before, .ornament-break::before {
  content: "❧  ❧  ❧";
  font-size: 1.15em;
  color: #64748b;
  letter-spacing: 0.6em;
}

/* Figures & Captions */
figure {
  margin: 2em 0;
  text-align: center;
  page-break-inside: avoid;
  break-inside: avoid;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1.5em auto;
  border-radius: 2px;
}

figcaption {
  font-size: 0.85em;
  color: #64748b;
  margin-top: 0.6em;
  font-style: italic;
  line-height: 1.4;
}

/* Code & Preformatted */
pre, code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
  font-size: 0.88em;
  background-color: #f1f5f9;
  border-radius: 3px;
}

code {
  padding: 0.15em 0.35em;
}

pre {
  padding: 0.9em 1.1em;
  overflow-x: auto;
  line-height: 1.42;
  margin: 1.4em 0;
  border: 1px solid #e2e8f0;
  page-break-inside: avoid;
  break-inside: avoid;
}

pre code {
  padding: 0;
  background-color: transparent;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.6em 0;
  font-size: 0.9em;
  page-break-inside: avoid;
  break-inside: avoid;
}

th, td {
  border: 1px solid #cbd5e1;
  padding: 0.55em 0.8em;
  text-align: left;
}

html[dir="rtl"] th, html[dir="rtl"] td {
  text-align: right;
}

th {
  background-color: #f1f5f9;
  font-weight: 700;
}

/* Lists */
ul, ol {
  margin: 0.8em 0 1.2em 1.8em;
  padding: 0;
}

html[dir="rtl"] ul, html[dir="rtl"] ol {
  margin: 0.8em 1.8em 1.2em 0;
}

li {
  margin-bottom: 0.45em;
}

/* Table of Contents Page */
.toc-list {
  list-style-type: none;
  padding-left: 0;
}

.toc-item {
  margin-bottom: 1.1em;
  padding-bottom: 0.7em;
  border-bottom: 1px dashed #e2e8f0;
}

.toc-title {
  font-weight: 700;
  font-size: 1.12em;
}

.toc-author {
  font-size: 0.86em;
  color: #64748b;
  margin-top: 0.2em;
}

/* Back Matter Afterword Page */
.afterword-page {
  text-align: center;
  padding: 22% 8% 10%;
  page-break-before: always;
  break-before: page;
}

.finis-mark {
  font-size: 1.3em;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 1.5em;
}

.afterword-text {
  font-size: 0.92em;
  color: #475569;
  max-width: 480px;
  margin: 0 auto 1.5em;
  line-height: 1.6;
}
`;

/**
 * Extract H2 subheadings from HTML content to generate nested chapter TOC navigation
 */
function extractSubheadings(htmlContent) {
  const subheadings = [];
  const regex = /<h2[^>]*id=["']([^"']+)["'][^>]*>(.*?)<\/h2>|<h2[^>]*>(.*?)<\/h2>/gi;
  let match;
  let idx = 1;

  while ((match = regex.exec(htmlContent)) !== null) {
    const rawId = match[1];
    const text = (match[2] || match[3] || '').replace(/<[^>]+>/g, '').trim();
    if (text && text.length > 2 && text.length < 80) {
      const id = rawId || `section-${idx}`;
      subheadings.push({ id, text });
      idx++;
    }
  }
  return subheadings;
}

/**
 * Ensure all H2 tags have ID attributes for deep TOC anchor linking
 */
function ensureHeadingIds(htmlContent) {
  let idx = 1;
  return htmlContent.replace(/<h2([^>]*)>(.*?)<\/h2>/gi, (fullMatch, attribs, innerText) => {
    if (!/id=["'][^"']+["']/i.test(attribs)) {
      const id = `section-${idx++}`;
      return `<h2 id="${id}"${attribs}>${innerText}</h2>`;
    }
    return fullMatch;
  });
}

/**
 * Main function to generate an EPUB file formatted as an authentic classic book
 * Supports single long-form articles or multi-article anthologies
 */
export async function generateEpub({
  id = `epub_${Date.now()}`,
  title,
  author,
  siteName = 'Web Article',
  date = new Date().toISOString().split('T')[0],
  coverStyle = 'modern',
  includeImages = true,
  articles = [] // array of { title, author, siteName, url, htmlContent, leadImageUrl, readingTime, wordCount }
}) {
  const zip = new JSZip();

  const isRtl = articles.some(a => a.isRtl) || /[\u0600-\u06FF\u0590-\u05FF\u0750-\u077F]/.test(title + ' ' + (author || ''));
  const langCode = isRtl ? 'ar' : 'en';
  const dirAttr = isRtl ? ' dir="rtl"' : '';

  const totalReadingTime = articles.reduce((acc, a) => acc + (a.readingTime || 5), 0);
  const totalWordCount = articles.reduce((acc, a) => acc + (a.wordCount || 0), 0);
  const primaryAuthor = author || (articles[0] && articles[0].author) || 'ReadCast';
  const primarySite = siteName || (articles[0] && articles[0].siteName) || 'Web Article';

  // 1. mimetype (MUST be stored uncompressed as the first entry in ZIP)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.file('META-INF/container.xml', containerXml);

  // 3. Stylesheet
  zip.file('OEBPS/style.css', EPUB_STYLESHEET);

  // 4. Generate Book Cover SVG
  const coverSvg = generateCoverSvg({
    title,
    author: primaryAuthor,
    siteName: primarySite,
    date,
    coverStyle,
    readingTime: totalReadingTime
  });
  zip.file('OEBPS/cover.svg', coverSvg);

  // 5. Cover Page XHTML
  const coverXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <title>Cover</title>
  <style type="text/css">
    @page { margin: 0; }
    body { margin: 0; padding: 0; text-align: center; background-color: #000000; }
    img { max-width: 100%; max-height: 100vh; height: auto; margin: auto; display: block; }
  </style>
</head>
<body>
  <div>
    <img src="cover.svg" alt="Cover" />
  </div>
</body>
</html>`;
  zip.file('OEBPS/cover.xhtml', coverXhtml);

  // 6. Half-Title & Formal Title Page (Classic Book Front Matter)
  const titlePageXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${langCode}"${dirAttr}>
<head>
  <title>${escapeXml(title)} — Title Page</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <div class="title-page">
    <div class="book-fleuron">❧</div>
    <h1 class="book-title">${escapeXml(title)}</h1>
    <div class="book-subtitle">${escapeXml(primarySite)}</div>
    
    <div class="book-author-byline">BY</div>
    <div class="book-author-name">${escapeXml(primaryAuthor)}</div>

    <div class="book-publisher-imprint">READCAST CLASSIC EDITIONS</div>
    <div class="book-publisher-year">${escapeXml(date.split('-')[0])}</div>
  </div>
</body>
</html>`;
  zip.file('OEBPS/titlepage.xhtml', titlePageXhtml);

  // 7. Colophon & Archival Page (Copyright / Metadata)
  const colophonXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${langCode}"${dirAttr}>
<head>
  <title>Colophon</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <div class="colophon-page">
    <div class="colophon-heading">ARCHIVAL &amp; EDITION DETAILS</div>
    
    <div class="colophon-item">
      <span class="colophon-label">Work:</span> ${escapeXml(title)}
    </div>
    <div class="colophon-item">
      <span class="colophon-label">Author:</span> ${escapeXml(primaryAuthor)}
    </div>
    <div class="colophon-item">
      <span class="colophon-label">Source:</span> ${escapeXml(primarySite)}
    </div>
    <div class="colophon-item">
      <span class="colophon-label">Date Curated:</span> ${escapeXml(date)}
    </div>
    <div class="colophon-item">
      <span class="colophon-label">Volume Length:</span> ${totalWordCount.toLocaleString()} words (~${totalReadingTime} minutes)
    </div>
    ${articles[0] && articles[0].url ? `
    <div class="colophon-item">
      <span class="colophon-label">Source URL:</span> <a href="${escapeXml(articles[0].url)}">${escapeXml(articles[0].url)}</a>
    </div>` : ''}

    <div class="colophon-note">
      This digital edition has been typeset with classic book typography, paragraph indentation, drop caps, and balanced margins for Kindle, Kobo, and Apple Books. DRM-Free.
    </div>
  </div>
</body>
</html>`;
  zip.file('OEBPS/colophon.xhtml', colophonXhtml);

  // 8. Process Chapters & Embedded Images
  const manifestItems = [
    { id: 'style', href: 'style.css', mediaType: 'text/css' },
    { id: 'cover-image', href: 'cover.svg', mediaType: 'image/svg+xml', properties: 'cover-image' },
    { id: 'cover', href: 'cover.xhtml', mediaType: 'application/xhtml+xml' },
    { id: 'titlepage', href: 'titlepage.xhtml', mediaType: 'application/xhtml+xml' },
    { id: 'colophon', href: 'colophon.xhtml', mediaType: 'application/xhtml+xml' },
    { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
    { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' }
  ];

  const spineItems = [
    { idref: 'cover' },
    { idref: 'titlepage' },
    { idref: 'colophon' }
  ];

  const processedChapters = [];
  let globalImageIndex = 1;

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    const chapterId = `chapter_${i + 1}`;
    let processedHtml = art.htmlContent || '<p>No content provided.</p>';

    // Image downloading and embedding
    if (includeImages) {
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      const matches = [...processedHtml.matchAll(imgRegex)];
      
      // Limit to max 25 images per chapter to keep build time fast and responsive
      const maxImages = Math.min(matches.length, 25);
      for (let j = 0; j < maxImages; j++) {
        const fullMatch = matches[j][0];
        const srcUrl = matches[j][1];

        if (srcUrl && (srcUrl.startsWith('http://') || srcUrl.startsWith('https://'))) {
          try {
            const fetched = await fetchImage(srcUrl);
            if (fetched) {
              const imgFileName = `img_${globalImageIndex}.${fetched.extension}`;
              zip.file(`OEBPS/images/${imgFileName}`, fetched.buffer);

              manifestItems.push({
                id: `img_${globalImageIndex}`,
                href: `images/${imgFileName}`,
                mediaType: fetched.mimeType
              });

              // Replace original src with local relative path
              const updatedTag = fullMatch.replace(srcUrl, `images/${imgFileName}`);
              processedHtml = processedHtml.replace(fullMatch, updatedTag);
              globalImageIndex++;
            }
          } catch (imgErr) {
            console.warn(`Could not embed image ${srcUrl}:`, imgErr.message);
          }
        }
      }
    } else {
      // Strip images if user selected no images
      processedHtml = processedHtml.replace(/<img[^>]*>/gi, '');
      processedHtml = processedHtml.replace(/<figure[^>]*>.*?<\/figure>/gis, '');
    }

    // Ensure H2 tags have IDs for subheadings navigation
    processedHtml = ensureHeadingIds(processedHtml);
    const subheadings = extractSubheadings(processedHtml);

    // Wrap in authentic book chapter structure with Drop Cap & Chapter Header
    const chapterLabel = articles.length > 1 ? `CHAPTER ${i + 1}` : 'ESSAY';
    const chapterXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${langCode}"${dirAttr}>
<head>
  <title>${escapeXml(art.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <div class="chapter-header">
    <div class="chapter-number">${chapterLabel}</div>
    <h1 class="chapter-title">${escapeXml(art.title)}</h1>
    <div class="chapter-meta">
      ${art.author ? `<span>${escapeXml(art.author)}</span>` : ''}
      ${art.siteName ? `<span>•</span><span>${escapeXml(art.siteName)}</span>` : ''}
      ${art.readingTime ? `<span>•</span><span>${art.readingTime} min read</span>` : ''}
    </div>
  </div>

  <div class="chapter-body article-body">
    ${processedHtml}
  </div>
</body>
</html>`;

    zip.file(`OEBPS/${chapterId}.xhtml`, chapterXhtml);

    manifestItems.push({
      id: chapterId,
      href: `${chapterId}.xhtml`,
      mediaType: 'application/xhtml+xml'
    });

    spineItems.push({ idref: chapterId });

    processedChapters.push({
      id: chapterId,
      title: art.title || `Chapter ${i + 1}`,
      author: art.author || '',
      href: `${chapterId}.xhtml`,
      subheadings
    });
  }

  // 9. Afterword / End of Book Colophon (Back Matter)
  const afterwordXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${langCode}"${dirAttr}>
<head>
  <title>End of Book</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <div class="afterword-page">
    <div class="finis-mark">— FINIS —</div>
    <div class="afterword-text">
      Thank you for reading <em>${escapeXml(title)}</em>. This edition was compiled for distraction-free e-ink reading.
    </div>
    <div class="book-fleuron">❦</div>
    <div class="afterword-text" style="font-size: 0.8em; color: #94a3b8;">
      ReadCast Article-to-EPUB Engine • DRM-Free
    </div>
  </div>
</body>
</html>`;
  zip.file('OEBPS/afterword.xhtml', afterwordXhtml);

  manifestItems.push({
    id: 'afterword',
    href: 'afterword.xhtml',
    mediaType: 'application/xhtml+xml'
  });
  spineItems.push({ idref: 'afterword' });

  // 10. Navigation Document (OEBPS/nav.xhtml) - EPUB3 standard with nested subheadings
  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${langCode}"${dirAttr}>
<head>
  <title>Table of Contents</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol class="toc-list">
      ${processedChapters.map(ch => `
        <li class="toc-item">
          <a href="${ch.href}"><span class="toc-title">${escapeXml(ch.title)}</span></a>
          ${ch.author ? `<div class="toc-author">${escapeXml(ch.author)}</div>` : ''}
          ${ch.subheadings && ch.subheadings.length > 0 ? `
          <ol style="margin-top: 0.4em; padding-left: 1.2em; font-size: 0.9em; list-style-type: disc;">
            ${ch.subheadings.map(sub => `
              <li><a href="${ch.href}#${sub.id}">${escapeXml(sub.text)}</a></li>
            `).join('')}
          </ol>` : ''}
        </li>
      `).join('')}
    </ol>
  </nav>
</body>
</html>`;
  zip.file('OEBPS/nav.xhtml', navXhtml);

  // 11. Legacy NCX Table of Contents (OEBPS/toc.ncx) - for Kindle & EPUB2 devices
  let playOrder = 1;
  const ncxNavPoints = processedChapters.map(ch => {
    const parentPlayOrder = playOrder++;
    const subNavPoints = (ch.subheadings || []).map(sub => `
        <navPoint id="navPoint-${playOrder}" playOrder="${playOrder++}">
          <navLabel>
            <text>${escapeXml(sub.text)}</text>
          </navLabel>
          <content src="${ch.href}#${sub.id}"/>
        </navPoint>
    `).join('');

    return `
      <navPoint id="navPoint-${parentPlayOrder}" playOrder="${parentPlayOrder}">
        <navLabel>
          <text>${escapeXml(ch.title)}</text>
        </navLabel>
        <content src="${ch.href}"/>
        ${subNavPoints}
      </navPoint>
    `;
  }).join('');

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${id}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeXml(title)}</text>
  </docTitle>
  <docAuthor>
    <text>${escapeXml(primaryAuthor)}</text>
  </docAuthor>
  <navMap>
    ${ncxNavPoints}
  </navMap>
</ncx>`;
  zip.file('OEBPS/toc.ncx', tocNcx);

  // 12. Package Document (OEBPS/content.opf)
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(primaryAuthor)}</dc:creator>
    <dc:publisher>ReadCast Classic Editions</dc:publisher>
    <dc:language>${langCode}</dc:language>
    <dc:date>${date}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    ${manifestItems.map(item => `
      <item id="${item.id}" href="${item.href}" media-type="${item.mediaType}"${item.properties ? ` properties="${item.properties}"` : ''}/>
    `).join('')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.map(item => `<itemref idref="${item.idref}"/>`).join('\n    ')}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', contentOpf);

  // 13. Generate ZIP Buffer and write to file
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    mimeType: 'application/epub+zip'
  });

  const cleanBase = title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  const safeFilename = `${cleanBase || 'book'}-${Date.now()}.epub`;
  const filePath = path.join(DOWNLOADS_DIR, safeFilename);
  
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    // In serverless / read-only filesystem, file is stored in memory buffer
    console.warn('Could not write EPUB to disk, using in-memory buffer:', err.message);
  }

  // Cache buffer in memory for instant serverless downloads
  bufferCache.set(id, {
    buffer,
    filename: safeFilename,
    fileSize: buffer.length
  });

  return {
    id,
    filename: safeFilename,
    filePath,
    fileSize: buffer.length,
    buffer,
    base64: buffer.toString('base64'),
    chaptersCount: processedChapters.length,
    downloadUrl: `/api/download/${id}`
  };
}
