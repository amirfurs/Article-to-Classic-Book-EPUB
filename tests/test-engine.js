import fs from 'fs';
import JSZip from 'jszip';
import { generateEpub } from '../server/services/epubGenerator.js';
import { sanitizeToXhtml } from '../server/services/extractor.js';
import { db } from '../server/services/db.js';

async function runTests() {
  console.log('🧪 Starting ReadCast Engine Test Suite...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // --- Test 1: HTML Sanitizer & XHTML formatting ---
  console.log('--- Test 1: HTML Sanitization & XHTML conversion ---');
  try {
    const rawHtml = `
      <div>
        <p>This is a paragraph with a <a href="/test">relative link</a> and an unclosed image <img src="/photo.jpg">.</p>
        <script>alert('bad');</script>
        <iframe src="tracker.com"></iframe>
        <blockquote>A thoughtful quote.</blockquote>
      </div>
    `;
    const xhtml = sanitizeToXhtml(rawHtml, 'https://example.com/posts/article-1');
    assert(!xhtml.includes('<script'), 'Script tag stripped');
    assert(!xhtml.includes('<iframe'), 'Iframe tag stripped');
    assert(xhtml.includes('https://example.com/test'), 'Relative link resolved to absolute URL');
    assert(xhtml.includes('https://example.com/photo.jpg'), 'Image src resolved to absolute URL');
    assert(xhtml.includes('<blockquote>A thoughtful quote.</blockquote>'), 'Semantic blockquote preserved');
  } catch (err) {
    assert(false, `Sanitizer threw: ${err.message}`);
  }

  // --- Test 2: Single Article EPUB Generation ---
  console.log('\n--- Test 2: Single Article EPUB Generation ---');
  try {
    const testArticle = {
      title: 'The Art of Deep Reading in an Era of Infinite Feeds',
      author: 'Elena Vance',
      siteName: 'Mindful Tech Journal',
      url: 'https://example.com/deep-reading',
      readingTime: 6,
      wordCount: 1250,
      htmlContent: `
        <p>In the digital age, our attention is constantly fragmented by notifications, short-form video, and endless infinite scroll feeds.</p>
        <h2>Why Deep Reading Matters</h2>
        <p>Deep reading engages cognitive faculties that rapid skimming simply cannot replicate. Studies demonstrate enhanced empathy, retention, and analytical capability.</p>
        <blockquote>"To read deeply is to step inside another consciousness with full presence and stillness."</blockquote>
        <p>By moving articles to an e-ink display or an offline EPUB file, we reclaim sovereign control over our focus.</p>
      `
    };

    const res = await generateEpub({
      id: `test_single_${Date.now()}`,
      title: testArticle.title,
      author: testArticle.author,
      siteName: testArticle.siteName,
      coverStyle: 'literary',
      includeImages: false,
      articles: [testArticle]
    });

    assert(fs.existsSync(res.filePath), `EPUB file generated at ${res.filePath}`);
    assert(res.fileSize > 1000, `EPUB has sensible file size (${res.fileSize} bytes)`);

    // Inspect EPUB archive structure with JSZip
    const fileBuffer = fs.readFileSync(res.filePath);
    const zip = await JSZip.loadAsync(fileBuffer);

    assert(zip.file('mimetype') !== null, 'EPUB contains mimetype file');
    const mimetypeText = await zip.file('mimetype').async('string');
    assert(mimetypeText.trim() === 'application/epub+zip', 'mimetype has exact string "application/epub+zip"');

    assert(zip.file('META-INF/container.xml') !== null, 'Contains META-INF/container.xml');
    assert(zip.file('OEBPS/content.opf') !== null, 'Contains OEBPS/content.opf');
    assert(zip.file('OEBPS/cover.xhtml') !== null, 'Contains book cover XHTML (cover.xhtml)');
    assert(zip.file('OEBPS/titlepage.xhtml') !== null, 'Contains formal book title page (titlepage.xhtml)');
    assert(zip.file('OEBPS/colophon.xhtml') !== null, 'Contains archival book colophon (colophon.xhtml)');
    assert(zip.file('OEBPS/afterword.xhtml') !== null, 'Contains book afterword / FINIS (afterword.xhtml)');
    assert(zip.file('OEBPS/nav.xhtml') !== null, 'Contains OEBPS/nav.xhtml');
    assert(zip.file('OEBPS/toc.ncx') !== null, 'Contains OEBPS/toc.ncx');
    assert(zip.file('OEBPS/style.css') !== null, 'Contains OEBPS/style.css');
    assert(zip.file('OEBPS/cover.svg') !== null, 'Contains OEBPS/cover.svg');
    assert(zip.file('OEBPS/chapter_1.xhtml') !== null, 'Contains chapter_1.xhtml');

    const styleContent = await zip.file('OEBPS/style.css').async('string');
    assert(styleContent.includes('text-indent: 1.5em'), 'EPUB stylesheet enforces bookish paragraph indentation');
    assert(styleContent.includes('.dropcap') || styleContent.includes('initial-letter'), 'EPUB stylesheet includes drop caps');
    assert(styleContent.includes('❧'), 'EPUB stylesheet includes fleuron ornaments');

    const navContentSingle = await zip.file('OEBPS/nav.xhtml').async('string');
    assert(navContentSingle.includes('Why Deep Reading Matters'), 'EPUB nav table of contents indexes nested H2 subheadings');

    const opfContent = await zip.file('OEBPS/content.opf').async('string');
    assert(opfContent.includes('Elena Vance'), 'OPF metadata includes author');
    assert(opfContent.includes('The Art of Deep Reading'), 'OPF metadata includes title');
  } catch (err) {
    assert(false, `EPUB single generation threw: ${err.message}`);
  }

  // --- Test 3: Multi-Article Bundle EPUB Generation ---
  console.log('\n--- Test 3: Multi-Article Digest Bundle EPUB Generation ---');
  try {
    const bundleArticles = [
      {
        title: 'Chapter One: Architecture of Modern E-Readers',
        author: 'Dr. Marcus Webb',
        siteName: 'Hardware Review',
        url: 'https://example.com/e-readers',
        readingTime: 4,
        htmlContent: '<p>E-ink displays work by electrophoretic particles suspended in micro-capsules.</p>'
      },
      {
        title: 'Chapter Two: The Psychology of Focus',
        author: 'Sarah Lin',
        siteName: 'Cognitive Science Monthly',
        url: 'https://example.com/psychology',
        readingTime: 5,
        htmlContent: '<p>Dopamine loops from endless feeds weaken sustained comprehension.</p>'
      }
    ];

    const bundleRes = await generateEpub({
      id: `test_bundle_${Date.now()}`,
      title: 'Weekend Focus & Hardware Digest',
      author: 'Curated by ReadCast',
      coverStyle: 'modern',
      includeImages: false,
      articles: bundleArticles
    });

    assert(bundleRes.chaptersCount === 2, 'Bundle recorded 2 chapters');
    const zip = await JSZip.loadAsync(fs.readFileSync(bundleRes.filePath));
    assert(zip.file('OEBPS/chapter_1.xhtml') !== null, 'Contains chapter_1.xhtml');
    assert(zip.file('OEBPS/chapter_2.xhtml') !== null, 'Contains chapter_2.xhtml');

    const navContent = await zip.file('OEBPS/nav.xhtml').async('string');
    assert(navContent.includes('Chapter One: Architecture of Modern E-Readers'), 'Nav TOC includes Chapter 1');
    assert(navContent.includes('Chapter Two: The Psychology of Focus'), 'Nav TOC includes Chapter 2');
  } catch (err) {
    assert(false, `Bundle generation threw: ${err.message}`);
  }

  // --- Test 4: Database & Persistence ---
  console.log('\n--- Test 4: Database & Persistence ---');
  try {
    const testId = `test_db_${Date.now()}`;
    db.saveEpub({
      id: testId,
      title: 'Persistence Test Article',
      author: 'Tester',
      url: 'https://example.com/test',
      fileSize: 45000,
      readingTime: 3,
      wordCount: 800,
      isBundle: false
    });

    const queried = db.getEpubById(testId);
    assert(queried !== null, 'Retrieved saved EPUB from DB');
    assert(queried.title === 'Persistence Test Article', 'Record attributes matched');

    const lib = db.getLibrary({ search: 'Persistence' });
    assert(lib.items.some(i => i.id === testId), 'Library search returns newly added item');

    db.deleteEpub(testId);
    assert(db.getEpubById(testId) === null, 'Item deleted from DB successfully');
  } catch (err) {
    assert(false, `DB test threw: ${err.message}`);
  }

  // --- Test 5: Universal Article Extractor Logic (Lazy images, noise removal, Wikipedia cleanup) ---
  console.log('\n--- Test 5: Universal Multi-Site Extractor Logic ---');
  try {
    const multiSiteHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Universal Extractor Test - Tech & Science</title>
      </head>
      <body>
        <article class="entry-content">
          <h1>Universal Extraction in Modern Web Publishing</h1>
          <p>Modern publications employ diverse layout tricks that naive scrapers fail on.</p>
          <figure>
            <img src="data:image/svg+xml;base64,PHN2ZyB..." data-src="https://example.com/assets/high-res-diagram.jpg" alt="Architecture Diagram">
            <figcaption>Figure 1: High resolution system diagram.</figcaption>
          </figure>
          <p>Through heuristic arbitration, ReadCast preserves full article depth.</p>
          <div class="sharedaddy sd-sharing-enabled">Share this on Facebook or Twitter</div>
          <div class="newsletter-signup-box"><form><input type="email" placeholder="Subscribe"></form></div>
          <span class="mw-editsection"><a href="#">[edit]</a></span>
          <div class="navbox">Navigation box table</div>
        </article>
      </body>
      </html>
    `;

    const sanitized = sanitizeToXhtml(multiSiteHtml, 'https://example.com/deep/article');
    assert(sanitized.includes('https://example.com/assets/high-res-diagram.jpg'), 'Lazy-loaded data-src promoted to high-res image src');
    assert(!sanitized.includes('sharedaddy'), 'Social sharing widgets stripped');
    assert(!sanitized.includes('newsletter-signup-box'), 'Newsletter subscription boxes stripped');
    assert(!sanitized.includes('mw-editsection'), 'Wiki edit markers stripped');
    assert(!sanitized.includes('navbox'), 'Wiki navboxes and footer junk stripped');
    assert(sanitized.includes('figcaption>Figure 1: High resolution system diagram.</figcaption>'), 'Captioned figures preserved cleanly');
  } catch (err) {
    assert(false, `Extractor test threw: ${err.message}`);
  }

  // --- Test 6: Vercel & Serverless Deployment Readiness ---
  console.log('\n--- Test 6: Vercel & Serverless Deployment Readiness ---');
  try {
    // 6a. Verify api/index.js entrypoint exports valid Express handler
    const vercelEntry = await import('../api/index.js');
    assert(typeof vercelEntry.default === 'function', 'api/index.js exports valid Express app handler');

    // 6b. Verify bufferCache and in-memory delivery
    const { bufferCache } = await import('../server/services/bufferCache.js');
    const testBufferId = `test_cache_${Date.now()}`;
    bufferCache.set(testBufferId, {
      buffer: Buffer.from('test-epub-bytes'),
      filename: 'test.epub',
      fileSize: 15
    });
    assert(bufferCache.has(testBufferId), 'bufferCache stores generated EPUB');
    assert(bufferCache.get(testBufferId).buffer.toString() === 'test-epub-bytes', 'bufferCache returns exact buffer');
    bufferCache.delete(testBufferId);
    assert(!bufferCache.has(testBufferId), 'bufferCache evicts properly');

    // 6c. Verify vercel.json structure and configuration
    const vercelConfigRaw = fs.readFileSync('vercel.json', 'utf-8');
    const vercelConfig = JSON.parse(vercelConfigRaw);
    assert(Array.isArray(vercelConfig.rewrites), 'vercel.json has rewrites array');
    assert(vercelConfig.rewrites.some(r => r.source === '/api/(.*)'), 'vercel.json routes /api/(.*) to api/index.js');
    assert(vercelConfig.functions && vercelConfig.functions['api/index.js']?.maxDuration >= 30, 'vercel.json configures serverless maxDuration >= 30s');

    // 6d. Verify .vercelignore exists and excludes test files
    const vercelIgnore = fs.readFileSync('.vercelignore', 'utf-8');
    assert(vercelIgnore.includes('tests/'), '.vercelignore excludes test suite');
  } catch (err) {
    assert(false, `Vercel test threw: ${err.message}`);
  }

  console.log(`\n==========================================`);
  console.log(`🏁 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log(`==========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
