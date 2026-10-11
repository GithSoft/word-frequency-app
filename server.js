require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseFile } = require('./src/parsers');
const { analyzeWordFrequency, extractContexts } = require('./src/analyzer');

const { registerPort } = require('./lib/port-manager');

const app = express();
let PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: Infinity }, // No file size limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'text/plain',
            'text/csv'
        ];

        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = ['.pdf', '.docx', '.doc', '.txt', '.csv'];

        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type. Allowed: ${allowedExts.join(', ')}`));
        }
    }
});

// Enable response compression (gzip/deflate)
const compression = require('compression');
app.use(compression({ threshold: 1024, level: 6 }));

// Serve static files
// TODO: Remove no-cache headers in production. Only needed for hot reload during development via tunnel.
// Serve static files with no-cache headers for "hot reload" over tunnel
app.use(express.static('public', {
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
}));
app.use(express.json());

// Routes
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user_words');
const feedbackRoutes = require('./src/routes/feedback');

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/feedback', feedbackRoutes);

// Initialize DB
const { sequelize } = require('./src/models'); // This will sync tables

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Word Frequency Analyzer API' });
});

// In-memory cache for analysis results (bounded to max 50 entries)
const MAX_CACHE_ENTRIES = 50;
const resultsCache = new Map();
const origResultsCacheSet = resultsCache.set.bind(resultsCache);
resultsCache.set = function (key, value) {
    if (this.has(key)) {
        this.delete(key);
    } else if (this.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = this.keys().next().value;
        this.delete(oldestKey);
    }
    return origResultsCacheSet(key, value);
};


// Status endpoint for polling
app.get('/api/analysis/:fileId', (req, res) => {
    const { fileId } = req.params;
    const result = resultsCache.get(fileId);

    if (!result) {
        return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json(result);
});

// Delete analysis result (stops processing if in queue)
app.delete('/api/analysis/:fileId', (req, res) => {
    const { fileId } = req.params;
    if (resultsCache.has(fileId)) {
        console.log(`🗑️ Deleting analysis for fileId: ${fileId}`);
        resultsCache.delete(fileId);
        res.json({ success: true, message: 'Analysis removed' });
    } else {
        res.status(404).json({ error: 'Analysis not found' });
    }
});

// On-demand context extraction endpoint
app.get('/api/analysis/:fileId/context/:word', async (req, res) => {
    try {
        const { fileId, word } = req.params;
        const result = resultsCache.get(fileId);
        if (!result) {
            return res.status(404).json({ error: 'Analysis not found' });
        }

        const targetWord = word.toLowerCase();
        const existing = result.analysis?.results?.find(i => i.word.toLowerCase() === targetWord);
        if (existing && existing.context && existing.context.length > 0) {
            return res.json({ success: true, word: targetWord, context: existing.context });
        }

        if (result.cachePath) {
            try {
                const text = await fs.promises.readFile(result.cachePath, 'utf8');
                const contextMap = await extractContexts(text, [targetWord], { caseSensitive: false });
                const contexts = contextMap.get(targetWord) || [];
                if (existing) {
                    existing.context = contexts;
                }
                return res.json({ success: true, word: targetWord, context: contexts });
            } catch (readErr) {
                console.warn('Failed reading cachePath for on-demand context:', readErr.message);
            }
        }

        res.json({ success: true, word: targetWord, context: [] });
    } catch (err) {
        console.error('Error fetching on-demand context:', err);
        res.status(500).json({ error: 'Failed to extract context', message: err.message });
    }
});

const crypto = require('crypto');

// Helper: Calculate file hash
function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);

        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', err => reject(err));
    });
}

// --- Sequential Context Extraction Queue ---
const analysisQueue = [];
let activeWorkers = 0;
const MAX_CONCURRENT = 2;

async function processNextInQueue() {
    if (activeWorkers >= MAX_CONCURRENT || analysisQueue.length === 0) {
        return;
    }

    activeWorkers++;
    const task = analysisQueue.shift();
    const { fileId, fileName, fileHash, cachePath, fullCachePath } = task;

    try {
        console.log(`\n🧵 [Queue] [Worker ${activeWorkers}] Starting context extraction for: ${fileName}`);
        const contextStart = Date.now();

        const result = resultsCache.get(fileId);
        if (!result || result.status === 'complete') {
            return; // Finally block handles decrement and next trigger
        }

        const text = await fs.promises.readFile(cachePath, 'utf8');
        const analysis = result.analysis;

        const allWords = analysis.results.map(item => item.word);

        const contextMap = await extractContexts(text, allWords, {
            caseSensitive: false,
            checkAbort: () => !resultsCache.has(fileId) // If removed from cache, abort
        });

        if (contextMap === null) {
            console.log(`🛑 [Queue] Cancelled mid-process for: ${fileName}`);
            return;
        }

        analysis.results.forEach(item => {
            if (contextMap.has(item.word)) {
                item.context = contextMap.get(item.word);
            }
        });

        resultsCache.set(fileId, {
            status: 'complete',
            fileName,
            analysis
        });

        // Save to JSON cache
        await fs.promises.writeFile(fullCachePath, JSON.stringify(analysis));
        console.log(`💾 [Queue] Saved full analysis to cache: ${fileHash}`);
        console.log(`✅ [Queue] Finished ${fileName} in ${((Date.now() - contextStart) / 1000).toFixed(2)}s`);

    } catch (err) {
        console.error(`❌ [Queue] Failed for ${fileName}:`, err);
        const result = resultsCache.get(fileId);
        if (result) {
            resultsCache.set(fileId, {
                status: 'error',
                error: err.message,
                fileName,
                analysis: result.analysis
            });
        }
    } finally {
        activeWorkers--;
        // Trigger next task as soon as one worker is free
        processNextInQueue();
    }

    // Attempt to start another worker if we have capacity
    processNextInQueue();
}

// File upload and analysis endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const fileName = req.file.originalname;
        const fileId = req.file.filename;

        // 0. Calculate Hash & Check Cache
        const fileHash = await calculateFileHash(filePath);
        const cacheDir = path.join(__dirname, 'uploads', 'cache');

        const cachePath = path.join(cacheDir, `${fileHash}.txt`);
        const fullCachePath = path.join(cacheDir, `${fileHash}.json`);
        let text = '';

        // 1. Check Full Result Cache (INSTANT RESPONSE)
        try {
            const fileContent = await fs.promises.readFile(fullCachePath, 'utf8');
            console.log(`🚀 Full analysis cache hit for ${fileName} (${fileHash})`);
            const analysis = JSON.parse(fileContent);

            // Clean up original upload
            try {
                await fs.promises.unlink(filePath);
            } catch { }

            resultsCache.set(fileId, {
                status: 'complete',
                fileName,
                analysis
            });

            return res.json({
                success: true,
                fileName,
                fileId,
                analysis,
                status: 'complete'
            });
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`Warning reading fullCachePath: ${err.message}`);
            }
        }

        // 2. Check Text Cache
        try {
            text = await fs.promises.readFile(cachePath, 'utf8');
            console.log(`⚡ Text cache hit for ${fileName} (${fileHash}). Reading text...`);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`Warning reading cachePath: ${err.message}`);
            }

            // Parse file
            const parseStart = Date.now();
            console.log(`📄 Parsing file: ${fileName}...`);
            text = await parseFile(filePath, req.file.mimetype);
            console.log(`✓ Parsed in ${((Date.now() - parseStart) / 1000).toFixed(2)}s`);

            // Save to cache
            if (text && text.trim().length > 0) {
                try {
                    await fs.promises.mkdir(cacheDir, { recursive: true });
                } catch { }
                await fs.promises.writeFile(cachePath, text);
                console.log(`💾 Saved parsed text to cache: ${fileHash}`);
            }
        }

        // Clean up original upload after parsing/cache check
        try {
            await fs.promises.unlink(filePath);
        } catch { }

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ error: 'No text content found in file' });
        }

        // 3. Immediate Analysis (Counts only)
        const analyzeStart = Date.now();
        console.log(`📊 Analyzing word frequency (counts only)...`);

        const analysis = await analyzeWordFrequency(text, {
            minLength: 3,
            maxResults: Infinity,
            caseSensitive: false,
            includeStopwords: false,
            skipContext: true
        });

        console.log(`✓ Analyzed counts for ${fileName} in ${((Date.now() - analyzeStart) / 1000).toFixed(2)}s`);

        resultsCache.set(fileId, {
            status: 'processing',
            fileName,
            analysis,
            // Meta for deferred processing
            fileHash,
            cachePath,
            fullCachePath
        });

        res.json({
            success: true,
            fileName,
            fileId,
            analysis,
            status: 'processing'
        });

        // NOTE: We NO LONGER start background context extraction here.
        // It must be triggered via /api/analysis/process-batch

    } catch (error) {
        console.error('Error processing file:', error);
        if (req.file) {
            try {
                await fs.promises.access(req.file.path);
                await fs.promises.unlink(req.file.path);
            } catch { }
        }
        res.status(500).json({ error: 'Failed to process file', message: error.message });
    }
});

// Trigger batch context extraction
app.post('/api/analysis/process-batch', async (req, res) => {
    const { fileIds } = req.body;
    if (!fileIds || !Array.isArray(fileIds)) {
        return res.status(400).json({ error: 'Invalid fileIds array' });
    }

    console.log(`\n📥 Received batch process request for ${fileIds.length} files`);

    let addedCount = 0;
    fileIds.forEach(fileId => {
        const result = resultsCache.get(fileId);
        if (result && result.status === 'processing') {
            analysisQueue.push({
                fileId,
                fileName: result.fileName,
                fileHash: result.fileHash,
                cachePath: result.cachePath,
                fullCachePath: result.fullCachePath
            });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        processNextInQueue();
    }

    res.json({ success: true, queued: addedCount });
});

// Start server
async function start() {
    try {
        if (!process.env.PORT) {
            PORT = await registerPort();
        }
    } catch (e) {
        console.error('[PortManager] Failed to register port, using default:', PORT);
    }
    app.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log(`📊 Upload files to analyze word frequency`);
    });
}

start().catch(console.error);
