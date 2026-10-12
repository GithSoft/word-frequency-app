/**
 * Multi-Tier Smart Dictionary Service
 * Backed by SQLite (data/dictionary.db), Morphological Lemmatizer,
 * and Online Fallbacks (Wiktionary REST API -> Datamuse API) with auto-cache.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

let db = null;
let initPromise = null;

const POS_MAP = {
    n: 'danh từ',
    v: 'động từ',
    adj: 'tính từ',
    adv: 'phó từ',
    prep: 'giới từ',
    conj: 'liên từ',
    pron: 'đại từ',
    interj: 'thán từ'
};

function safeJsonParse(str, fallback = []) {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

function getDb() {
    if (initPromise) return initPromise;
    initPromise = new Promise((resolve, reject) => {
        const dbPath = process.env.DICTIONARY_DB_PATH || path.join(__dirname, '../data/dictionary.db');
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const database = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('[DictionaryService] Failed to open SQLite database:', err);
                initPromise = null;
                return reject(err);
            }
            database.exec(`
                CREATE TABLE IF NOT EXISTS entries (word TEXT PRIMARY KEY, phonetic TEXT, meanings TEXT, examples TEXT);
                CREATE TABLE IF NOT EXISTS online_cache (word TEXT PRIMARY KEY, phonetic TEXT, meanings TEXT, examples TEXT, source TEXT, created_at INTEGER);
                CREATE INDEX IF NOT EXISTS idx_entries_word ON entries(word);
                CREATE INDEX IF NOT EXISTS idx_online_cache_word ON online_cache(word);
            `, (schemaErr) => {
                if (schemaErr) {
                    console.error('[DictionaryService] Failed to initialize schema:', schemaErr);
                    initPromise = null;
                    return reject(schemaErr);
                }
                db = database;
                resolve(database);
            });
        });
    });
    return initPromise;
}

async function dbGet(sql, params = []) {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function dbRun(sql, params = []) {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        database.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

/**
 * Generate morphological variants for English words
 * Handles -ies, -ied, -es, -s, -ing, -ed, -ly
 */
function getMorphologicalVariants(word) {
    const variants = new Set();

    // -ies -> -y (parties -> party)
    if (word.endsWith('ies') && word.length > 3) {
        variants.add(word.slice(0, -3) + 'y');
    }

    // -ied -> -y (carried -> carry)
    if (word.endsWith('ied') && word.length > 3) {
        variants.add(word.slice(0, -3) + 'y');
    }

    // -es -> "" or "e" (boxes -> box, changes -> change)
    if (word.endsWith('es') && word.length > 3) {
        variants.add(word.slice(0, -2));
        variants.add(word.slice(0, -1));
    }

    // -s -> "" (except ending in 'ss') (cats -> cat, incentives -> incentive)
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) {
        variants.add(word.slice(0, -1));
    }

    // -ing -> "", "e", and consonant un-doubling (running -> run, making -> make, playing -> play)
    if (word.endsWith('ing') && word.length > 4) {
        const stem = word.slice(0, -3);
        variants.add(stem);
        variants.add(stem + 'e');
        if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
            variants.add(stem.slice(0, -1));
        }
    }

    // -ed -> "", "e", and consonant un-doubling (stopped -> stop, liked -> like, played -> play)
    if (word.endsWith('ed') && word.length > 3) {
        const stem = word.slice(0, -2);
        variants.add(stem);
        variants.add(stem + 'e');
        if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
            variants.add(stem.slice(0, -1));
        }
    }

    // -ly -> "" (quickly -> quick, happily -> happy)
    if (word.endsWith('ly') && word.length > 3) {
        variants.add(word.slice(0, -2));
        if (word.endsWith('ily') && word.length > 4) {
            variants.add(word.slice(0, -3) + 'y');
        }
    }

    return Array.from(variants).filter(v => v.length > 0 && v !== word);
}

/**
 * Look up word definitions across all tiers:
 * 1. Offline Lingoes dictionary (SQLite entries table)
 * 2. SQLite online_cache table
 * 3. Morphological Lemmatizer (offline entries)
 * 4. Online Wiktionary REST API (cached to SQLite)
 * 5. Online Datamuse API (cached to SQLite)
 * 6. Fallback none
 */
async function lookup(word) {
    if (!word || typeof word !== 'string') {
        return { word: '', phonetic: '', meanings: [], examples: [], source: 'none' };
    }

    const target = word.toLowerCase().trim();
    if (!target) {
        return { word: '', phonetic: '', meanings: [], examples: [], source: 'none' };
    }

    // Step 1: Query entries table (offline dictionary)
    try {
        const entryRow = await dbGet('SELECT * FROM entries WHERE word = ?', [target]);
        if (entryRow) {
            return {
                word: target,
                phonetic: entryRow.phonetic || '',
                meanings: safeJsonParse(entryRow.meanings),
                examples: safeJsonParse(entryRow.examples),
                source: 'offline_lingoes'
            };
        }
    } catch (err) {
        console.warn(`[DictionaryService] Error querying entries for "${target}":`, err.message);
    }

    // Step 2: Query online_cache table
    try {
        const cacheRow = await dbGet('SELECT * FROM online_cache WHERE word = ?', [target]);
        if (cacheRow) {
            return {
                word: target,
                phonetic: cacheRow.phonetic || '',
                meanings: safeJsonParse(cacheRow.meanings),
                examples: safeJsonParse(cacheRow.examples),
                source: cacheRow.source || 'online_cache'
            };
        }
    } catch (err) {
        console.warn(`[DictionaryService] Error querying online_cache for "${target}":`, err.message);
    }

    // Step 3: Morphological Lemmatizer (0ms check against entries)
    try {
        const variants = getMorphologicalVariants(target);
        for (const variant of variants) {
            const lemmaRow = await dbGet('SELECT * FROM entries WHERE word = ?', [variant]);
            if (lemmaRow) {
                return {
                    word: target,
                    lemma: variant,
                    phonetic: lemmaRow.phonetic || '',
                    meanings: safeJsonParse(lemmaRow.meanings),
                    examples: safeJsonParse(lemmaRow.examples),
                    source: 'offline_lingoes'
                };
            }
        }
    } catch (err) {
        console.warn(`[DictionaryService] Error in lemmatization for "${target}":`, err.message);
    }

    // Step 4: Online Backup 1 - Wiktionary REST API (2.5s timeout)
    try {
        const wikRes = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(target)}`, {
            signal: AbortSignal.timeout(2500),
            headers: {
                'User-Agent': 'WordFrequencyAnalyzer/1.0 (academic; dictionary-service)',
                'Accept': 'application/json'
            }
        });

        if (wikRes.ok) {
            const data = await wikRes.json();
            if (data && Array.isArray(data.en) && data.en.length > 0) {
                const meanings = [];
                const examples = [];

                for (const item of data.en) {
                    const pos = item.partOfSpeech || '';
                    if (Array.isArray(item.definitions)) {
                        for (const d of item.definitions) {
                            if (d.definition) {
                                const cleanDef = d.definition.replace(/<[^>]+>/g, '').trim();
                                if (cleanDef) {
                                    meanings.push({ pos, def: cleanDef });
                                }
                            }
                            if (Array.isArray(d.examples)) {
                                for (const ex of d.examples) {
                                    if (typeof ex === 'string') {
                                        const cleanEx = ex.replace(/<[^>]+>/g, '').trim();
                                        if (cleanEx) {
                                            examples.push({ en: cleanEx, vi: '' });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (meanings.length > 0) {
                    try {
                        await dbRun(
                            'INSERT OR REPLACE INTO online_cache (word, phonetic, meanings, examples, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                            [target, '', JSON.stringify(meanings), JSON.stringify(examples), 'online_wiktionary', Date.now()]
                        );
                    } catch (cacheErr) {
                        console.warn(`[DictionaryService] Failed to cache Wiktionary result for "${target}":`, cacheErr.message);
                    }

                    return {
                        word: target,
                        phonetic: '',
                        meanings,
                        examples,
                        source: 'online_wiktionary'
                    };
                }
            }
        }
    } catch (err) {
        // Wiktionary failed or timed out, continue to Step 5
    }

    // Step 5: Online Backup 2 - Datamuse API (2.5s timeout)
    try {
        const dmRes = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(target)}&md=d&max=1`, {
            signal: AbortSignal.timeout(2500),
            headers: {
                'Accept': 'application/json'
            }
        });

        if (dmRes.ok) {
            const dmData = await dmRes.json();
            if (Array.isArray(dmData) && dmData.length > 0 && Array.isArray(dmData[0].defs) && dmData[0].defs.length > 0) {
                const meanings = [];
                for (const defStr of dmData[0].defs) {
                    const parts = defStr.split('\t');
                    if (parts.length >= 2) {
                        const rawPos = parts[0].trim();
                        const def = parts.slice(1).join('\t').trim();
                        const pos = POS_MAP[rawPos] || rawPos;
                        meanings.push({ pos, def });
                    } else if (parts.length === 1 && parts[0].trim()) {
                        meanings.push({ pos: '', def: parts[0].trim() });
                    }
                }

                if (meanings.length > 0) {
                    try {
                        await dbRun(
                            'INSERT OR REPLACE INTO online_cache (word, phonetic, meanings, examples, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                            [target, '', JSON.stringify(meanings), JSON.stringify([]), 'online_datamuse', Date.now()]
                        );
                    } catch (cacheErr) {
                        console.warn(`[DictionaryService] Failed to cache Datamuse result for "${target}":`, cacheErr.message);
                    }

                    return {
                        word: target,
                        phonetic: '',
                        meanings,
                        examples: [],
                        source: 'online_datamuse'
                    };
                }
            }
        }
    } catch (err) {
        // Datamuse failed or timed out
    }

    // Step 6: All failed
    return {
        word: target,
        phonetic: '',
        meanings: [],
        examples: [],
        source: 'none'
    };
}

async function close() {
    if (db) {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                db = null;
                initPromise = null;
                if (err) return reject(err);
                resolve();
            });
        });
    }
}

module.exports = {
    lookup,
    close,
    getDb,
    getMorphologicalVariants
};
