import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import sanitizeHtml from 'sanitize-html';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Fetch HTML with native fetch and robust curl fallback for tricky servers
 * Handles TLS renegotiation, HTTP/2, brotli/gzip compression, and IPv6 blackholes
 */
export async function fetchArticleHtml(url) {
  const parsedUrl = new URL(url);

  // Attempt 1: Native Node fetch with complete modern browser headers
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

    const response = await fetch(parsedUrl.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ar,en-US,en;q=0.9,fr;q=0.8,es;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const html = await response.text();
      if (html && html.length > 500) {
        return { html, finalUrl: response.url || url };
      }
    }
  } catch (err) {
    console.warn(`Native fetch failed for ${url} (${err.message}), attempting curl fallback...`);
  }

  // Attempt 2: Fallback to curl which handles TLS renegotiation and IPv4/IPv6 gracefully
  try {
    const curlCmd = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const { stdout } = await execFileAsync(curlCmd, [
      '-s', '-L',
      '--compressed',
      '--max-time', '35',
      '-H', `User-Agent: ${DEFAULT_USER_AGENT}`,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: ar,en-US,en;q=0.9',
      '-H', 'Sec-Fetch-Mode: navigate',
      parsedUrl.href
    ], { maxBuffer: 50 * 1024 * 1024 });

    if (stdout && stdout.length > 500) {
      return { html: stdout, finalUrl: url };
    }
    throw new Error('Curl returned empty response');
  } catch (curlErr) {
    throw new Error(`Failed to fetch article from ${url}: ${curlErr.message}`);
  }
}

/**
 * Extract meta tag content helper
 */
function getMetaContent(doc, selectors) {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) {
      const content = el.getAttribute('content') || el.getAttribute('value');
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }
  return null;
}

/**
 * De-lazy load and promote high-res image sources across any website
 */
function unlazyImages(doc, baseUrl) {
  const images = doc.querySelectorAll('img');
  for (const img of images) {
    // Check for lazy-load attributes
    const candidates = [
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-orig-file'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-actualsrc'),
      img.getAttribute('data-highres'),
      img.getAttribute('data-zoom-src'),
      img.getAttribute('data-url'),
      img.getAttribute('data-full-src')
    ];

    // Check srcset for largest candidate
    const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
    if (srcset) {
      const parts = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
      if (parts.length > 0) {
        candidates.unshift(parts[parts.length - 1]); // largest resolution is usually last
      }
    }

    const currentSrc = (img.getAttribute('src') || '').trim();
    const isPlaceholder = !currentSrc || 
      currentSrc.startsWith('data:image/svg') || 
      currentSrc.startsWith('data:image/gif') ||
      currentSrc.includes('blank.gif') ||
      currentSrc.includes('spacer.gif') ||
      currentSrc.includes('1x1') ||
      currentSrc.includes('placeholder');

    for (const cand of candidates) {
      if (cand && cand.trim() && !cand.startsWith('data:')) {
        try {
          const resolved = new URL(cand.trim(), baseUrl).href;
          img.setAttribute('src', resolved);
          break;
        } catch (e) {}
      }
    }

    // Fallback: If still a placeholder, inspect adjacent <noscript> or <picture>
    if (isPlaceholder && img.parentElement) {
      const noscript = img.parentElement.querySelector('noscript');
      if (noscript) {
        const match = noscript.textContent.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match && match[1] && !match[1].startsWith('data:')) {
          try {
            img.setAttribute('src', new URL(match[1].trim(), baseUrl).href);
          } catch (e) {}
        }
      }

      // Check picture sources
      const pictureSources = img.parentElement.querySelectorAll('source');
      for (const source of pictureSources) {
        const srcCandidate = source.getAttribute('srcset') || source.getAttribute('src');
        if (srcCandidate) {
          const parts = srcCandidate.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
          if (parts.length > 0 && !parts[0].startsWith('data:')) {
            try {
              img.setAttribute('src', new URL(parts[parts.length - 1], baseUrl).href);
              break;
            } catch (e) {}
          }
        }
      }
    }

    // Ensure final src is absolute
    const finalSrc = img.getAttribute('src');
    if (finalSrc && !finalSrc.startsWith('data:')) {
      try {
        img.setAttribute('src', new URL(finalSrc, baseUrl).href);
      } catch (e) {}
    }
  }
}

/**
 * Resolves relative link URLs to absolute URLs
 */
function resolveRelativeUrls(doc, baseUrl) {
  unlazyImages(doc, baseUrl);

  const links = doc.querySelectorAll('a');
  for (const a of links) {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('javascript:')) {
      try {
        a.setAttribute('href', new URL(href, baseUrl).href);
      } catch (e) {}
    }
  }
}

/**
 * Extract Article Schema from JSON-LD microdata
 */
function extractJsonLd(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent);
      const items = Array.isArray(json) ? json : (json['@graph'] || [json]);
      for (const item of items) {
        if (item && (
          item['@type'] === 'Article' || 
          item['@type'] === 'NewsArticle' || 
          item['@type'] === 'BlogPosting' || 
          item['@type'] === 'TechArticle' ||
          item['@type'] === 'Report' ||
          (Array.isArray(item['@type']) && item['@type'].some(t => t.includes('Article') || t.includes('Blog')))
        )) {
          return item;
        }
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Clean platform-specific junk elements (ads, share buttons, popups)
 */
function cleanDomNoise(root) {
  const noiseSelectors = [
    'script', 'style', 'noscript', 'nav', 'footer',
    // Ads & Tracking
    '.advertisement', '.ad-box', '.adsbygoogle', '.google-ad', '.ad-container',
    'ins.adsbygoogle', '.sponsored', '.taboola', '.outbrain', '[id*="google_ads"]',
    // Social & Share
    '.share-box', '.share-buttons', '.social-share', '.post-share', '.sharedaddy',
    '.social-icons', '.social-bar', '.entry-share',
    // Newsletter & Subscriptions
    '.newsletter-signup', '.subscribe-box', '.subscription-widget', '.email-signup',
    '.newsletter-form', '.inline-subscribe',
    // Recommendations & Related
    '.related-posts', '.related-articles', '.more-stories', '.yarpp-related',
    '.jp-relatedposts', '.recommended-posts',
    // Author Bio & Comments (we format author in title page & colophon)
    '.author-bio', '.author-box', '.about-author', '.entry-author-box',
    '.comments', '.comment-list', '.comments-area', '#comments', '.disqus',
    // Banners & Overlays
    '.cookie-banner', '.cookie-consent', '.modal-backdrop', '.popup-overlay',
    // Platform-specific noise
    '.mw-editsection', '.navbox', '.vertical-navbox', '.ambox', '.reflist', '.noprint',
    '.post-shortlink', '.claps', '.meteredContentPrompt'
  ];

  root.querySelectorAll(noiseSelectors.join(', ')).forEach(el => el.remove());
}

/**
 * Convert HTML content to clean, valid XHTML suitable for book packaging
 */
export function sanitizeToXhtml(rawHtml, baseUrl) {
  const sanitized = sanitizeHtml(rawHtml, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'cite',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'strong', 'b', 'em', 'i', 'code', 'pre', 'kbd', 'var', 'samp',
      'strike', 's', 'del', 'u', 'sub', 'sup', 'mark',
      'a', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
      'hr', 'br', 'span', 'section', 'div'
    ],
    allowedAttributes: {
      'a': ['href', 'title', 'id'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      'th': ['colspan', 'rowspan', 'align'],
      'td': ['colspan', 'rowspan', 'align'],
      'pre': ['class'],
      'code': ['class'],
      'span': ['class', 'dir'],
      'p': ['class', 'dir'],
      'div': ['class', 'dir'],
      'section': ['class', 'dir', 'id'],
      'h1': ['id'],
      'h2': ['id'],
      'h3': ['id'],
      'h4': ['id'],
      'blockquote': ['cite'],
      'figure': ['class'],
      'hr': ['class']
    },
    transformTags: {
      'a': (tagName, attribs) => {
        if (attribs.href && !attribs.href.startsWith('#') && !attribs.href.startsWith('mailto:')) {
          try {
            attribs.href = new URL(attribs.href, baseUrl).href;
          } catch (e) {}
        }
        return { tagName: 'a', attribs };
      },
      'img': (tagName, attribs) => {
        const srcCandidate = attribs['data-src'] || attribs['data-original'] || attribs.src;
        if (srcCandidate && !srcCandidate.startsWith('data:')) {
          try {
            attribs.src = new URL(srcCandidate, baseUrl).href;
          } catch (e) {}
        }
        return { tagName: 'img', attribs };
      }
    },
    exclusiveFilter: (frame) => {
      // Remove empty tags that don't add value
      if (['p', 'span'].includes(frame.tag) && !frame.text.trim()) {
        const hasImg = frame.children && frame.children.some(c => c.tag === 'img');
        return !hasImg;
      }
      return false;
    }
  });

  // Use JSDOM to ensure 100% valid XML serialization
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="content">${sanitized}</div></body></html>`);
  const contentEl = dom.window.document.getElementById('content');
  
  // Clean any remaining noise elements
  cleanDomNoise(contentEl);

  // Clean empty links
  const emptyAnchors = contentEl.querySelectorAll('a:empty:not([id])');
  emptyAnchors.forEach(a => a.remove());

  // Remove empty divs
  contentEl.querySelectorAll('div:empty').forEach(d => d.remove());

  return contentEl.innerHTML;
}

/**
 * Main article extraction function with Full-Content Preservation
 * Supports Substack, Medium, Wikipedia, WordPress, News, and custom CMSs
 */
export async function extractArticle(url) {
  const { html, finalUrl } = await fetchArticleHtml(url);
  const dom = new JSDOM(html, { url: finalUrl });
  const doc = dom.window.document;

  // Resolve relative URLs and un-lazy images in the document
  resolveRelativeUrls(doc, finalUrl);

  // Detect RTL (Arabic / Hebrew / Persian / Urdu)
  const isRtl = doc.documentElement.getAttribute('dir') === 'rtl' ||
    (doc.body && doc.body.getAttribute('dir') === 'rtl') ||
    /[\u0600-\u06FF\u0590-\u05FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(doc.title);

  // Extract meta tags before DOM modifications
  const jsonLd = extractJsonLd(doc);

  const ogTitle = getMetaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  const ogAuthor = getMetaContent(doc, [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="twitter:creator"]',
    'meta[property="og:article:author"]'
  ]);
  const ogSiteName = getMetaContent(doc, ['meta[property="og:site_name"]', 'meta[name="application-name"]']);
  const ogDescription = getMetaContent(doc, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]'
  ]);
  const ogImage = getMetaContent(doc, [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]'
  ]);
  const publishedTime = getMetaContent(doc, [
    'meta[property="article:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'meta[name="DC.date.issued"]'
  ]) || (jsonLd && (jsonLd.datePublished || jsonLd.dateCreated));

  // Clean title detection: check H1, JSON-LD, OG, and doc.title
  const h1El = doc.querySelector('h1.entry-title, h1.post-title, article h1, #firstHeading, h1');
  let cleanTitle = (jsonLd && jsonLd.headline) || (h1El ? h1El.textContent.trim() : (ogTitle || doc.title || 'Untitled Article')).trim();
  // Strip trailing " - SiteName" or " | SiteName" if found
  cleanTitle = cleanTitle.replace(/\s+[-|–—]\s+[^-|–—]+$/, '').trim();

  // Find author: check JSON-LD, meta, then DOM
  let byline = '';
  if (jsonLd && jsonLd.author) {
    if (typeof jsonLd.author === 'string') byline = jsonLd.author;
    else if (jsonLd.author.name) byline = jsonLd.author.name;
    else if (Array.isArray(jsonLd.author) && jsonLd.author[0]) {
      byline = typeof jsonLd.author[0] === 'string' ? jsonLd.author[0] : (jsonLd.author[0].name || '');
    }
  }
  if (!byline) {
    byline = ogAuthor || '';
  }
  if (!byline) {
    const authorEl = doc.querySelector('.author, .entry-author, [rel="author"], .byline, .author-name, .post-author');
    if (authorEl) byline = authorEl.textContent.trim();
  }

  // ==================== COMPREHENSIVE CONTAINER CANDIDATE SCORING ====================
  // High-value article containers across major platforms
  const ARTICLE_SELECTORS = [
    // Wikipedia / Fandom / MediaWiki
    '#mw-content-text .mw-parser-output',
    '#mw-content-text',
    // Substack & Medium
    '.available-content',
    '.body.markup',
    '.post-content',
    'article[data-source="post_page"]',
    '.meteredContent',
    // Standard CMS (WordPress, Ghost, Drupal, Squarespace)
    '.entry-content',
    '.post-content',
    '.wp-block-post-content',
    '.single-content',
    '.gh-content',
    '.gh-article',
    // News & Magazines (Microdata & semantic classes)
    '[itemprop="articleBody"]',
    '.article__body',
    '.article-content',
    '.article__content',
    '.story-body',
    '.article-text',
    '.caas-body',
    'article[class*="post"]',
    'article[class*="entry"]',
    'article',
    'main article',
    '#article-body',
    '.crayons-article__main', // Dev.to
    'main'
  ];

  let bestContainer = null;
  let bestContainerTextLength = 0;

  for (const selector of ARTICLE_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el) {
      const clone = el.cloneNode(true);
      cleanDomNoise(clone);

      const len = clone.textContent.trim().length;
      if (len > bestContainerTextLength) {
        bestContainerTextLength = len;
        bestContainer = clone;
      }
    }
  }

  // Run Mozilla Readability on a fresh clone of the document
  const domForReadability = new JSDOM(html, { url: finalUrl });
  resolveRelativeUrls(domForReadability.window.document, finalUrl);
  cleanDomNoise(domForReadability.window.document.body);
  
  const reader = new Readability(domForReadability.window.document, {
    charThreshold: 60,
    keepClasses: true
  });
  const parsed = reader.parse();

  let contentHtml = '';
  let textContent = '';

  const readabilityTextLength = parsed && parsed.textContent ? parsed.textContent.trim().length : 0;

  // Decision Logic:
  // 1. If bestContainer has significantly more content (>10% more), Readability truncated sections/chapters!
  // 2. If Readability produced good content, use Readability
  // 3. Fallback to bestContainer, then JSON-LD, then doc.body
  if (bestContainer && bestContainerTextLength > readabilityTextLength * 1.1) {
    console.log(`[Extractor] Full semantic container selected (${bestContainerTextLength} chars) over Readability (${readabilityTextLength} chars) to guarantee full article.`);
    contentHtml = bestContainer.innerHTML;
    textContent = bestContainer.textContent.trim();
  } else if (parsed && parsed.content) {
    contentHtml = parsed.content;
    textContent = parsed.textContent || '';
  } else if (bestContainer) {
    contentHtml = bestContainer.innerHTML;
    textContent = bestContainer.textContent.trim();
  } else if (jsonLd && jsonLd.articleBody && jsonLd.articleBody.length > 200) {
    console.log(`[Extractor] Microdata JSON-LD articleBody fallback (${jsonLd.articleBody.length} chars).`);
    contentHtml = jsonLd.articleBody.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('');
    textContent = jsonLd.articleBody;
  } else {
    contentHtml = doc.body.innerHTML;
    textContent = doc.body.textContent.trim();
  }

  // ==================== MULTI-PAGE ARTICLE STITCHING ====================
  // Check if article has pagination (e.g. page 2, Next Page)
  try {
    const nextLink = doc.querySelector('link[rel="next"], a.next-page, a.next, .pagination-next a, .nav-next a');
    if (nextLink) {
      const nextHref = nextLink.getAttribute('href');
      if (nextHref) {
        const nextUrl = new URL(nextHref, finalUrl).href;
        // Only follow if on same origin and not self-referential
        if (new URL(nextUrl).origin === new URL(finalUrl).origin && nextUrl !== finalUrl) {
          console.log(`[Extractor] Multi-page article detected! Fetching next page: ${nextUrl}`);
          const nextPageData = await fetchArticleHtml(nextUrl);
          if (nextPageData && nextPageData.html) {
            const nextDom = new JSDOM(nextPageData.html, { url: nextUrl });
            resolveRelativeUrls(nextDom.window.document, nextUrl);
            cleanDomNoise(nextDom.window.document.body);

            const nextReader = new Readability(nextDom.window.document, { charThreshold: 60 });
            const nextParsed = nextReader.parse();
            if (nextParsed && nextParsed.content && nextParsed.textContent.trim().length > 200) {
              contentHtml += `<hr class="ornament-break" /><div class="page-break-divider"></div>` + nextParsed.content;
              textContent += ' ' + nextParsed.textContent.trim();
              console.log(`[Extractor] Stitched next page successfully (+${nextParsed.textContent.trim().length} chars).`);
            }
          }
        }
      }
    }
  } catch (paginationErr) {
    console.warn('[Extractor] Pagination check completed with notice:', paginationErr.message);
  }

  // Sanitize content into clean, valid XHTML suitable for book packaging
  const sanitizedHtml = sanitizeToXhtml(contentHtml, finalUrl);

  // Compute word count and reading time
  const cleanWords = textContent.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const wordCount = cleanWords.length;
  const estimatedReadingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Resolve lead image URL
  let leadImageUrl = null;
  if (ogImage) {
    try {
      leadImageUrl = new URL(ogImage, finalUrl).href;
    } catch (e) {
      leadImageUrl = ogImage;
    }
  }

  if (!leadImageUrl && jsonLd && jsonLd.image) {
    const imgObj = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
    leadImageUrl = typeof imgObj === 'string' ? imgObj : (imgObj.url || null);
  }

  if (!leadImageUrl) {
    const match = sanitizedHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && match[1]) {
      leadImageUrl = match[1];
    }
  }

  const siteName = ogSiteName || new URL(finalUrl).hostname.replace(/^www\./, '');

  return {
    url: finalUrl,
    title: cleanTitle || 'Untitled Article',
    author: byline.trim(),
    siteName: siteName.trim(),
    publishedTime: publishedTime || new Date().toISOString().split('T')[0],
    excerpt: (ogDescription || '').trim(),
    leadImageUrl,
    wordCount,
    estimatedReadingTime,
    isRtl,
    htmlContent: sanitizedHtml,
    textContent: textContent.slice(0, 500)
  };
}
