import { showToast, escapeHtml } from './ui.js';
import { icon } from './icons.js';

class EpubPlayer {
  constructor() {
    this.book = null;
    this.currentChapterIndex = 0;
    this.fontSize = parseInt(localStorage.getItem('readcast_player_fontsize') || '18', 10);
    this.theme = localStorage.getItem('readcast_player_theme') || 'dark';
    this.fontFamily = localStorage.getItem('readcast_player_font') || 'serif';
    this.playbackRate = parseFloat(localStorage.getItem('readcast_player_rate') || '1.0');
    
    // Audio / Speech Synthesis state
    this.isPlayingAudio = false;
    this.currentParagraphIndex = 0;
    this.paragraphs = [];
    this.speechUtterance = null;

    this.initElements();
    this.initEvents();
  }

  initElements() {
    this.overlay = document.getElementById('epub-player-overlay');
    this.titleEl = document.getElementById('player-book-title');
    this.authorEl = document.getElementById('player-book-author');
    this.contentEl = document.getElementById('player-content-body');
    this.tocSelect = document.getElementById('player-toc-select');
    this.prevBtn = document.getElementById('player-prev-btn');
    this.nextBtn = document.getElementById('player-next-btn');
    this.closeBtn = document.getElementById('player-close-btn');
    this.progressBar = document.getElementById('player-progress-bar');
    this.chapterInfoEl = document.getElementById('player-chapter-info');
    
    // Audio elements
    this.playAudioBtn = document.getElementById('player-audio-toggle');
    this.stopAudioBtn = document.getElementById('player-audio-stop');
    this.speedSelect = document.getElementById('player-audio-speed');
    this.audioStatusEl = document.getElementById('player-audio-status');

    // Customization elements
    this.fontMinusBtn = document.getElementById('player-font-minus');
    this.fontPlusBtn = document.getElementById('player-font-plus');
    this.fontFamilySelect = document.getElementById('player-font-family');
    this.themeBtns = document.querySelectorAll('.player-theme-btn');
  }

  initEvents() {
    // Navigation
    if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.prevChapter());
    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.nextChapter());
    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());

    // TOC dropdown
    if (this.tocSelect) {
      this.tocSelect.addEventListener('change', (e) => {
        this.goToChapter(parseInt(e.target.value, 10));
      });
    }

    // Font Controls
    if (this.fontMinusBtn) {
      this.fontMinusBtn.addEventListener('click', () => {
        this.fontSize = Math.max(13, this.fontSize - 1);
        this.applyStyling();
      });
    }
    if (this.fontPlusBtn) {
      this.fontPlusBtn.addEventListener('click', () => {
        this.fontSize = Math.min(32, this.fontSize + 1);
        this.applyStyling();
      });
    }

    if (this.fontFamilySelect) {
      this.fontFamilySelect.value = this.fontFamily;
      this.fontFamilySelect.addEventListener('change', (e) => {
        this.fontFamily = e.target.value;
        this.applyStyling();
      });
    }

    // Themes
    this.themeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme');
        this.setTheme(theme);
      });
    });

    // Audio / Speech
    if (this.playAudioBtn) {
      this.playAudioBtn.addEventListener('click', () => this.toggleAudioPlayback());
    }
    if (this.stopAudioBtn) {
      this.stopAudioBtn.addEventListener('click', () => this.stopAudio());
    }
    if (this.speedSelect) {
      this.speedSelect.value = this.playbackRate.toString();
      this.speedSelect.addEventListener('change', (e) => {
        this.playbackRate = parseFloat(e.target.value);
        localStorage.setItem('readcast_player_rate', this.playbackRate.toString());
        if (this.isPlayingAudio) {
          this.speakCurrentParagraph(); // restart current paragraph with new speed
        }
      });
    }

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (!this.overlay.classList.contains('active')) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        this.nextChapter();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.prevChapter();
      } else if (e.key === 'Escape') {
        this.close();
      } else if (e.key.toLowerCase() === 'p') {
        this.toggleAudioPlayback();
      }
    });
  }

  async openWithEpubId(id) {
    try {
      showToast('Opening EPUB Player...', 'info');
      const res = await fetch(`/api/read/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to read EPUB');

      this.loadBook(data.book);
    } catch (err) {
      showToast(err.message || 'Could not open book in player', 'error');
    }
  }

  async openWithFile(file) {
    try {
      showToast(`Loading ${file.name}...`, 'info');
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result;
          const res = await fetch('/api/read/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Data, filename: file.name })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to parse file');

          this.loadBook(data.book);
        } catch (e) {
          showToast(e.message || 'Could not parse uploaded EPUB', 'error');
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      showToast(err.message || 'File read error', 'error');
    }
  }

  loadBook(bookData) {
    this.book = bookData;
    this.currentChapterIndex = 0;
    this.stopAudio();

    if (this.titleEl) this.titleEl.textContent = bookData.title || 'Untitled Book';
    if (this.authorEl) this.authorEl.textContent = bookData.author || '';

    // Populate TOC dropdown
    if (this.tocSelect) {
      this.tocSelect.innerHTML = '';
      bookData.chapters.forEach((ch, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${idx + 1}. ${ch.title}`;
        this.tocSelect.appendChild(opt);
      });
    }

    this.applyStyling();
    this.renderChapter();
    this.overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // lock background scrolling
  }

  renderChapter() {
    if (!this.book || !this.book.chapters || this.book.chapters.length === 0) {
      this.contentEl.innerHTML = '<p>No content found in this EPUB.</p>';
      return;
    }

    const chapter = this.book.chapters[this.currentChapterIndex];
    if (this.tocSelect) this.tocSelect.value = this.currentChapterIndex;

    // Render HTML inside reader container
    this.contentEl.innerHTML = `
      <div class="player-chapter-header">
        <h2 class="player-chapter-title">${escapeHtml(chapter.title)}</h2>
        <div class="player-chapter-meta">
          <span>📖 Chapter ${this.currentChapterIndex + 1} of ${this.book.chapters.length}</span>
          ${chapter.wordCount ? `<span>📝 ${chapter.wordCount.toLocaleString()} words</span>` : ''}
        </div>
      </div>
      <div class="player-chapter-text" id="player-chapter-text">
        ${chapter.html}
      </div>
    `;

    // Set RTL direction if Arabic or Hebrew
    const isRtl = this.book.language === 'ar' || /[\u0600-\u06FF]/.test((this.book.title || '') + ' ' + (chapter.title || ''));
    if (isRtl) {
      this.contentEl.setAttribute('dir', 'rtl');
    } else {
      this.contentEl.removeAttribute('dir');
    }

    // Scroll to top of reading pane
    this.contentEl.scrollTop = 0;

    // Extract paragraphs for speech synthesis
    this.prepareAudioParagraphs();

    // Update progress bar & footer info
    const progress = Math.round(((this.currentChapterIndex + 1) / this.book.chapters.length) * 100);
    if (this.progressBar) this.progressBar.style.width = `${progress}%`;
    if (this.chapterInfoEl) {
      this.chapterInfoEl.textContent = `Chapter ${this.currentChapterIndex + 1} of ${this.book.chapters.length} (${progress}%)`;
    }

    // Enable/disable navigation buttons
    if (this.prevBtn) this.prevBtn.disabled = this.currentChapterIndex <= 0;
    if (this.nextBtn) this.nextBtn.disabled = this.currentChapterIndex >= this.book.chapters.length - 1;
  }

  nextChapter() {
    if (this.book && this.currentChapterIndex < this.book.chapters.length - 1) {
      this.stopAudio();
      this.currentChapterIndex++;
      this.renderChapter();
    } else {
      showToast('You have reached the end of the book! 🏁', 'info');
    }
  }

  prevChapter() {
    if (this.book && this.currentChapterIndex > 0) {
      this.stopAudio();
      this.currentChapterIndex--;
      this.renderChapter();
    }
  }

  goToChapter(index) {
    if (this.book && index >= 0 && index < this.book.chapters.length) {
      this.stopAudio();
      this.currentChapterIndex = index;
      this.renderChapter();
    }
  }

  applyStyling() {
    localStorage.setItem('readcast_player_fontsize', this.fontSize.toString());
    localStorage.setItem('readcast_player_font', this.fontFamily);
    localStorage.setItem('readcast_player_theme', this.theme);

    if (this.contentEl) {
      this.contentEl.style.fontSize = `${this.fontSize}px`;

      let font = 'var(--font-serif)';
      if (this.fontFamily === 'sans') font = 'var(--font-sans)';
      else if (this.fontFamily === 'mono') font = 'var(--font-mono)';
      this.contentEl.style.fontFamily = font;
    }

    // Apply Theme Attribute to modal
    if (this.overlay) {
      this.overlay.setAttribute('data-reader-theme', this.theme);
    }

    this.themeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-theme') === this.theme);
    });
  }

  setTheme(themeName) {
    this.theme = themeName;
    this.applyStyling();
  }

  // ==================== Text-To-Speech (Audiobook Player) ====================
  prepareAudioParagraphs() {
    const textContainer = document.getElementById('player-chapter-text');
    if (!textContainer) {
      this.paragraphs = [];
      return;
    }

    // Collect all paragraph elements, headings, and blockquotes
    const blockEls = textContainer.querySelectorAll('p, h1, h2, h3, h4, blockquote, li');
    this.paragraphs = [];

    blockEls.forEach((el, idx) => {
      const text = el.textContent.trim();
      if (text.length > 3) {
        el.setAttribute('data-para-idx', this.paragraphs.length);
        this.paragraphs.push({ el, text });
      }
    });

    this.currentParagraphIndex = 0;
    this.updateAudioStatus();
  }

  toggleAudioPlayback() {
    if (!('speechSynthesis' in window)) {
      showToast('Text-to-speech is not supported by your browser', 'error');
      return;
    }

    if (this.isPlayingAudio) {
      this.pauseAudio();
    } else {
      this.playAudio();
    }
  }

  playAudio() {
    if (this.paragraphs.length === 0) {
      showToast('No readable text in this chapter', 'info');
      return;
    }

    this.isPlayingAudio = true;
    if (this.playAudioBtn) this.playAudioBtn.innerHTML = `${icon('pause', 'flat-icon-sm')} <span>Pause</span>`;
    this.speakCurrentParagraph();
  }

  pauseAudio() {
    this.isPlayingAudio = false;
    window.speechSynthesis.cancel();
    if (this.playAudioBtn) this.playAudioBtn.innerHTML = `${icon('play', 'flat-icon-sm')} <span>Listen</span>`;
    this.updateAudioStatus('Paused');
  }

  stopAudio() {
    this.isPlayingAudio = false;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.currentParagraphIndex = 0;
    this.clearAudioHighlights();
    if (this.playAudioBtn) this.playAudioBtn.innerHTML = `${icon('play', 'flat-icon-sm')} <span>Listen</span>`;
    this.updateAudioStatus('Ready');
  }

  speakCurrentParagraph() {
    if (!this.isPlayingAudio) return;
    if (this.currentParagraphIndex >= this.paragraphs.length) {
      // Finished chapter, advance to next chapter automatically if available!
      if (this.currentChapterIndex < this.book.chapters.length - 1) {
        showToast('Advancing to next chapter audio...', 'info');
        this.nextChapter();
        setTimeout(() => this.playAudio(), 500);
      } else {
        this.stopAudio();
        showToast('Finished reading chapter!', 'success');
      }
      return;
    }

    window.speechSynthesis.cancel();
    const current = this.paragraphs[this.currentParagraphIndex];
    this.highlightParagraph(current.el);

    const utterance = new SpeechSynthesisUtterance(current.text);
    utterance.rate = this.playbackRate;
    utterance.lang = this.book.language || 'en-US';

    utterance.onend = () => {
      if (this.isPlayingAudio) {
        this.currentParagraphIndex++;
        this.speakCurrentParagraph();
      }
    };

    utterance.onerror = (e) => {
      console.warn('Speech error:', e);
      if (this.isPlayingAudio) {
        this.currentParagraphIndex++;
        this.speakCurrentParagraph();
      }
    };

    this.speechUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    this.updateAudioStatus(`Reading block ${this.currentParagraphIndex + 1}/${this.paragraphs.length}`);
  }

  highlightParagraph(el) {
    this.clearAudioHighlights();
    if (el) {
      el.classList.add('player-audio-active-para');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  clearAudioHighlights() {
    const active = document.querySelectorAll('.player-audio-active-para');
    active.forEach(a => a.classList.remove('player-audio-active-para'));
  }

  updateAudioStatus(status) {
    if (this.audioStatusEl) {
      const text = status || (this.paragraphs.length > 0 ? `${this.paragraphs.length} blocks` : 'Ready');
      this.audioStatusEl.textContent = text;
    }
  }

  close() {
    this.stopAudio();
    this.overlay.classList.remove('active');
    document.body.style.overflow = '';
  }
}

export const epubPlayer = new EpubPlayer();
