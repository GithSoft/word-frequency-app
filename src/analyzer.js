/**
 * Word Frequency Analyzer
 * Tokenizes text and analyzes word frequency
 */

// Common English stopwords
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
  'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us'
]);

const abbrRegex = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g)\.$/i;
const singleLetterRegex = /\b[A-Za-z]\.$/;
const numRegex = /\b\d+\.$/;

/**
 * Generator that stitches sentence segments split incorrectly across abbreviations or decimal numbers
 * @param {string} rawText
 */
function* getStitchedSentences(rawText) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  let pending = '';

  for (const { segment } of segmenter.segment(rawText)) {
    if (!pending) {
      pending = segment;
      continue;
    }

    const trimmed = pending.trimEnd();
    const isAbbr = abbrRegex.test(trimmed) || singleLetterRegex.test(trimmed) || numRegex.test(trimmed);
    const nextTrimmed = segment.trimStart();
    const nextStartsWordOrNum = /^[\w\d]/.test(nextTrimmed);

    if (isAbbr && nextStartsWordOrNum) {
      pending += segment;
    } else {
      yield pending;
      pending = segment;
    }
  }

  if (pending) {
    yield pending;
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

  // Stream regex matching directly over text to avoid creating large intermediate arrays
  const regex = /\b[a-zA-Z]+\b/g;
  let match;
  const frequencyMap = new Map();
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

    // Filter by length
    if (word.length < minLength) continue;

    // Filter stopwords
    if (!includeStopwords && STOPWORDS.has(word)) continue;

    totalWords++;
    frequencyMap.set(word, (frequencyMap.get(word) || 0) + 1);
  }

  // Initial results without context
  let results = Array.from(frequencyMap.entries())
    .map(([word, count]) => ({
      word,
      count,
      percentage: totalWords > 0 ? ((count / totalWords) * 100).toFixed(2) : 0,
      context: [] // Empty initially
    }))
    .sort((a, b) => b.count - a.count);

  // If we're skipping context, return early
  if (skipContext) {
    // Only slice if maxResults is finite
    if (isFinite(maxResults) && maxResults > 0) {
      results = results.slice(0, maxResults);
    }

    return {
      results,
      totalWords,
      uniqueWords: frequencyMap.size,
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

  const contextMap = await extractContexts(text, topWords, { caseSensitive });

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
    totalWords,
    uniqueWords: frequencyMap.size,
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
 * @returns {Map<string, string[]>} Map of word -> context sentences
 */
async function extractContexts(text, targetWords, options = {}) {
  const { caseSensitive = false } = options;
  const wordContexts = new Map(); // word -> Array<{ text: string, score: number }>
  const targetWordsNorm = caseSensitive ? targetWords : targetWords.map(w => w.toLowerCase());
  const targetSet = new Set(targetWordsNorm);

  // Preprocess text to handle PDF line breaks
  const sanitizedText = text.replace(/(?<!\n)\n(?!\n)/g, ' ');

  let i = 0;
  let lastYield = Date.now();

  for (const sentence of getStitchedSentences(sanitizedText)) {
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

    // 1. Hard Filter: Skip bad sentences immediately
    if (!isValidContext(sentence)) continue;

    const sentenceLower = caseSensitive ? sentence : sentence.toLowerCase();
    const wordsInSentence = sentenceLower.match(/\b[a-zA-Z]+\b/g) || [];
    const seenWordsInSentence = new Set();
    const trimmed = sentence.trim();
    const trimmedLower = sentenceLower.trim();

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
          contexts.push({ text: trimmed, score });
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
      if (!seen.has(c.text)) {
        seen.add(c.text);
        unique.push(c.text);
        if (unique.length >= 5) break;
      }
    }

    finalContexts.set(word, unique);
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

module.exports = { analyzeWordFrequency, extractContexts, isValidContext, scoreSentence };
