import { api } from './api.js';
import { showToast, setPipelineStep, renderCoverSvg, escapeHtml } from './ui.js';
import { epubPlayer } from './epubPlayer.js';
import { icon } from './icons.js';

// Application State
const state = {
  activeTab: 'convert',
  theme: localStorage.getItem('readcast_theme') || 'dark',
  currentArticle: null,
  activeCoverStyle: 'modern',
  includeImages: true,
  bundleQueue: [],
  libraryItems: []
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initConvertForm();
  initPreviewModal();
  initBatchBundler();
  initKindleTab();
  initSettingsTab();
  loadStats();
});

// Theme Management
function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.innerHTML = state.theme === 'light' ? icon('moon') : icon('sun');
    themeBtn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      localStorage.setItem('readcast_theme', state.theme);
      themeBtn.innerHTML = state.theme === 'light' ? icon('moon') : icon('sun');
      showToast(`Switched to ${state.theme} mode`, 'info');
    });
  }
}

// Tab Navigation
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-view').forEach(v => {
    v.classList.toggle('active', v.id === `tab-${tabId}`);
  });

  if (tabId === 'library') {
    loadLibrary();
  } else if (tabId === 'settings') {
    loadStats();
  }
}

// Convert Form (Quick Convert & Preview)
function initConvertForm() {
  const urlInput = document.getElementById('article-url-input');
  const quickConvertBtn = document.getElementById('quick-convert-btn');
  const previewBtn = document.getElementById('preview-edit-btn');
  const pasteBtn = document.getElementById('paste-clipboard-btn');
  const sampleChips = document.querySelectorAll('.chip');

  // Paste from clipboard helper
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.startsWith('http')) {
          urlInput.value = text;
          showToast('Pasted URL from clipboard', 'info');
        } else {
          showToast('Clipboard does not contain a valid URL', 'error');
        }
      } catch (e) {
        showToast('Please allow clipboard access or paste directly', 'error');
      }
    });
  }

  // Sample URL chips for instant testing
  sampleChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.getAttribute('data-url');
      if (url) {
        urlInput.value = url;
        showToast(`Selected sample: ${chip.textContent.trim()}`, 'info');
      }
    });
  });

  // 1-Click Quick Convert & Download
  quickConvertBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showToast('Please enter an article URL first', 'error');
      urlInput.focus();
      return;
    }

    try {
      quickConvertBtn.disabled = true;
      quickConvertBtn.innerHTML = `${icon('clock')} Converting...`;
      
      // Animate pipeline
      setPipelineStep(1); // Fetching
      await new Promise(r => setTimeout(r, 400));
      
      setPipelineStep(2); // Extracting
      const article = await api.extractArticle(url);
      
      setPipelineStep(3); // Packaging
      const result = await api.convertArticle({
        url: article.url,
        title: article.title,
        author: article.author,
        siteName: article.siteName,
        coverStyle: state.activeCoverStyle,
        includeImages: state.includeImages,
        htmlContent: article.htmlContent,
        leadImageUrl: article.leadImageUrl,
        wordCount: article.wordCount,
        estimatedReadingTime: article.estimatedReadingTime
      });

      setPipelineStep(4); // Ready
      showToast('EPUB generated! Download starting...', 'success');

      // Trigger instant download (client-side blob or server streaming)
      downloadEpubResult(result);

      setTimeout(() => {
        setPipelineStep(0); // Reset
      }, 3000);
    } catch (err) {
      setPipelineStep(0);
      showToast(err.message || 'Failed to convert article', 'error');
    } finally {
      quickConvertBtn.disabled = false;
      quickConvertBtn.innerHTML = `${icon('convert')} Quick Convert`;
    }
  });

  // Preview & Edit Button
  previewBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showToast('Please enter an article URL first', 'error');
      urlInput.focus();
      return;
    }

    try {
      previewBtn.disabled = true;
      previewBtn.innerHTML = `${icon('clock')} Extracting...`;
      setPipelineStep(1);

      const article = await api.extractArticle(url);
      setPipelineStep(2);

      openPreviewModal(article);
      setPipelineStep(0);
    } catch (err) {
      setPipelineStep(0);
      showToast(err.message || 'Failed to extract article content', 'error');
    } finally {
      previewBtn.disabled = false;
      previewBtn.innerHTML = `${icon('edit')} Preview &amp; Edit`;
    }
  });
}

// Split-Pane Reader Preview Modal
function initPreviewModal() {
  const modal = document.getElementById('preview-modal-overlay');
  const closeBtn = document.getElementById('close-preview-modal');
  const titleInput = document.getElementById('modal-edit-title');
  const authorInput = document.getElementById('modal-edit-author');
  const siteInput = document.getElementById('modal-edit-site');
  const imagesToggle = document.getElementById('modal-toggle-images');
  const themeSwatches = document.querySelectorAll('.theme-swatch');
  const downloadBtn = document.getElementById('modal-download-btn');
  const kindleBtn = document.getElementById('modal-kindle-btn');
  const qrBtn = document.getElementById('modal-qr-btn');

  // Close modal
  closeBtn.addEventListener('click', () => modal.classList.remove('active'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  // Live update cover on keystrokes
  [titleInput, authorInput, siteInput].forEach(inp => {
    inp.addEventListener('input', updateLiveCoverPreview);
  });

  // Images toggle
  imagesToggle.addEventListener('change', (e) => {
    state.includeImages = e.target.checked;
    const bodyImages = document.querySelectorAll('#modal-reader-body img, #modal-reader-body figure');
    bodyImages.forEach(img => {
      img.style.display = state.includeImages ? '' : 'none';
    });
  });

  // Cover Theme Swatches
  themeSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      themeSwatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      state.activeCoverStyle = swatch.getAttribute('data-theme-style');
      updateLiveCoverPreview();
    });
  });

  // Modal Download Button
  downloadBtn.addEventListener('click', async () => {
    if (!state.currentArticle) return;
    try {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = `${icon('clock')} Packaging EPUB...`;

      const result = await api.convertArticle({
        url: state.currentArticle.url,
        title: titleInput.value.trim() || state.currentArticle.title,
        author: authorInput.value.trim() || state.currentArticle.author,
        siteName: siteInput.value.trim() || state.currentArticle.siteName,
        coverStyle: state.activeCoverStyle,
        includeImages: state.includeImages,
        htmlContent: state.currentArticle.htmlContent,
        leadImageUrl: state.currentArticle.leadImageUrl,
        wordCount: state.currentArticle.wordCount,
        estimatedReadingTime: state.currentArticle.estimatedReadingTime
      });

      state.currentArticle.lastEpubId = result.epub.id;
      showToast('EPUB generated! Download started.', 'success');
      downloadEpubResult(result);
    } catch (err) {
      showToast(err.message || 'Conversion failed', 'error');
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = `${icon('download')} Download .epub`;
    }
  });

  // Modal Kindle Button
  kindleBtn.addEventListener('click', async () => {
    if (!state.currentArticle) return;
    const email = prompt('Enter your Kindle email address (@kindle.com):', localStorage.getItem('readcast_kindle_email') || '');
    if (!email) return;

    localStorage.setItem('readcast_kindle_email', email);
    try {
      kindleBtn.disabled = true;
      kindleBtn.innerHTML = `${icon('clock')} Sending...`;

      // Ensure EPUB is built first
      let epubId = state.currentArticle.lastEpubId;
      if (!epubId) {
        const result = await api.convertArticle({
          url: state.currentArticle.url,
          title: titleInput.value.trim() || state.currentArticle.title,
          author: authorInput.value.trim() || state.currentArticle.author,
          siteName: siteInput.value.trim() || state.currentArticle.siteName,
          coverStyle: state.activeCoverStyle,
          includeImages: state.includeImages,
          htmlContent: state.currentArticle.htmlContent,
          leadImageUrl: state.currentArticle.leadImageUrl,
          wordCount: state.currentArticle.wordCount,
          estimatedReadingTime: state.currentArticle.estimatedReadingTime
        });
        epubId = result.epub.id;
        state.currentArticle.lastEpubId = epubId;
      }

      const sendRes = await api.sendToKindle(epubId, email);
      showToast(sendRes.message, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to send to Kindle', 'error');
    } finally {
      kindleBtn.disabled = false;
      kindleBtn.innerHTML = `${icon('mail')} Send to Kindle`;
    }
  });

  // Modal Play Button
  const modalPlayBtn = document.getElementById('modal-play-btn');
  if (modalPlayBtn) {
    modalPlayBtn.addEventListener('click', async () => {
      if (!state.currentArticle) return;
      try {
        modalPlayBtn.disabled = true;
        modalPlayBtn.innerHTML = `${icon('clock')} Loading...`;

        let epubId = state.currentArticle.lastEpubId;
        if (!epubId) {
          const result = await api.convertArticle({
            url: state.currentArticle.url,
            title: titleInput.value.trim() || state.currentArticle.title,
            author: authorInput.value.trim() || state.currentArticle.author,
            siteName: siteInput.value.trim() || state.currentArticle.siteName,
            coverStyle: state.activeCoverStyle,
            includeImages: state.includeImages,
            htmlContent: state.currentArticle.htmlContent,
            leadImageUrl: state.currentArticle.leadImageUrl,
            wordCount: state.currentArticle.wordCount,
            estimatedReadingTime: state.currentArticle.estimatedReadingTime
          });
          epubId = result.epub.id;
          state.currentArticle.lastEpubId = epubId;
        }

        modal.classList.remove('active');
        epubPlayer.openWithEpubId(epubId);
      } catch (err) {
        showToast(err.message || 'Could not launch player', 'error');
      } finally {
        modalPlayBtn.disabled = false;
        modalPlayBtn.innerHTML = `${icon('play')} Read in Player`;
      }
    });
  }

  // Modal Mobile QR Button
  qrBtn.addEventListener('click', async () => {
    if (!state.currentArticle) return;
    try {
      qrBtn.disabled = true;
      let epubId = state.currentArticle.lastEpubId;
      if (!epubId) {
        const result = await api.convertArticle({
          url: state.currentArticle.url,
          title: titleInput.value.trim() || state.currentArticle.title,
          author: authorInput.value.trim() || state.currentArticle.author,
          siteName: siteInput.value.trim() || state.currentArticle.siteName,
          coverStyle: state.activeCoverStyle,
          includeImages: state.includeImages,
          htmlContent: state.currentArticle.htmlContent,
          leadImageUrl: state.currentArticle.leadImageUrl,
          wordCount: state.currentArticle.wordCount,
          estimatedReadingTime: state.currentArticle.estimatedReadingTime
        });
        epubId = result.epub.id;
        state.currentArticle.lastEpubId = epubId;
      }
      openQrModal(epubId);
    } catch (err) {
      showToast(err.message || 'Could not generate QR', 'error');
    } finally {
      qrBtn.disabled = false;
    }
  });
}

function openPreviewModal(article) {
  state.currentArticle = article;
  const modal = document.getElementById('preview-modal-overlay');
  const titleInput = document.getElementById('modal-edit-title');
  const authorInput = document.getElementById('modal-edit-author');
  const siteInput = document.getElementById('modal-edit-site');
  const readerTitle = document.getElementById('modal-reader-title');
  const readerBody = document.getElementById('modal-reader-body');
  const readingTimePill = document.getElementById('modal-reading-time');
  const wordCountPill = document.getElementById('modal-word-count');

  titleInput.value = article.title || '';
  authorInput.value = article.author || '';
  siteInput.value = article.siteName || '';
  readerTitle.textContent = article.title || '';
  readingTimePill.innerHTML = `${icon('clock', 'flat-icon-sm')} <span>${article.estimatedReadingTime || 5} min read</span>`;
  wordCountPill.innerHTML = `${icon('words', 'flat-icon-sm')} <span>${(article.wordCount || 0).toLocaleString()} words</span>`;

  readerBody.innerHTML = article.htmlContent || '<p>No content extracted.</p>';

  if (article.isRtl) {
    readerTitle.setAttribute('dir', 'rtl');
    readerBody.setAttribute('dir', 'rtl');
  } else {
    readerTitle.removeAttribute('dir');
    readerBody.removeAttribute('dir');
  }

  updateLiveCoverPreview();
  modal.classList.add('active');
}

function updateLiveCoverPreview() {
  const container = document.getElementById('live-cover-container');
  const titleInput = document.getElementById('modal-edit-title');
  const authorInput = document.getElementById('modal-edit-author');
  const siteInput = document.getElementById('modal-edit-site');

  const svg = renderCoverSvg({
    title: titleInput.value.trim() || (state.currentArticle && state.currentArticle.title) || 'Untitled Article',
    author: authorInput.value.trim() || (state.currentArticle && state.currentArticle.author) || 'Author',
    siteName: siteInput.value.trim() || (state.currentArticle && state.currentArticle.siteName) || 'Web Source',
    date: (state.currentArticle && state.currentArticle.publishedTime) || new Date().toISOString().split('T')[0],
    coverStyle: state.activeCoverStyle,
    readingTime: (state.currentArticle && state.currentArticle.estimatedReadingTime) || 5
  });

  container.innerHTML = svg;
}

// Batch Bundler Tab
function initBatchBundler() {
  const addBtn = document.getElementById('bundle-add-btn');
  const urlInput = document.getElementById('bundle-url-input');
  const queueList = document.getElementById('bundle-queue-list');
  const buildBtn = document.getElementById('bundle-build-btn');
  const bundleTitleInput = document.getElementById('bundle-title-input');
  const bundleAuthorInput = document.getElementById('bundle-author-input');
  const emptyQueueMsg = document.getElementById('bundle-empty-msg');

  addBtn.addEventListener('click', async () => {
    const raw = urlInput.value.trim();
    if (!raw) return;

    // Support multiple URLs separated by newline or space
    const urls = raw.split(/[\s,]+/).filter(u => u.startsWith('http'));
    if (urls.length === 0) {
      showToast('Please enter valid HTTP or HTTPS URLs', 'error');
      return;
    }

    urlInput.value = '';
    for (const u of urls) {
      state.bundleQueue.push({ url: u, title: 'Fetching metadata...' });
    }
    renderBundleQueue();

    // Fetch titles asynchronously in background
    for (let i = 0; i < state.bundleQueue.length; i++) {
      const item = state.bundleQueue[i];
      if (item.title === 'Fetching metadata...') {
        try {
          const extracted = await api.extractArticle(item.url);
          state.bundleQueue[i] = extracted;
          renderBundleQueue();
        } catch (e) {
          state.bundleQueue[i].title = item.url;
          renderBundleQueue();
        }
      }
    }
  });

  buildBtn.addEventListener('click', async () => {
    if (state.bundleQueue.length === 0) return;

    try {
      buildBtn.disabled = true;
      buildBtn.innerHTML = `${icon('clock')} Assembling EPUB Digest...`;

      const bundleTitle = bundleTitleInput.value.trim() || 'Digest Anthology';
      const bundleAuthor = bundleAuthorInput.value.trim() || 'Curated with ReadCast';

      const res = await api.createBundle({
        title: bundleTitle,
        author: bundleAuthor,
        urls: state.bundleQueue.map(item => item.url),
        coverStyle: state.activeCoverStyle
      });

      showToast('Digest compiled successfully!', 'success');
      downloadEpubResult(res);
      state.bundleQueue = [];
      renderBundleQueue();
    } catch (err) {
      showToast(err.message || 'Failed to create bundle', 'error');
    } finally {
      buildBtn.disabled = false;
      buildBtn.innerHTML = `${icon('bundler')} Generate Multi-Chapter Digest`;
    }
  });

  function renderBundleQueue() {
    queueList.innerHTML = '';
    if (state.bundleQueue.length === 0) {
      emptyQueueMsg.style.display = 'block';
      buildBtn.disabled = true;
      return;
    }

    emptyQueueMsg.style.display = 'none';
    buildBtn.disabled = false;

    state.bundleQueue.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'bundle-item';
      li.innerHTML = `
        <div class="bundle-item-info">
          <span class="bundle-num">#${idx + 1}</span>
          <div>
            <div class="bundle-item-title">${escapeHtml(item.title || item.url)}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(item.siteName || item.url)}</div>
          </div>
        </div>
        <button class="icon-btn btn-sm" title="Remove" data-index="${idx}">
          ${icon('close', 'flat-icon-sm')}
        </button>
      `;

      li.querySelector('button').addEventListener('click', () => {
        state.bundleQueue.splice(idx, 1);
        renderBundleQueue();
      });

      queueList.appendChild(li);
    });
  }
}

// Bookshelf Library Tab
async function loadLibrary() {
  const grid = document.getElementById('library-grid');
  const searchInput = document.getElementById('library-search-input');
  grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">${icon('clock')} Loading bookshelf...</div>`;

  try {
    const res = await api.getLibrary({ search: searchInput ? searchInput.value.trim() : '' });
    state.libraryItems = res.items || [];
    renderLibraryGrid();
  } catch (err) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--accent-danger);">Failed to load library: ${err.message}</div>`;
  }

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', debounce(() => loadLibrary(), 300));
  }

  // Bind upload custom EPUB file
  const uploadTrigger = document.getElementById('upload-epub-trigger');
  const uploadInput = document.getElementById('upload-epub-input');
  if (uploadTrigger && uploadInput && !uploadTrigger.dataset.bound) {
    uploadTrigger.dataset.bound = 'true';
    uploadTrigger.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        epubPlayer.openWithFile(file);
        uploadInput.value = '';
      }
    });
  }
}

function renderLibraryGrid() {
  const grid = document.getElementById('library-grid');
  grid.innerHTML = '';

  if (state.libraryItems.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: var(--text-secondary);">
        <div style="margin-bottom: 1rem; color: var(--text-muted);">${icon('library', 'flat-icon-lg')}</div>
        <h3 style="margin-bottom: 0.5rem; font-family: var(--font-serif); font-size: 1.4rem;">Your Bookshelf is Empty</h3>
        <p style="margin-bottom: 1.5rem; color: var(--text-muted);">Articles you convert will be permanently saved here for quick re-downloads and Kindle sync.</p>
        <button class="btn btn-primary" onclick="document.querySelector('[data-tab=convert]').click()">${icon('convert')} Convert Your First Article</button>
      </div>
    `;
    return;
  }

  state.libraryItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'epub-card';

    // Generate SVG thumbnail
    const coverSvg = renderCoverSvg({
      title: item.title,
      author: item.author,
      siteName: item.siteName,
      date: (item.createdAt || '').split('T')[0],
      coverStyle: item.coverStyle || 'modern',
      readingTime: item.readingTime || 5
    });

    const isBundle = item.isBundle;
    const sizeKb = Math.round((item.fileSize || 0) / 1024);

    card.innerHTML = `
      <div class="epub-card-cover">${coverSvg}</div>
      <div class="epub-card-content">
        <h4 class="epub-card-title">${escapeHtml(item.title)}</h4>
        <div class="epub-card-author">${escapeHtml(item.author || item.siteName || 'Unknown')}</div>
        <div class="epub-card-stats">
          <span>${icon('clock', 'flat-icon-sm')} ${item.readingTime || 5}m</span>
          <span>${icon('words', 'flat-icon-sm')} ${sizeKb} KB</span>
          ${isBundle ? `<span style="color: var(--accent-secondary); font-weight: 600;">${icon('bundler', 'flat-icon-sm')} ${item.chaptersCount || 1} Chapters</span>` : ''}
        </div>
        <div class="epub-card-actions">
          <button class="btn btn-primary btn-sm play-trigger" title="Read in Browser">${icon('play', 'flat-icon-sm')} Read</button>
          <a href="/api/download/${item.id}" class="icon-btn btn-sm" title="Download EPUB">${icon('download', 'flat-icon-sm')}</a>
          <button class="icon-btn btn-sm qr-trigger" title="Mobile QR Code">${icon('qr', 'flat-icon-sm')}</button>
          <button class="icon-btn btn-sm kindle-trigger" title="Send to Kindle">${icon('mail', 'flat-icon-sm')}</button>
          <button class="icon-btn btn-sm delete-trigger" title="Delete">${icon('trash', 'flat-icon-sm')}</button>
        </div>
      </div>
    `;

    // Event triggers
    card.querySelector('.play-trigger').addEventListener('click', () => epubPlayer.openWithEpubId(item.id));
    card.querySelector('.qr-trigger').addEventListener('click', () => openQrModal(item.id));
    card.querySelector('.kindle-trigger').addEventListener('click', async () => {
      const email = prompt('Send to Kindle email:', localStorage.getItem('readcast_kindle_email') || '');
      if (email) {
        localStorage.setItem('readcast_kindle_email', email);
        try {
          const res = await api.sendToKindle(item.id, email);
          showToast(res.message, 'success');
        } catch (e) {
          showToast(e.message, 'error');
        }
      }
    });
    card.querySelector('.delete-trigger').addEventListener('click', async () => {
      if (confirm(`Delete "${item.title}" from your library?`)) {
        try {
          await api.deleteFromLibrary(item.id);
          showToast('Removed from library', 'info');
          loadLibrary();
        } catch (e) {
          showToast(e.message, 'error');
        }
      }
    });

    grid.appendChild(card);
  });
}

// QR Code Modal
async function openQrModal(epubId) {
  const modal = document.getElementById('qr-modal-overlay');
  const img = document.getElementById('qr-code-img');
  const link = document.getElementById('qr-download-link');

  try {
    const data = await api.getQrCode(epubId);
    img.src = data.qrDataUrl;
    link.href = data.downloadUrl;
    link.textContent = 'Or click to download directly';
    modal.classList.add('active');
  } catch (err) {
    showToast('Failed to load QR code', 'error');
  }

  const closeBtn = document.getElementById('close-qr-modal');
  closeBtn.onclick = () => modal.classList.remove('active');
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.remove('active');
  };
}

// Kindle Tab
function initKindleTab() {
  const saveBtn = document.getElementById('save-kindle-settings-btn');
  const kindleEmailInput = document.getElementById('kindle-email-input');
  const smtpHostInput = document.getElementById('smtp-host-input');
  const smtpUserInput = document.getElementById('smtp-user-input');
  const smtpPassInput = document.getElementById('smtp-pass-input');

  api.getSettings().then(settings => {
    if (settings) {
      if (kindleEmailInput) kindleEmailInput.value = settings.kindleEmail || '';
      if (smtpHostInput) smtpHostInput.value = settings.smtpHost || '';
      if (smtpUserInput) smtpUserInput.value = settings.smtpUser || '';
      if (smtpPassInput) smtpPassInput.value = settings.smtpPass || '';
    }
  });

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        saveBtn.disabled = true;
        await api.updateSettings({
          kindleEmail: kindleEmailInput.value.trim(),
          smtpHost: smtpHostInput.value.trim(),
          smtpUser: smtpUserInput.value.trim(),
          smtpPass: smtpPassInput.value.trim()
        });
        showToast('Kindle settings saved successfully!', 'success');
      } catch (e) {
        showToast('Could not save settings', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

// Settings & Stats
function initSettingsTab() {
  const defaultThemeSelect = document.getElementById('setting-default-theme');
  if (defaultThemeSelect) {
    defaultThemeSelect.value = state.activeCoverStyle;
    defaultThemeSelect.addEventListener('change', (e) => {
      state.activeCoverStyle = e.target.value;
      showToast(`Default cover style set to: ${state.activeCoverStyle}`, 'info');
    });
  }
}

async function loadStats() {
  try {
    const stats = await api.getStats();
    const statConversions = document.getElementById('stat-conversions');
    const statWords = document.getElementById('stat-words');
    const statKindle = document.getElementById('stat-kindle');

    if (statConversions) statConversions.textContent = stats.totalConversions || 0;
    if (statWords) statWords.textContent = (stats.totalWords || 0).toLocaleString();
    if (statKindle) statKindle.textContent = stats.kindleDeliveries || 0;
  } catch (e) {
    // Silent fail
  }
}

// Helper: Instant download trigger (supports client-side in-memory Blob or server stream)
function downloadEpubResult(result) {
  if (!result) return;
  const filename = (result.epub && result.epub.filename) || 'article.epub';

  if (result.epubBase64) {
    try {
      const binaryString = atob(result.epubBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/epub+zip' });
      const blobUrl = URL.createObjectURL(blob);
      triggerDownload(blobUrl, filename);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      return;
    } catch (e) {
      console.warn('In-memory Blob download fallback to URL:', e);
    }
  }

  if (result.downloadUrl) {
    triggerDownload(result.downloadUrl, filename);
  }
}

// Helper: Instant download trigger
function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'article.epub';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Helper: Debounce
function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}
