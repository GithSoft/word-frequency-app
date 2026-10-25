/**
 * Word Frequency Analyzer
 * Tokenizes text and analyzes word frequency
 */

// Common English stopwords (expanded comprehensive ISO & NLP set)
const STOPWORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
  'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go',
  'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him',
  'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some',
  'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look',
  'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after',
  'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even',
  'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'am', 'is', 'are', 'was', 'were', 'been', 'being', 'has', 'had',
  'having', 'does', 'did', 'doing', 'shall', 'should', 'cannot',
  'might', 'must', 'myself', 'himself', 'herself', 'itself',
  'ourselves', 'themselves', 'yourself', 'yourselves', 'whom', 'whose',
  'where', 'why', 'here', 'above', 'below', 'between',
  'both', 'each', 'few', 'more', 'own', 'same', 'such', 'too', 'very',
  'again', 'further', 'once', 'during', 'before', 'through',
  'under', 'until', 'while', 'against', 'down', 'off', 'throughout'
]);

let dictService = null;
try {
  dictService = require('./dictionary-service');
} catch (_) {}

const abbrRegex = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g)\.$/i;
const singleLetterRegex = /\b[A-Za-z]\.$/;
const numRegex = /\b\d+\.$/;

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class ContextItem {
  constructor({ text, score = 0, source = 'document', fileName = 'document', line = 1, page = 1, isFallbackSnippet = false, translation = '' }) {
    this.text = text;
    this.source = source;
    this.fileName = fileName;
    this.line = line;
    this.page = page;
    if (score !== undefined) this.score = score;
    if (isFallbackSnippet) this.isFallbackSnippet = true;
    if (translation) this.translation = translation;
  }
  toString() { return this.text; }
  valueOf() { return this.text; }
  [Symbol.toPrimitive]() { return this.text; }
  includes(...args) { return this.text.includes(...args); }
  startsWith(...args) { return this.text.startsWith(...args); }
  endsWith(...args) { return this.text.endsWith(...args); }
  get length() { return this.text.length; }
  slice(...args) { return this.text.slice(...args); }
  indexOf(...args) { return this.text.indexOf(...args); }
}

/**
 * Generator that stitches sentence segments split incorrectly across abbreviations or decimal numbers
 * @param {string} rawText
 */
function* getStitchedSentences(rawText) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  let pending = '';
  let pendingIndex = 0;

  for (const { segment, index } of segmenter.segment(rawText)) {
    if (!pending) {
      pending = segment;
      pendingIndex = index;
      continue;
    }

    const trimmed = pending.trimEnd();
    const isAbbr = abbrRegex.test(trimmed) || singleLetterRegex.test(trimmed) || numRegex.test(trimmed);
    const nextTrimmed = segment.trimStart();
    const nextStartsWordOrNum = /^[\w\d]/.test(nextTrimmed);

    if (isAbbr && nextStartsWordOrNum) {
      pending += segment;
    } else {
      yield { sentence: pending, index: pendingIndex };
      pending = segment;
      pendingIndex = index;
    }
  }

  if (pending) {
    yield { sentence: pending, index: pendingIndex };
  }
}

/**
 * Analyzes word frequency in text
 * @param {string} text - The text to analyze
 * @param {object} options - Analysis options
 * @returns {object} Analysis results
 */
async function analyzeWordFrequency(text, options = {}) {
  const {
    minLength = 2,
    maxResults = 100,
    caseSensitive = false,
    includeStopwords = false,
    skipContext = false
  } = options;

  // Unicode-aware regex matching letters, diacritics, and internal contractions (' or ’)
  const regex = /\p{L}+(?:['’]\p{L}+)*/gu;
  let match;
  const frequencyMap = new Map();
  const bigramMap = new Map();
  let prevWord = null;
  let prevEnd = -1;
  let totalWords = 0;
  let totalWordsAnalyzed = 0;
  let wordIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    totalWordsAnalyzed++;

    // Yield to event loop every 10k words to allow interleaved parallel counting
    if (wordIdx++ % 10000 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }

    const rawWord = match[0];
    const word = caseSensitive ? rawWord : rawWord.toLowerCase();
    const curStart = match.index;

    // Check sentence boundary separation for collocations
    if (prevWord !== null) {
      const boundarySlice = text.slice(prevEnd, curStart);
      const crossesBoundary = /[.!?\n\r;:]/.test(boundarySlice);
      if (!crossesBoundary) {
        const isPrevStop = STOPWORDS.has(prevWord);
        const isCurStop = STOPWORDS.has(word);
        // Exclude purely stopword-stopword pairs (e.g. "it is", "in the") to surface meaningful content phrases
        if ((!isPrevStop || !isCurStop) && prevWord.length >= 2 && word.length >= 2) {
          const bigram = `${prevWord} ${word}`;
          bigramMap.set(bigram, (bigramMap.get(bigram) || 0) + 1);
        }
      }
    }
    prevWord = word;
    prevEnd = regex.lastIndex;

    // Filter by length
    if (word.length < minLength) continue;

    // Filter stopwords
    if (!includeStopwords && STOPWORDS.has(word)) continue;

    totalWords++;
    frequencyMap.set(word, (frequencyMap.get(word) || 0) + 1);
  }

  // Top collocations
  const collocations = Array.from(bigramMap.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([phrase, count]) => ({ phrase, count }));

  // Initial results without context
  let results = Array.from(frequencyMap.entries())
    .map(([word, count]) => ({
      word,
      count,
      percentage: totalWords > 0 ? ((count / totalWords) * 100).toFixed(2) : 0,
      cefr: null,
      context: [] // Empty initially
    }))
    .sort((a, b) => b.count - a.count);

  // Compute CEFR Profiling (Book Readiness Radar)
  let cefrStats = {
    counts: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
    percentages: { A1: '0.0', A2: '0.0', B1: '0.0', B2: '0.0', C1: '0.0', C2: '0.0' },
    overallLevel: 'B1'
  };

  if (dictService && dictService.getCefrBatch) {
    try {
      const allWords = results.map(r => r.word);
      const cefrMap = await dictService.getCefrBatch(allWords);
      let totalCategorized = 0;

      results.forEach(item => {
        const lvl = cefrMap[item.word] || null;
        item.cefr = lvl;
        if (lvl && cefrStats.counts[lvl] !== undefined) {
          cefrStats.counts[lvl] += item.count;
          totalCategorized += item.count;
        } else {
          cefrStats.counts.C2 += item.count;
          totalCategorized += item.count;
        }
      });

      for (const [lvl, count] of Object.entries(cefrStats.counts)) {
        cefrStats.percentages[lvl] = totalCategorized > 0
          ? ((count / totalCategorized) * 100).toFixed(1)
          : '0.0';
      }

      const b2Plus = (cefrStats.counts.B2 + cefrStats.counts.C1 + cefrStats.counts.C2) / (totalCategorized || 1);
      const c1Plus = (cefrStats.counts.C1 + cefrStats.counts.C2) / (totalCategorized || 1);
      if (c1Plus > 0.15) cefrStats.overallLevel = 'C1 (Advanced)';
      else if (b2Plus > 0.35) cefrStats.overallLevel = 'B2 (Upper Intermediate)';
      else if (b2Plus > 0.15) cefrStats.overallLevel = 'B1 (Intermediate)';
      else cefrStats.overallLevel = 'A2 (Elementary)';
    } catch (cefrErr) {
      console.warn('[Analyzer] CEFR batch profiling warning:', cefrErr.message);
    }
  }

  // If we're skipping context, return early
  if (skipContext) {
    // Only slice if maxResults is finite
    if (isFinite(maxResults) && maxResults > 0) {
      results = results.slice(0, maxResults);
    }

    return {
      results,
      collocations,
      totalWords,
      uniqueWords: frequencyMap.size,
      cefrStats,
      stats: {
        totalWordsAnalyzed,
        wordsAfterFiltering: totalWords,
        uniqueWords: frequencyMap.size
      }
    };
  }

  // Otherwise, extract context immediately (blocking behavior for backward compatibility)
  const topWords = results.slice(0, isFinite(maxResults) ? maxResults : frequencyMap.size)
    .map(item => item.word);

  const contextMap = await extractContexts(text, topWords, { caseSensitive, fileName: options.fileName });

  // Merge contexts
  if (contextMap) {
    results.forEach(item => {
      if (contextMap.has(item.word)) {
        item.context = contextMap.get(item.word);
      }
    });
  }

  // Only slice if maxResults is finite
  if (isFinite(maxResults) && maxResults > 0) {
    results = results.slice(0, maxResults);
  }

  return {
    results,
    collocations,
    totalWords,
    uniqueWords: frequencyMap.size,
    cefrStats,
    stats: {
      totalWordsAnalyzed,
      wordsAfterFiltering: totalWords,
      uniqueWords: frequencyMap.size
    }
  };
}

/**
 * Extracts context sentences for specific words
 * @param {string} text - The full text
 * @param {string[]} targetWords - Words to find context for
 * @param {object} options - Options
 * @returns {Map<string, Array>} Map of word -> context items
 */
async function extractContexts(text, targetWords, options = {}) {
  const { caseSensitive = false, fileName = 'document' } = options;
  const wordContexts = new Map(); // word -> Array<ContextItem>
  const targetWordsNorm = caseSensitive ? targetWords : targetWords.map(w => w.toLowerCase());
  const targetSet = new Set(targetWordsNorm);
  const phraseTargets = targetWordsNorm.filter(w => w.includes(' '));

  // Build newline index array and page index array (\f form feeds)
  const newlinePositions = [];
  const pagePositions = [];
  for (let idx = 0; idx < text.length; idx++) {
    if (text[idx] === '\n') newlinePositions.push(idx);
    else if (text[idx] === '\f') pagePositions.push(idx);
  }

  function getLineAndPage(charIndex) {
    let line = 1;
    for (let idx = 0; idx < newlinePositions.length; idx++) {
      if (newlinePositions[idx] < charIndex) line++;
      else break;
    }
    let page = 1;
    for (let idx = 0; idx < pagePositions.length; idx++) {
      if (pagePositions[idx] < charIndex) page++;
      else break;
    }
    return { line, page };
  }

  // Preprocess text to handle PDF line breaks
  const sanitizedText = text.replace(/(?<!\n)\n(?!\n)/g, ' ');

  let i = 0;
  let lastYield = Date.now();

  for (const item of getStitchedSentences(sanitizedText)) {
    // Check for abortion every 10 sentences to avoid overhead
    if (i % 10 === 0 && options.checkAbort && options.checkAbort()) {
      console.log('🛑 extractContexts: Abort signal received');
      return null;
    }

    // Yield to event loop using elapsed time floor (20ms) and safety floor (200 sentences)
    if (Date.now() - lastYield > 20 || i % 200 === 0) {
      await new Promise(resolve => setImmediate(resolve));
      lastYield = Date.now();
    }
    i++;

    const sentence = typeof item === 'string' ? item : item.sentence;
    const charIdx = typeof item === 'object' && item.index !== undefined ? item.index : 0;

    // 1. Hard Filter: Skip bad sentences immediately
    if (!isValidContext(sentence)) continue;

    const sentenceLower = caseSensitive ? sentence : sentence.toLowerCase();
    const wordsInSentence = sentenceLower.match(/\b[a-zA-Z]+\b/g) || [];
    const seenWordsInSentence = new Set();
    const trimmed = sentence.trim();
    const trimmedLower = sentenceLower.trim();

    const { line, page } = getLineAndPage(charIdx);

    // Check each word in the sentence
    for (const word of wordsInSentence) {
      if (seenWordsInSentence.has(word)) continue;
      seenWordsInSentence.add(word);

      if (targetSet.has(word)) {
        if (!wordContexts.has(word)) {
          wordContexts.set(word, []);
        }

        const contexts = wordContexts.get(word);

        // 2. Collect candidates (limit to 50 to avoid memory bloat)
        if (contexts.length < 50) {
          const score = scoreSentence(sentence, word, word, trimmedLower);
          contexts.push(new ContextItem({
            text: trimmed,
            score,
            source: 'document',
            fileName: options.fileName || 'document',
            line,
            page
          }));
        }
      }
    }

    // Check multi-word phrase targets
    for (const phrase of phraseTargets) {
      if (sentenceLower.includes(phrase)) {
        if (!wordContexts.has(phrase)) {
          wordContexts.set(phrase, []);
        }

        const contexts = wordContexts.get(phrase);
        if (contexts.length < 50) {
          const score = scoreSentence(sentence, phrase, phrase, trimmedLower);
          contexts.push(new ContextItem({
            text: trimmed,
            score,
            source: 'document',
            fileName: options.fileName || 'document',
            line,
            page
          }));
        }
      }
    }
  }

  // 3. Sort and Select Top 5 for each word
  const finalContexts = new Map();
  let sortIdx = 0;
  let lastSortYield = Date.now();
  for (const [word, candidates] of wordContexts.entries()) {
    // Yield every 20ms or 200 words during sorting to keep loop responsive
    if (Date.now() - lastSortYield > 20 || sortIdx % 200 === 0) {
      await new Promise(resolve => setImmediate(resolve));
      lastSortYield = Date.now();
    }
    sortIdx++;

    // Sort by score desc, then by length (prefer shorter valid ones if scores tie)
    candidates.sort((a, b) => b.score - a.score);

    // Keep only unique sentences (deduplicate)
    const unique = [];
    const seen = new Set();

    for (const c of candidates) {
      const itemText = typeof c === 'string' ? c : c.text;
      if (!seen.has(itemText)) {
        seen.add(itemText);
        const itemObj = typeof c === 'string'
          ? new ContextItem({ text: c, source: 'document', fileName: options.fileName || 'document', line: 1, page: 1 })
          : (c instanceof ContextItem ? c : new ContextItem(c));
        unique.push(itemObj);
        if (unique.length >= 5) break;
      }
    }

    finalContexts.set(word, unique);
  }

  // 4. For low-frequency words (count >= 1) with 0 valid sentences:
  // Add Fallback Context Window: search first occurrence of \b${word}\b in text, extract ~25 words (~140 chars) snippet around it
  for (const rawTarget of targetWords) {
    const wordKey = caseSensitive ? rawTarget : rawTarget.toLowerCase();
    const existing = finalContexts.get(wordKey);
    if (!existing || existing.length === 0) {
      const regex = new RegExp(`\\b${escapeRegExp(rawTarget)}\\b`, caseSensitive ? '' : 'i');
      const match = regex.exec(text);
      if (match) {
        const matchIdx = match.index;
        const { line, page } = getLineAndPage(matchIdx);
        const start = Math.max(0, matchIdx - 70);
        const end = Math.min(text.length, matchIdx + match[0].length + 70);
        let rawSnippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
        const snippet = (start > 0 ? '... ' : '') + rawSnippet + (end < text.length ? ' ...' : '');
        const fallbackItem = new ContextItem({
          text: snippet,
          score: 0,
          source: 'document',
          fileName: options.fileName || 'document',
          line,
          page,
          isFallbackSnippet: true
        });
        finalContexts.set(wordKey, [fallbackItem]);
      } else {
        if (!finalContexts.has(wordKey)) {
          finalContexts.set(wordKey, []);
        }
      }
    }
  }

  return finalContexts;
}

/**
 * Checks if a sentence is valid for context
 * Rejects: too short, excessive symbols, repeated dots
 */
function isValidContext(sentence) {
  const trimmed = sentence.trim();
  if (trimmed.length < 10) return false; // Too short characters (approx < 2 words)

  const words = trimmed.match(/\b[a-zA-Z]+\b/g) || [];
  if (words.length < 4) return false; // Too few words
  if (words.length > 60) return false; // Too long, likely a list or parsing error

  // Check for excessive non-alphanumeric characters (noise ratio > 30%)
  const nonAlpha = trimmed.replace(/[a-zA-Z0-9\s]/g, '').length;
  if (nonAlpha / trimmed.length > 0.3) return false;

  // Check for "....." or "._._" patterns
  if (/\.{3,}/.test(trimmed)) return false; // 3 or more dots

  return true;
}

/**
 * Scores a sentence based on quality
 */
function scoreSentence(sentence, targetWord, preLowerWord, trimmedLower) {
  let score = 0;
  const trimmed = sentence.trim();

  // 1. Capitalization: Starts with uppercase
  if (/^[A-Z]/.test(trimmed)) score += 2;

  // 2. Punctuation: Ends with proper punctuation
  if (/[.!?]$/.test(trimmed)) score += 1;
  else score -= 1; // Penalize fragmented sentences

  // 3. Length preference: 10-30 words is sweet spot
  const spaces = trimmed.match(/\s+/g);
  const words = spaces ? spaces.length + 1 : 1;
  if (words >= 10 && words <= 30) score += 2;
  else if (words > 30) score += 0; // Neutral
  else score -= 1; // Slightly short

  // 4. Position: Target word is not at the very edges (more context)
  const lowerText = trimmedLower !== undefined ? trimmedLower : trimmed.toLowerCase();
  const lowerWord = preLowerWord !== undefined ? preLowerWord : targetWord.toLowerCase();
  if (!lowerText.startsWith(lowerWord) && !lowerText.endsWith(lowerWord)) {
    score += 1;
  }

  return score;
}

module.exports = { analyzeWordFrequency, extractContexts, isValidContext, scoreSentence, ContextItem };
