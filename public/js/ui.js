/**
 * ReadCast UI helper functions
 * Classic design, flat SVG icons
 */
import { icon } from './icons.js';

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconSvg = icon('info');
  if (type === 'success') iconSvg = icon('check');
  if (type === 'error') iconSvg = icon('alert');

  toast.innerHTML = `<span class="toast-icon">${iconSvg}</span> <span class="toast-msg">${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Update the 4-step conversion stepper
 */
export function setPipelineStep(stepIndex) {
  const stepper = document.getElementById('pipeline-stepper');
  if (!stepper) return;

  if (stepIndex === 0) {
    stepper.classList.remove('active');
    return;
  }

  stepper.classList.add('active');
  const items = stepper.querySelectorAll('.step-item');

  items.forEach((item, idx) => {
    const itemStep = idx + 1;
    item.classList.remove('active', 'completed');
    if (itemStep < stepIndex) {
      item.classList.add('completed');
    } else if (itemStep === stepIndex) {
      item.classList.add('active');
    }
  });
}

/**
 * Generate client-side SVG cover preview matching server engine
 * Classic editorial book aesthetics - zero neon glow
 */
export function renderCoverSvg({
  title = 'Untitled Article',
  author = 'Author',
  siteName = 'Web Source',
  date = new Date().toISOString().split('T')[0],
  coverStyle = 'modern',
  readingTime = 5
}) {
  const cleanTitle = escapeHtml(title || 'Untitled Article');
  const cleanAuthor = escapeHtml(author || siteName || 'ReadCast');
  const cleanSite = escapeHtml(siteName || 'Web Article');
  const cleanDate = escapeHtml(date);

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
    ? '"Newsreader", "Georgia", "Times New Roman", serif' 
    : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const titleLinesSvg = lines.map((line, i) => {
    const y = 560 + (i * 72);
    return `<text x="500" y="${y}" font-family='${fontFamily}' font-size="54" font-weight="${fontSerif ? '700' : '800'}" fill="${titleColor}" letter-spacing="-0.01em" text-anchor="middle">${escapeHtml(line)}</text>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500" width="100%" height="100%">
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
