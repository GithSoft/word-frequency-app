const assert = require('assert');
const dictService = require('../src/dictionary-service');
const { extractContexts } = require('../src/analyzer');

console.log('🧪 Starting Multi-Tier Smart Dictionary & Context Provenance Tests...\n');

async function runTests() {
    try {
        const db = await dictService.getDb();

        // -------------------------------------------------------------
        // Test 1: Offline lookup for 'incentive' (Lingoes 109k, ~0ms)
        // -------------------------------------------------------------
        console.log('--- Test 1: Offline lookup for "incentive" ---');
        const startOffline = Date.now();
        const resOffline = await dictService.lookup('incentive');
        const durationOffline = Date.now() - startOffline;

        console.log(`✓ Lookup took ${durationOffline}ms`);
        assert.strictEqual(resOffline.word, 'incentive', 'Word should be normalized to "incentive"');
        assert.strictEqual(resOffline.source, 'offline_lingoes', 'Source should be "offline_lingoes"');
        assert.ok(resOffline.phonetic.includes('sentiv'), `Phonetic should be present, got: ${resOffline.phonetic}`);
        assert.ok(Array.isArray(resOffline.meanings) && resOffline.meanings.length > 0, 'Meanings should be non-empty');
        assert.ok(Array.isArray(resOffline.examples) && resOffline.examples.length > 0, 'Examples should be non-empty');
        console.log('✅ Test 1 Passed: Offline lookup succeeded.\n');

        // -------------------------------------------------------------
        // Test 2: Morphological Lemmatizer lookup for 'incentives' (0ms)
        // -------------------------------------------------------------
        console.log('--- Test 2: Lemmatizer lookup for "incentives" ---');
        const startLemma = Date.now();
        const resLemma = await dictService.lookup('incentives');
        const durationLemma = Date.now() - startLemma;

        console.log(`✓ Lemmatizer lookup took ${durationLemma}ms`);
        assert.strictEqual(resLemma.word, 'incentives', 'Word should be "incentives"');
        assert.strictEqual(resLemma.lemma, 'incentive', 'Lemma should resolve to "incentive"');
        assert.strictEqual(resLemma.source, 'offline_lingoes', 'Source should be "offline_lingoes"');
        assert.ok(resLemma.meanings.length > 0, 'Meanings should be populated from lemma');
        console.log('✅ Test 2 Passed: Morphological Lemmatizer succeeded.\n');

        // -------------------------------------------------------------
        // Test 3: Online backup + auto-cache for 'refactored'
        // -------------------------------------------------------------
        console.log('--- Test 3: Online backup + auto-cache for "refactored" ---');
        // Clear from cache to test live fetch
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM online_cache WHERE word = ?', ['refactored'], err => err ? reject(err) : resolve());
        });

        const startOnline = Date.now();
        const resOnline = await dictService.lookup('refactored');
        const durationOnline = Date.now() - startOnline;

        console.log(`✓ Online lookup took ${durationOnline}ms, source: ${resOnline.source}`);
        assert.strictEqual(resOnline.word, 'refactored', 'Word should be "refactored"');
        assert.strictEqual(resOnline.source, 'online_wiktionary', 'Source should be "online_wiktionary"');
        assert.ok(resOnline.meanings.length > 0, 'Should have parsed meanings from Wiktionary');

        // Verify that it was saved into online_cache SQLite table
        const cachedRow = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM online_cache WHERE word = ?', ['refactored'], (err, row) => err ? reject(err) : resolve(row));
        });
        assert.ok(cachedRow, 'Row should exist in online_cache SQLite table');
        assert.strictEqual(cachedRow.word, 'refactored', 'Cached word should be "refactored"');
        assert.strictEqual(cachedRow.source, 'online_wiktionary', 'Cached source should be "online_wiktionary"');

        // Verify second lookup hits online_cache table immediately
        const startCached = Date.now();
        const resCached = await dictService.lookup('refactored');
        const durationCached = Date.now() - startCached;
        console.log(`✓ Cached lookup took ${durationCached}ms, source: ${resCached.source}`);
        assert.strictEqual(resCached.source, 'online_wiktionary');
        console.log('✅ Test 3 Passed: Online backup and SQLite auto-cache verified.\n');

        // -------------------------------------------------------------
        // Test 4: Datamuse API Fallback
        // -------------------------------------------------------------
        console.log('--- Test 4: Datamuse API Fallback ---');
        // Temporarily intercept global fetch to simulate Wiktionary failure for a test word
        const originalFetch = global.fetch;
        const testFallbackWord = 'cybersecurity';

        await new Promise((resolve, reject) => {
            db.run('DELETE FROM online_cache WHERE word = ?', [testFallbackWord], err => err ? reject(err) : resolve());
        });

        global.fetch = async (url, opts) => {
            if (typeof url === 'string' && url.includes('wiktionary.org')) {
                // Simulate Wiktionary 404/failure
                return { ok: false, status: 404, json: async () => ({}) };
            }
            return originalFetch(url, opts);
        };

        try {
            const resDatamuse = await dictService.lookup(testFallbackWord);
            console.log(`✓ Datamuse fallback result source: ${resDatamuse.source}, meanings: ${resDatamuse.meanings.length}`);
            assert.strictEqual(resDatamuse.source, 'online_datamuse', 'Source should fallback to "online_datamuse"');
            assert.ok(resDatamuse.meanings.length > 0, 'Datamuse should return meanings');

            // Verify auto-cache for datamuse result
            const dmCachedRow = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM online_cache WHERE word = ?', [testFallbackWord], (err, row) => err ? reject(err) : resolve(row));
            });
            assert.ok(dmCachedRow, 'Datamuse result should be cached in online_cache');
            assert.strictEqual(dmCachedRow.source, 'online_datamuse');
            console.log('✅ Test 4 Passed: Datamuse API fallback and caching verified.\n');
        } finally {
            global.fetch = originalFetch;
        }

        // -------------------------------------------------------------
        // Test 5: Document Context Provenance Tracking (line & page)
        // -------------------------------------------------------------
        console.log('--- Test 5: Document context line & page provenance ---');
        const multilineDoc = `Introductory header line here.
Line 2 introduces an important incentive for everyone.
Line 3 continues the discussion.
\fPage 2 starts now on line 4.
Line 5 provides another powerful incentive for growth.
Line 6 concludes this document section.`;

        const ctxMap = await extractContexts(multilineDoc, ['incentive'], {
            fileName: 'quarterly_report.pdf',
            caseSensitive: false
        });

        const contexts = ctxMap.get('incentive');
        assert.ok(contexts && contexts.length === 2, `Should find 2 contexts, got ${contexts?.length}`);

        const ctxPage1 = contexts.find(c => c.page === 1);
        const ctxPage2 = contexts.find(c => c.page === 2);

        assert.ok(ctxPage1, 'Page 1 occurrence should exist');
        assert.ok(ctxPage2, 'Page 2 occurrence should exist');

        console.log('Page 1 context:', JSON.stringify(ctxPage1));
        assert.strictEqual(ctxPage1.fileName, 'quarterly_report.pdf', 'fileName should be quarterly_report.pdf');
        assert.strictEqual(ctxPage1.source, 'document', 'source should be "document"');
        assert.strictEqual(ctxPage1.line, 2, 'First occurrence should be at line 2');
        assert.strictEqual(ctxPage1.page, 1, 'First occurrence should be at page 1');

        console.log('Page 2 context:', JSON.stringify(ctxPage2));
        assert.strictEqual(ctxPage2.fileName, 'quarterly_report.pdf', 'fileName should be quarterly_report.pdf');
        assert.strictEqual(ctxPage2.source, 'document', 'source should be "document"');
        assert.strictEqual(ctxPage2.page, 2, 'Second occurrence should be at page 2');
        console.log('✅ Test 5 Passed: Line and page provenance tracked accurately.\n');

        // -------------------------------------------------------------
        // Test 6: Dictionary Fallback Example for Custom Words
        // -------------------------------------------------------------
        console.log('--- Test 6: Dictionary fallback example for custom words ---');
        const textWithoutWord = 'This document has basic text about apples and bananas only.';
        const targetCustomWord = 'incentive';

        // Extract contexts from text where word does not occur
        const emptyCtxMap = await extractContexts(textWithoutWord, [targetCustomWord], {
            fileName: 'fruits.txt'
        });
        let wordContexts = emptyCtxMap.get(targetCustomWord) || [];
        assert.strictEqual(wordContexts.length, 0, 'Contexts from document should be empty');

        // Simulate server fallback logic (when contexts.length === 0, fetch dictionary examples)
        const dictFallback = await dictService.lookup(targetCustomWord);
        if (wordContexts.length === 0 && dictFallback.examples && dictFallback.examples.length > 0) {
            wordContexts = dictFallback.examples.map(ex => ({
                text: ex.en || ex.example,
                translation: ex.vi || '',
                source: 'dictionary',
                dictName: 'Lingoes'
            }));
        }

        assert.ok(wordContexts.length > 0, 'Fallback examples should be populated from dictionary');
        assert.strictEqual(wordContexts[0].source, 'dictionary', 'Source should be marked as "dictionary"');
        assert.strictEqual(wordContexts[0].dictName, 'Lingoes', 'dictName should be "Lingoes"');
        assert.ok(wordContexts[0].translation, 'Vietnamese translation should be present');
        console.log('Fallback example:', JSON.stringify(wordContexts[0]));
        console.log('✅ Test 6 Passed: Dictionary fallback example populated successfully.\n');

        await dictService.close();

        console.log('🎉 ALL 6 DICTIONARY & PROVENANCE TESTS PASSED!\n');
        process.exit(0);

    } catch (err) {
        console.error('❌ Test failed with error:', err);
        try { await dictService.close(); } catch {}
        process.exit(1);
    }
}

runTests();
