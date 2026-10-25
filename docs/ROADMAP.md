# 🗺️ Product Roadmap & Strategic Vision: WordRadar

**Product:** **WordRadar** (`wordradar.githsoft.com`, alias `words.githsoft.com`)  
**Role / Owner:** GithSoft Ecosystem  
**Target Audience:** Language Learners (B1 ➔ C1/C2), Exam Preppers (IELTS, TOEFL, GRE), Readers of Foreign E-Books & Technical Documentation (PMP, Medical, Tech).  
**Last Updated:** October 2026  

---

## 1. 🌟 Product Vision & Market Positioning

### The Problem
Language learners transitioning to intermediate/advanced fluency face the **"Intermediate Plateau"**: graded readers feel too childish, but native books (novels, non-fiction) present a wall of unknown vocabulary. Conventional tools either force users to read inside slow, bloated web apps for \$15/month (LingQ), require complex Docker/Python self-hosting (Lute), or are raw academic tools that lack learning workflows (AntConc, Voyant).

### The Solution: "The Pre-Reading Companion"
Instead of forcing users to read entire books in a web browser, `words.githsoft.com` positions itself as the **Pre-Reading Companion & Smart Lexical Profiler**:
1. **Analyze First:** Upload any book (`.pdf`, `.docx`, `.txt`, `.csv`, `.epub`).
2. **Book Readiness Radar (CEFR A1–C2):** Identify lexical coverage and know *exactly* which ~50 words unlock 95% comprehension of the text.
3. **Smart Lemmatization:** Group inflected forms (`analyze`, `analyzing`, `analyzed`) to base headwords.
4. **Context-Preserved Anki Export:** 1-click export to `.apkg` or AnkiConnect with exact sentences from the book.
5. **Read Anywhere:** Read effortlessly on physical paperbacks, Kindle, or Kobo without constant dictionary interruptions.

---

## 2. 👥 User Personas & Jobs To Be Done (JTBD)

| Persona | Primary Goal | Pain Point | Killer Feature Needed |
| :--- | :--- | :--- | :--- |
| **The Novel Lover** (Alex, 26) | Read English fantasy/sci-fi novels without looking up a word every 2 sentences. | Dictionary fatigue disrupts immersion; reading on web/mobile apps is uncomfortable compared to Kindle. | **Pre-Reading High-Yield List**: Learn the top 50 novel-specific keywords before opening chapter 1. |
| **The Exam Prepper** (Minh, 22) | Target 7.5+ IELTS / TOEFL by reading academic journals and news. | Doesn't know which words are basic (A1-A2) vs advanced (C1-C2). | **CEFR Filtering**: Filter out A1-B1 words; study only B2 and C1 words with original contexts. |
| **The Professional** (Thinh, 31) | Study 500-page English certification manuals (PMBOK, AWS, Medical). | Dense jargon repeated across hundreds of pages. | **Multi-Book Corpus & Anki Export**: Export all domain terms into Anki with definitions and exam-context sentences. |

---

## 3. 🎯 3-Phase Roadmap

### 🚀 Phase 1: Security, Reliability & Multi-Screen Mobile Experience (Completed)
- [x] **Zero-Storage Feedback Gateway:** Direct integration to GitHub User-Attachments CDN + auto-creation of GitHub Issues.
- [x] **Security Hardening:** Enforce 50MB upload limits; disable devMode OTP leaks in production; harden `JWT_SECRET`.
- [x] **Mobile & Multi-Screen Responsive Overhaul:**
  - Responsive layout optimized for smartphones (320px–480px), phablets (600px), tablets (768px–1024px), and desktop/ultrawide displays.
  - Mobile card views for vocabulary rows with touch-friendly actions (permanent touch TTS buttons replacing hover).
  - Bottom-safe drawer view for sentence contexts and dictionary definitions on small viewports.
- [x] **Data Export:** RFC 4180 CSV escaping and 1-click Anki TSV export format.

### 🧠 Phase 2: NLP Intelligence & Ecosystem Integration (Completed)
- [x] **Unicode Tokenizer & Precision Filtering:**
  - Support Unicode characters (`\p{L}+(?:['’]\p{L}+)*`) to properly handle diacritics (`café`, `año`) and contractions (`don't`, `it's`).
- [x] **CEFR Level Classification (A1–C1):**
  - Integrate Oxford 5000 dataset into local SQLite database (`data/dictionary.db`).
  - Visual color-coded badges: `[A1]`, `[A2]`, `[B1]`, `[B2]`, `[C1]`, `[Off-list]`.
  - CEFR filter selector: Filter by exact CEFR level (A1 to C1).
  - Book Readiness Coverage calculation & Radar progress bar against 95% comprehension threshold.
- [x] **Anki Study Deck Export:**
  - 1-click export to Anki TSV format with word, phonetic, CEFR, meaning, frequency, and sample sentence context.
- [ ] **SRS Engine Upgrade (Standard SM-2):**
  - Replace naive fixed multipliers with SuperMemo-2 (SM-2) algorithm including Ease Factor (1.3–2.5).

### 📈 Phase 3: Growth, Monetization & Advanced Analytics (Planned)
- [ ] **Book DNA Shareable Cards:**
  - 1-click generation of visual infographic cards summarizing a book's lexical fingerprint for social sharing.
- [ ] **Collocation & Phrasal Verb Extraction:**
  - N-gram and POS pattern matching for common multi-word units (`look up to`, `come up with`).
- [ ] **EPUB & MOBI Client-Side Parsers:**
  - In-browser parsing of DRM-free e-book formats without server upload overhead.
- [ ] **Multi-Book / Series Corpus Aggregation:**
  - Analyze an entire book series (e.g. *Harry Potter*, *A Song of Ice and Fire*) to track progressive vocabulary.

---

## 4. 📐 Technical Architecture Principles
1. **Zero-Lockin / Zero-Storage Hygiene:** Feedback and assets leverage CDN endpoints without bloating the git repo or database.
2. **Offline-First & Fast:** Core dictionary and CEFR lookups run in sub-millisecond offline SQLite queries (`data/dictionary.db`).
3. **Adaptive Viewports:** Seamless fluid scaling from iPhone SE (320px) to 4K desktop screens without horizontal overflow or hidden controls.
4. **Resilient Server Loop:** Offload large file parsing and regex tokenization to prevent blocking the Node.js event loop.

---

## 5. ☁️ Migration Plan: Standalone Branch to Cloudflare (`wordradar.pages.dev`)

### Goal
Decouple from `words.githsoft.com` into a clean, non-commercial standalone app deployed to Cloudflare Pages (`wordradar.pages.dev`).

### Cloudflare Free Tier Feasibility & Capacity Analysis
Is the Cloudflare Free Tier sufficient when sharing with multiple existing projects? **YES, more than enough**, for the following architectural reasons:

1. **Storage Comparison (D1 vs Database Size):**
   - Cloudflare D1 Free Tier: **5 GB total storage** per account.
   - Current SQLite database (`data/dictionary.db`): **~23 MB** (~0.46% of the 5 GB quota).
   - Even with 10–20 other apps running, 23 MB is virtually negligible.
2. **D1 Read/Write Quotas:**
   - D1 Free Tier allows **5,000,000 row reads / day** and **100,000 row writes / day**.
   - Dictionary lookup is 99.9% read-only with primary key indexing (`SELECT level, definition FROM words WHERE word = ?`).
   - A typical book analysis querying 500–1,000 unique lemmas consumes only ~1,000 row reads.
3. **Recommended Zero-Cost Architecture: Client-Side SQLite Wasm:**
   - Instead of querying D1 over HTTP/Workers, compress `dictionary.db` with Brotli (~6 MB).
   - Cloudflare Pages serves the compressed dictionary with **Unlimited Bandwidth** on the Free Tier.
   - The client browser loads the dictionary into browser memory / IndexedDB / OPFS (Origin Private File System) via SQLite Wasm (`sql.js` or official SQLite Wasm).
   - **Impact on Account:**
     - D1 Row Reads consumed: **0**
     - Worker CPU time: **0**
     - Worker Requests consumed: **0**
     - Completely immune to quota exhaustion across all other apps on your Cloudflare account.

### Implementation Checklist for Standalone Branch (`cloudflare-serverless`):
- [ ] Create branch `git checkout -b feature/wordradar-cloudflare`.
- [ ] Extract frontend assets into a pure static SPA build compatible with Cloudflare Pages.
- [ ] Implement SQLite Wasm / OPFS client-side query runner for `dictionary.db`.
- [ ] Replace server-side Multer/PDF-parse with browser-native text/PDF/EPUB extractors (`pdf.js`, `jszip`).
- [ ] Configure `wordradar.pages.dev` project on Cloudflare Pages.
