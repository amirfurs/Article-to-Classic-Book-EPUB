import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serverless-safe data directory resolution (works on Vercel, AWS Lambda, or local)
function resolveDataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'readcast-data');
  }

  const defaultDir = path.resolve(__dirname, '../../data');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    const testFile = path.join(defaultDir, `.test_${Date.now()}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return defaultDir;
  } catch (err) {
    // Read-only filesystem fallback (e.g. containers or serverless)
    return path.join(os.tmpdir(), 'readcast-data');
  }
}

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, 'db.json');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Silent fallback to memory if directory creation fails
}

const DEFAULT_DB = {
  epubs: [],
  settings: {
    theme: 'dark',
    defaultCoverStyle: 'modern',
    includeImagesDefault: true,
    fontFamily: 'serif',
    kindleEmail: '',
    senderEmail: '',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: ''
  },
  stats: {
    totalConversions: 0,
    totalBundles: 0,
    totalWords: 0,
    kindleDeliveries: 0
  }
};

// In-memory fallback ensuring DB operations never fail in serverless environments
let memoryDb = JSON.parse(JSON.stringify(DEFAULT_DB));

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(memoryDb, null, 2), 'utf-8');
      } catch (writeErr) {
        // Ephemeral / read-only filesystem, use in-memory store
      }
      return memoryDb;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    memoryDb = parsed;
    return parsed;
  } catch (err) {
    return memoryDb;
  }
}

function writeDb(data) {
  memoryDb = data;
  try {
    const tmpFile = `${DB_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    // Memory DB is already updated; ignore disk write failure in serverless
  }
}

export const db = {
  getLibrary({ search = '', tag = '', limit = 50, offset = 0 } = {}) {
    const data = readDb();
    let items = [...data.epubs];

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(item => 
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.author && item.author.toLowerCase().includes(q)) ||
        (item.siteName && item.siteName.toLowerCase().includes(q)) ||
        (item.url && item.url.toLowerCase().includes(q))
      );
    }

    if (tag) {
      items = items.filter(item => item.tags && item.tags.includes(tag));
    }

    // Sort newest first
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);

    return { total, items: paginated };
  },

  getEpubById(id) {
    const data = readDb();
    return data.epubs.find(item => item.id === id) || null;
  },

  saveEpub(record) {
    const data = readDb();
    const existingIndex = data.epubs.findIndex(item => item.id === record.id);
    
    if (existingIndex >= 0) {
      data.epubs[existingIndex] = { ...data.epubs[existingIndex], ...record, updatedAt: new Date().toISOString() };
    } else {
      data.epubs.unshift({
        ...record,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    // Update stats
    data.stats.totalConversions += 1;
    if (record.isBundle) {
      data.stats.totalBundles += 1;
    }
    if (record.wordCount) {
      data.stats.totalWords += record.wordCount;
    }

    writeDb(data);
    return record;
  },

  deleteEpub(id) {
    const data = readDb();
    const index = data.epubs.findIndex(item => item.id === id);
    if (index >= 0) {
      const item = data.epubs[index];
      data.epubs.splice(index, 1);
      writeDb(data);
      return item;
    }
    return null;
  },

  getSettings() {
    const data = readDb();
    return data.settings || DEFAULT_DB.settings;
  },

  updateSettings(newSettings) {
    const data = readDb();
    data.settings = { ...data.settings, ...newSettings };
    writeDb(data);
    return data.settings;
  },

  getStats() {
    const data = readDb();
    return data.stats || DEFAULT_DB.stats;
  },

  recordKindleDelivery() {
    const data = readDb();
    data.stats.kindleDeliveries = (data.stats.kindleDeliveries || 0) + 1;
    writeDb(data);
  }
};
