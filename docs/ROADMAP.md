# 🗺️ Product Roadmap & Strategic Vision: Word Frequency Analyzer

**Product:** `words.githsoft.com` (Word Frequency Analyzer)  
**Role / Owner:** Tackelua / Githsoft Ecosystem  
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

### 🚀 Phase 1: Security, Reliability & Multi-Screen Mobile Experience (Current Focus)
- [x] **Zero-Storage Feedback Gateway:** Direct integration to GitHub User-Attachments CDN + auto-creation of GitHub Issues.
- [ ] **Security Hardening:** Enforce 50MB upload limits; disable devMode OTP leaks in production; harden `JWT_SECRET`.
- [ ] **Mobile & Multi-Screen Responsive Overhaul:**
  - Responsive layout optimized for smartphones (320px–480px), phablets (600px), tablets (768px–1024px), and desktop/ultrawide displays.
  - Mobile card views for vocabulary rows with touch-friendly actions (replace hover-only TTS buttons with dedicated touch buttons).
  - Full-screen / bottom-sheet drawer for sentence contexts and dictionary definitions on small viewports.
  - Mobile-first Flashcard SRS interface with thumb-reachable rating buttons (`Again`, `Hard`, `Good`, `Easy`).
- [ ] **Data Export Fixes:** RFC 4180 CSV escaping (escapes quotes, commas) and exports definitions + context.

### 🧠 Phase 2: NLP Intelligence & Ecosystem Integration
- [ ] **Unicode Tokenizer & Smart Lemmatization:**
  - Support Unicode characters (`\p{L}`) to properly handle diacritics (`café`, `año`, Vietnamese text) and contractions (`don't`, `it's`).
  - Morphological lemmatization via `natural` to group inflectional variants into headwords.
- [ ] **CEFR Level Classification (A1–C2):**
  - Integrate Oxford 5000 / Cambridge EVP dataset into local SQLite database.
  - Visual badges: `[A1]`, `[A2]`, `[B1]`, `[B2]`, `[C1]`, `[C2]`.
  - CEFR filter selector: "Hide A1/A2 words", "Focus on B2+".
  - Book Readiness Coverage calculation (e.g. `85% A1-B1, 10% B2, 5% C1+`).
- [ ] **Anki Ecosystem Export:**
  - 1-click push to desktop Anki via **AnkiConnect** (`http://127.0.0.1:8765`).
  - Direct download of native **`.apkg`** decks containing card templates, definitions, phonetic audio, and bolded context sentences.
- [ ] **SRS Engine Upgrade (Standard SM-2):**
  - Replace naive fixed multipliers with SuperMemo-2 (SM-2) algorithm including Ease Factor (1.3–2.5).
  - Fix millisecond vs minute unit mismatch across database and frontend.

### 📈 Phase 3: Growth, Monetization & Advanced Analytics
- [ ] **Book DNA Shareable Cards:**
  - 1-click generation of beautiful visual infographic cards summarizing a book's lexical fingerprint for social sharing (`r/languagelearning`, Twitter/X).
- [ ] **Multi-Book / Author Corpus Aggregation:**
  - Analyze an entire book series (e.g., all 7 *Harry Potter* books) to identify vocabulary introduced book-by-book.
- [ ] **EPUB & MOBI Native Parsers:**
  - Direct upload and parsing of DRM-free e-book formats.
- [ ] **Pro Tier Monetization ($3.99/mo or $29/year):**
  - Unlimited file size, bulk multi-book corpus analysis, automated native audio embedding in `.apkg`, and AI idiom explanation.

---

## 4. 📐 Technical Architecture Principles
1. **Zero-Lockin / Zero-Storage Hygiene:** Feedback and assets leverage CDN endpoints without bloating the git repo or database.
2. **Offline-First & Fast:** Core dictionary and CEFR lookups run in sub-millisecond offline SQLite queries (`data/dictionary.db`).
3. **Adaptive Viewports:** Seamless fluid scaling from iPhone SE (320px) to 4K desktop screens without horizontal overflow or hidden controls.
4. **Resilient Server Loop:** Offload large file parsing and regex tokenization to prevent blocking the Node.js event loop.
