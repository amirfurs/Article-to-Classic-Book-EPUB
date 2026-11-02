# ReadCast — Article to Classic Book EPUB

Transform web articles, essays, and multi-page newsletters into publication-grade EPUB books and anthologies. Includes custom book cover generators, nested tables of contents, drop caps, reader preview, and wireless delivery to Amazon Kindle.

---

## 🚀 Deploy to Vercel in 60 Seconds

ReadCast is pre-configured for zero-friction serverless hosting on [Vercel](https://vercel.com).

### Option 1: Vercel Dashboard (Zero-Configuration)

1. Push your repository to **GitHub** or **GitLab**.
2. Go to [vercel.com/new](https://vercel.com/new) and import your repository.
3. Keep default settings:
   - **Framework Preset**: *Other*
   - **Root Directory**: `./`
   - **Build Command**: *None*
   - **Output Directory**: *None*
4. Click **Deploy**.

Vercel will automatically:
- Serve all static UI assets from `public/` globally via the Vercel Edge Network.
- Route all `/api/*` endpoints to the serverless function in `api/index.js`.
- Provide an active production URL with SSL enabled.

---

### Option 2: Vercel CLI (One Command)

From your project folder:

```bash
# 1. Install Vercel CLI globally (if not installed)
npm i -g vercel

# 2. Deploy to preview
vercel

# 3. Deploy to production
vercel --prod
```

---

## 🛠️ Optional Environment Variables

Configure these in your Vercel Project Settings under **Settings > Environment Variables** (or locally in `.env`):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment mode (`production` / `development`) | `production` |
| `SMTP_HOST` | *(Optional)* SMTP host for live Amazon Kindle dispatch | (Simulation mode) |
| `SMTP_PORT` | *(Optional)* SMTP port (e.g. `587` or `465`) | `587` |
| `SMTP_USER` | *(Optional)* SMTP username or email | — |
| `SMTP_PASS` | *(Optional)* SMTP app password | — |
| `SENDER_EMAIL` | *(Optional)* Approved sender address for Kindle delivery | — |

> [!NOTE]
> If SMTP credentials are not configured, Kindle delivery runs in **Simulation Mode** — users can still convert articles, read in-browser, generate QR codes, and download EPUB files instantly without any configuration.

---

## 🧪 Local Development & Testing

```bash
# Install dependencies
npm install

# Run automated engine test suite (41 tests)
npm test

# Start local development server
npm start
# Server will run at http://localhost:3000
```

---

## 📁 Project Architecture on Vercel

```text
├── api/
│   └── index.js             # Vercel serverless function entry point
├── public/                  # Static frontend served at root by Vercel CDN
│   ├── css/                 # Classic editorial typography & dark/light styles
│   ├── js/                  # Vanilla JS application, API client, & reader
│   ├── assets/              # Flat vector SVG emblems & logos
│   └── index.html           # Main application dashboard & EPUB player
├── server/
│   ├── app.js               # Express application configuration & routing
│   ├── server.js            # Standalone Node.js server for local dev
│   ├── routes/api.js        # API endpoints (/api/extract, /api/convert, /api/bundle, etc.)
│   └── services/            # Extractor, EPUB generator, buffer cache, & Kindle sync
├── vercel.json              # Vercel routing, memory, and timeout configuration
└── .vercelignore            # Excludes dev files and local tests from production build
```

---

## 🩺 Verification Endpoint

Once deployed to Vercel, visit:
```text
https://<your-project>.vercel.app/api/health
```
It returns JSON confirming serverless status and uptime:
```json
{
  "status": "ok",
  "uptime": 12,
  "timestamp": "2026-11-02T13:20:00.000Z",
  "environment": "vercel-serverless"
}
```

