import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

/**
 * Service to parse and unpack an EPUB file into structured chapter HTML and TTS text
 */
export async function parseEpubFile(filePathOrBuffer) {
  let buffer;
  if (Buffer.isBuffer(filePathOrBuffer)) {
    buffer = filePathOrBuffer;
  } else {
    if (!fs.existsSync(filePathOrBuffer)) {
      throw new Error(`EPUB file not found: ${filePathOrBuffer}`);
    }
    buffer = fs.readFileSync(filePathOrBuffer);
  }

  const zip = await JSZip.loadAsync(buffer);

  // 1. Read META-INF/container.xml
  const containerXmlFile = zip.file('META-INF/container.xml');
  if (!containerXmlFile) {
    throw new Error('Invalid EPUB: META-INF/container.xml is missing');
  }

  const containerXml = await containerXmlFile.async('string');
  const domContainer = new JSDOM(containerXml, { contentType: 'application/xml' });
  const rootfileEl = domContainer.window.document.querySelector('rootfile');
  if (!rootfileEl) {
    throw new Error('Invalid EPUB: rootfile not found in container.xml');
  }

  const opfPath = rootfileEl.getAttribute('full-path') || 'OEBPS/content.opf';
  const opfDir = path.posix.dirname(opfPath);

  // 2. Read OPF file
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);
  }

  const opfContent = await opfFile.async('string');
  const domOpf = new JSDOM(opfContent, { contentType: 'application/xml' });
  const docOpf = domOpf.window.document;

  // Metadata
  const titleEl = docOpf.querySelector('dc\\:title, title');
  const creatorEl = docOpf.querySelector('dc\\:creator, creator');
  const languageEl = docOpf.querySelector('dc\\:language, language');

  const title = titleEl ? titleEl.textContent.trim() : 'Untitled Book';
  const author = creatorEl ? creatorEl.textContent.trim() : 'Unknown Author';
  const language = languageEl ? languageEl.textContent.trim() : 'en';

  // Manifest items map: id -> { id, href, fullPath, mediaType }
  const manifestMap = new Map();
  const itemEls = docOpf.querySelectorAll('manifest > item');
  itemEls.forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type');
    const fullPath = opfDir === '.' ? href : path.posix.join(opfDir, href);
    manifestMap.set(id, { id, href, fullPath, mediaType });
  });

  // Spine items in reading order
  const spineItemrefs = docOpf.querySelectorAll('spine > itemref');
  const spineChapterIds = [];
  spineItemrefs.forEach(ref => {
    const idref = ref.getAttribute('idref');
    if (idref) spineChapterIds.push(idref);
  });

  // Load Cover image if present
  let coverDataUri = null;
  for (const [id, item] of manifestMap.entries()) {
    if (item.mediaType.startsWith('image/') && (id.includes('cover') || item.href.includes('cover'))) {
      const coverFile = zip.file(item.fullPath);
      if (coverFile) {
        const coverBuf = await coverFile.async('nodebuffer');
        coverDataUri = `data:${item.mediaType};base64,${coverBuf.toString('base64')}`;
        break;
      }
    }
  }

  // Parse each chapter in spine order
  const chapters = [];
  for (let i = 0; i < spineChapterIds.length; i++) {
    const chapterId = spineChapterIds[i];
    const manifestItem = manifestMap.get(chapterId);
    if (!manifestItem) continue;

    const file = zip.file(manifestItem.fullPath);
    if (!file) continue;

    const rawHtml = await file.async('string');
    const domChapter = new JSDOM(rawHtml);
    const docChapter = domChapter.window.document;

    // Determine chapter title
    let chapterTitle = '';
    const h1 = docChapter.querySelector('h1, h2, title');
    if (h1 && h1.textContent.trim()) {
      chapterTitle = h1.textContent.trim();
    } else {
      chapterTitle = `Chapter ${chapters.length + 1}`;
    }

    // Skip standalone cover pages in chapter reader if it's just a cover image
    const isCoverOnly = docChapter.body.children.length === 1 && 
      (docChapter.body.firstElementChild.tagName === 'DIV' || docChapter.body.firstElementChild.tagName === 'IMG') &&
      docChapter.body.textContent.trim().length === 0;

    if (isCoverOnly && chapters.length === 0) {
      // It's the cover wrapper page
      continue;
    }

    // Embed all internal images as Data URIs so they display standalone
    const images = docChapter.querySelectorAll('img');
    for (const img of images) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
        const imgPath = path.posix.join(path.posix.dirname(manifestItem.fullPath), src);
        const imgFile = zip.file(imgPath);
        if (imgFile) {
          const imgBuf = await imgFile.async('nodebuffer');
          let mime = 'image/jpeg';
          if (src.endsWith('.png')) mime = 'image/png';
          else if (src.endsWith('.svg')) mime = 'image/svg+xml';
          else if (src.endsWith('.webp')) mime = 'image/webp';
          else if (src.endsWith('.gif')) mime = 'image/gif';
          img.setAttribute('src', `data:${mime};base64,${imgBuf.toString('base64')}`);
        }
      }
    }

    // Clean body HTML and plain text for TTS
    const bodyContent = docChapter.body ? docChapter.body.innerHTML : rawHtml;
    const plainText = docChapter.body ? docChapter.body.textContent.replace(/\s+/g, ' ').trim() : '';

    chapters.push({
      id: chapterId,
      index: chapters.length,
      title: chapterTitle,
      html: bodyContent,
      plainText: plainText,
      wordCount: plainText.split(' ').filter(Boolean).length
    });
  }

  // If no chapters were loaded (e.g. Unusual EPUB structure), fallback to all xhtml files
  if (chapters.length === 0) {
    for (const [id, item] of manifestMap.entries()) {
      if (item.mediaType === 'application/xhtml+xml') {
        const file = zip.file(item.fullPath);
        if (file) {
          const rawHtml = await file.async('string');
          chapters.push({
            id,
            index: chapters.length,
            title: `Section ${chapters.length + 1}`,
            html: rawHtml,
            plainText: rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
            wordCount: 100
          });
        }
      }
    }
  }

  return {
    title,
    author,
    language,
    coverDataUri,
    totalChapters: chapters.length,
    chapters
  };
}
