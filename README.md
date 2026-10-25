# WordRadar 🛰️

A smart lexical profiler and pre-reading companion to help language learners scan books, assess CEFR difficulty, extract high-yield vocabulary, and achieve 95% reading comprehension.

## 🚀 Features & Roadmap

### Core Analysis & Visualization
- [x] **Multi-Format Support**: Upload `.epub`, `.pdf`, `.docx`, `.txt`, `.csv` (Max 50MB).
- [x] **Smart Analysis & CEFR Profiling**: Extract frequent words, tokenize with Unicode contractions/accents, classify by Oxford 5000 (A1–C1).
- [x] **Book Readiness Radar**: Instant lexical distribution and readiness coverage bar against the 95% reading comprehension threshold.
- [x] **Collocations & Phrases**: Automatic extraction of high-frequency bigrams and idiomatic multi-word units.
- [x] **Book DNA Infographics**: 1-click generation of high-res 16:9 shareable cards summarizing lexical fingerprint, readiness score, and gatekeeper vocabulary.
- [x] **Visualizations**: Interactive Word Cloud & detailed frequency statistics.
- [x] **Data Tools**: Search, CEFR level filter, and sort word lists.
- [x] **Export**: Download analysis results to CSV and 1-click **Anki TSV** flashcard format.
- [x] **Multi-File Analysis**: Combine multiple documents for comprehensive analysis.

### Learning Tools
- [x] **Context Viewer**: Show original sentence/paragraph where word appears.
- [x] **Instant Lookups**: Popup translation & auto-pronunciation (TTS).
- [x] **CEFR Level Badges**: Color-coded CEFR badges (A1 to C1) for instant difficulty assessment.
- [x] **SuperMemo-2 (SM-2) Flashcards**: Standard SM-2 Spaced Repetition engine with Ease Factor (1.3–3.0) and dynamic interval previews (Again, Hard, Good, Easy).
- [x] **Vocabulary Management**: Star/save words across documents (Cloud sync).

### System & UX
- [x] **Mobile Optimization**: Responsive card-view for phones/tablets with touch-friendly TTS controls.
- [x] **User Accounts**: Secure login via Email OTP (passwordless).
- [x] **Cloud Sync**: Sync saved vocabulary and progress across devices.

### Community & Feedback
- [x] **Zero-Storage Feedback Gateway**: Direct user attachment uploads to GitHub CDN and automatic Issue tracking (no server storage waste).
- [x] **Admin Dashboard**: Internal tool for devs to view feedback linked to GitHub Issues.

### Testing & Quality
- [x] **Automated Testing**: Playwright E2E test suite with Page Object Model.
- [x] **Documentation**: Complete API docs, configuration guide, contributing guidelines.

## 🛠️ Tech Stack
*   **Backend**: Node.js, Express, SQLite, Sequelize, Multer.
*   **Frontend**: Vanilla JS, HTML5/CSS3 (Glassmorphism), D3.js.
*   **Auth**: JWT + Email OTP (Nodemailer).
*   **Testing**: Playwright.

## � Quick Start

```bash
# Clone repository
git clone https://github.com/GithSoft/wordradar.git
cd wordradar

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your email credentials

# Run server
npm run dev
# Open http://localhost:3000
```

## 📚 Documentation

- 🗺️ **[Product Roadmap & BA Strategic Plan](docs/ROADMAP.md)**
- 📘 [API Documentation](docs/API.md)
- 🛠️ [Configuration Guide](docs/CONFIGURATION.md)
- 🧪 [Testing Guide](tests/README.md)
- 🤝 [Contributing](docs/CONTRIBUTING.md)

## 🗺️ Product Roadmap Overview

Detailed strategic initiatives, competitor comparison, and delivery phases are documented in [**docs/ROADMAP.md**](docs/ROADMAP.md).

- **Horizon 1 (Foundation & Security - Completed)**:
  - [x] Zero-Storage Feedback Gateway (direct GitHub CDN upload & automated issue filing).
  - [x] Unicode regex tokenization (accents & contractions preserved).
  - [x] Upload limit enforcement (50MB) and production OTP leak hardening.
- **Horizon 2 (Pre-Reading Profiler & Mobile UX - Completed)**:
  - [x] CEFR Oxford 5000 Lexical Profiling (A1–C1) + US/UK spelling variants.
  - [x] Book Readiness Radar (95% comprehension threshold progress bar).
  - [x] Mobile-first UI overhaul (touch TTS buttons, responsive stacked cards view).
  - [x] CEFR level filtering & 1-click Anki TSV export for spaced repetition learning.
- **Horizon 3 (Deep Linguistic Analysis & Media Support - Completed)**:
  - [x] N-gram Collocation & Phrasal Verb extraction (surface idiomatic bigrams).
  - [x] Native EPUB e-book format parsing with chapter ordering and XML entity decoding.
  - [x] Book DNA Shareable Infographics (16:9 canvas card generation for social sharing).
  - [x] SuperMemo-2 (SM-2) Spaced Repetition engine upgrade with dynamic interval previews.
- **Horizon 4 (Ecosystem & Platform - Planned)**:
  - [ ] PWA offline support & Kindle clippings import.
  - [ ] Web Reader with live instant context annotations.
  - [ ] Standalone Cloudflare migration (`wordradar.pages.dev`).

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Made with ❤️ for language learners worldwide**
