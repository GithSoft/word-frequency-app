# 📋 Project TODO: `wordradar` Cloudflare Migration

**Target Domain:** `wordradar.pages.dev`  
**Planned Branch:** `feature/wordradar-cloudflare`  
**Original Name:** `word-frequency-analyzer` (`tackelua/word-frequency-app`)  
**Current Repo:** `https://github.com/GithSoft/wordradar`  
**Goal:** Migrate WordRadar into an independent, non-commercial, 100% serverless/client-side static PWA on Cloudflare Pages without consuming backend resources.

---

## 🎯 Architecture Decisions & Quota Plan
- [x] **Subdomain Selection:** Selected `wordradar.pages.dev` (clean, memorable, unbranded).
- [x] **Cloudflare Free Tier Assessment:** Confirmed 100% viable on Free Tier:
  - D1 free limit: 5 GB storage (current DB is 23MB, only 0.46% quota).
  - Recommended zero-cost mode: SQLite Wasm in-browser (Brotli-compressed dictionary ~6MB). Zero D1 reads, zero Worker execution hits.

---

## 🛠️ Step-by-Step Migration Tasks (For New Branch)

### 1. Branch & Project Setup
- [ ] Create standalone branch: `git checkout -b feature/wordradar-cloudflare`.
- [ ] Rename branding in UI from "Word Frequency Analyzer" to "**WordRadar**" (`public/index.html`, meta tags, manifest.json).
- [ ] Set up minimal build/bundler or clean vanilla asset pipeline in `public/`.

### 2. Client-Side SQLite Engine (Zero Server / Zero D1)
- [ ] Integrate official SQLite Wasm or `sql.js` via Web Worker to prevent UI freezing.
- [ ] Compress `data/dictionary.db` to `dictionary.db.br` (~6MB) and host as a static asset.
- [ ] Cache dictionary locally in the browser via OPFS (Origin Private File System) or IndexedDB for instant offline re-use.
- [ ] Migrate dictionary lookups (`getCefrBatch`, `getWordInfo`) from backend API routes to client-side Web Worker queries.

### 3. Client-Side Document Parsing
- [ ] Replace server-side multer + `pdf-parse` with `pdf.js` running in the browser.
- [ ] Replace server-side `mammoth` (docx) with browser-compatible `mammoth.browser.js`.
- [ ] Add native `.epub` parsing using `jszip` directly on the client.

### 4. Cloudflare Pages Deployment
- [ ] Connect repo to Cloudflare Pages with project name `wordradar`.
- [ ] Verify SSL certificate and live routing on `https://wordradar.pages.dev`.
- [ ] Enable PWA offline service worker for instant book analysis anywhere without internet.
