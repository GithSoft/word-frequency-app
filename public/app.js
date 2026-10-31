/**
 * WordRadar - Frontend Application
 * Handles file uploads, caching, vocabulary saving, and visualization
 */

// ==========================================
// State Management
// ==========================================
let filesData = JSON.parse(localStorage.getItem('wfa_files') || '{}');
let savedWords = JSON.parse(localStorage.getItem('wfa_saved') || '[]');
let savedMetadata = JSON.parse(localStorage.getItem('wfa_meta') || '{}');
let savedSubfilter = 'all'; // 'all' | 'words' | 'phrases'
let selectedFiles = new Set(); // Multi-select files
let showSavedOnly = false;

function isPhraseItem(word) {
    if (!word) return false;
    const lower = word.toLowerCase();
    if (savedMetadata[lower]?.type) {
        return savedMetadata[lower].type === 'phrase';
    }
    return word.trim().includes(' ');
}

function updateHeaderSavedCount() {
    const el = document.getElementById('headerSavedCount');
    if (el) el.textContent = savedWords.length.toLocaleString();
}

// DOM Elements
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const uploadCard = document.querySelector('.upload-card');
const resultsSection = document.getElementById('resultsSection');
const errorToast = document.getElementById('errorToast');
const errorMessage = document.getElementById('errorMessage');
const newAnalysisBtn = document.getElementById('newAnalysisBtn');
const searchBox = document.getElementById('searchBox');
const exportBtn = document.getElementById('exportBtn');
const tableBody = document.getElementById('tableBody');
const fileSelector = document.getElementById('fileSelector');
const savedCountEl = document.getElementById('savedCount');
const contextModalEl = document.getElementById('contextModal');

// ==========================================
// PWA & Service Worker Registration
// ==========================================
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof location !== 'undefined' && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('WordRadar ServiceWorker registered:', reg.scope))
            .catch(() => {});
    });
}

// ==========================================
// Known Words (Personal Lexicon / Exclusion)
// ==========================================
let knownWords = new Set(JSON.parse(localStorage.getItem('wordradar_known_words') || '[]'));

function toggleKnownWord(word) {
    if (!word) return;
    const lower = word.toLowerCase().trim();
    if (knownWords.has(lower)) {
        knownWords.delete(lower);
        showSuccess(`Đã bỏ đánh dấu "${word}" khỏi danh sách đã biết.`);
    } else {
        knownWords.add(lower);
        showSuccess(`Đã đánh dấu "${word}" là từ đã biết!`);
    }
    localStorage.setItem('wordradar_known_words', JSON.stringify(Array.from(knownWords)));

    const knownBadge = document.getElementById('knownCountBadge');
    if (knownBadge) knownBadge.textContent = knownWords.size.toLocaleString();

    invalidateAggregatedData();
    renderTable();
    updateStats();
}
window.toggleKnownWord = toggleKnownWord;

// ==========================================
// Table View Tabs (Words / Collocations / Series)
// ==========================================
let currentTableView = 'words'; // 'words' | 'collocations' | 'series'
const tabWords = document.getElementById('tabWords');
const tabCollocations = document.getElementById('tabCollocations');
const tabSeriesProgression = document.getElementById('tabSeriesProgression');
const tableTitleDisplay = document.getElementById('tableTitleDisplay');
const hideKnownCheckbox = document.getElementById('hideKnownCheckbox');

function setTableView(view) {
    currentTableView = view;
    if (tabWords) tabWords.classList.toggle('active', view === 'words');
    if (tabCollocations) tabCollocations.classList.toggle('active', view === 'collocations');
    if (tabSeriesProgression) tabSeriesProgression.classList.toggle('active', view === 'series');

    if (tableTitleDisplay) {
        if (view === 'collocations') tableTitleDisplay.textContent = 'Collocations & Phrases';
        else if (view === 'series') tableTitleDisplay.textContent = 'Series Progression (New Vocabulary in Sequel)';
        else tableTitleDisplay.textContent = 'Word Frequency Data';
    }

    renderTable();
}

if (tabWords) tabWords.addEventListener('click', () => setTableView('words'));
if (tabCollocations) tabCollocations.addEventListener('click', () => setTableView('collocations'));
if (tabSeriesProgression) tabSeriesProgression.addEventListener('click', () => setTableView('series'));

if (hideKnownCheckbox) {
    hideKnownCheckbox.addEventListener('change', () => {
        updateTable();
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

function escapeRegExp(string) {
    if (!string) return '';
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightWordInText(text, word) {
    if (!text) return '';
    if (!word) return escapeHtml(text);
    try {
        const pattern = escapeRegExp(word);
        const regex = new RegExp(`(?:\\b|^)${pattern}(?:\\b|$)`, 'gi');
        let result = '';
        let lastIdx = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
            result += escapeHtml(text.slice(lastIdx, match.index));
            result += `<strong>${escapeHtml(match[0])}</strong>`;
            lastIdx = regex.lastIndex;
            if (!regex.global) break;
        }
        result += escapeHtml(text.slice(lastIdx));
        return result || escapeHtml(text);
    } catch {
        return escapeHtml(text);
    }
}

// ==========================================
// Initialization
// ==========================================
function init() {
    updateHeaderSavedCount();
    const knownBadge = document.getElementById('knownCountBadge');
    if (knownBadge) knownBadge.textContent = knownWords.size.toLocaleString();

    // Fetch and sync active app version dynamically from server package.json
    fetch('/api/version')
        .then(res => res.json())
        .then(data => {
            const versionEl = document.getElementById('footerVersion');
            if (versionEl && data.version) {
                versionEl.textContent = `v${data.version}`;
            }
        })
        .catch(() => {});

    const hasFiles = Object.keys(filesData).length > 0;
    const hasSaved = savedWords.length > 0;

    if (hasFiles) {
        selectedFiles = new Set(Object.keys(filesData));
        showResults();

        // Resume polling for processing files
        Object.values(filesData).forEach(file => {
            if (file.status === 'processing' && file.fileId) {
                fetchContexts(file.fileId, file.fileName);
            }
        });
    } else if (hasSaved) {
        showSavedOnly = true;
        showResults();
    } else {
        resetUpload();
    }
}

// ==========================================
// File Upload Handling
// ==========================================
uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length) processFiles(Array.from(fileInput.files));
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) processFiles(Array.from(e.dataTransfer.files));
});

// ==========================================
// File Upload & Analysis
// ==========================================
async function processFiles(files) {
    const allowedExts = ['pdf', 'docx', 'doc', 'txt', 'csv'];

    // Filter valid files
    const validFiles = files.filter(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        return allowedExts.includes(ext); // No size limit
    });

    if (validFiles.length === 0) {
        showError(`Unsupported files or file too large. Allowed: ${allowedExts.join(', ')}`);
        return;
    }

    uploadZone.style.display = 'none';
    uploadProgress.style.display = 'block';

    let completed = 0;
    const startTime = Date.now();

    const updateProgress = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        document.querySelector('.progress-text').textContent =
            `Analyzing ${completed}/${validFiles.length} documents... (${elapsed}s)`;
    };
    updateProgress();

    console.log(`📤 Starting parallel upload of ${validFiles.length} files...`);

    const uploadedFileIds = [];

    try {
        await Promise.all(validFiles.map(async (file) => {
            const fileStartTime = Date.now();
            try {
                const data = await uploadSingleFile(file);
                if (data && data.status === 'processing') {
                    uploadedFileIds.push(data.fileId);
                }
                const fileTime = ((Date.now() - fileStartTime) / 1000).toFixed(2);
                console.log(`✅ ${file.name} processed in ${fileTime}s`);

                // NEW: Incremental UI Update
                renderIncrementalResults();
            } catch (err) {
                console.error(`❌ Failed to process ${file.name}:`, err);
                showError(`Failed to process ${file.name}`);
            } finally {
                completed++;
                updateProgress();
            }
        }));

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`🎉 All ${validFiles.length} files uploaded in ${totalTime}s`);

        // Trigger batch context extraction AFTER all uploads are done
        if (uploadedFileIds.length > 0) {
            console.log(`🚀 Triggering batch context extraction for ${uploadedFileIds.length} files...`);
            fetch('/api/analysis/process-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileIds: uploadedFileIds })
            }).catch(err => console.error('Failed to trigger batch processing:', err));
        }

        showResults();

    } catch (error) {
        console.error('Batch processing error:', error);
        // Explicitly cleanup any files that might have been partially added/errored
        updateFileSelector();
        updateStats();
        resetUpload();
    }
}

async function uploadSingleFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to process file');
    }

    const data = await response.json();

    // Store immediate results
    filesData[data.fileName] = {
        fileName: data.fileName,
        fileId: data.fileId,
        analysis: data.analysis,
        uploadedAt: new Date().toISOString(),
        status: data.status || 'processing' // Check if already complete from cache
    };
    saveFilesData();

    // Auto-select new file
    selectedFiles.add(data.fileName);

    // Start polling if still processing
    if (filesData[data.fileName].status === 'processing') {
        fetchContexts(data.fileId, data.fileName);
    }

    return data;
}

async function fetchContexts(fileId, fileName) {
    if (!fileId) return;

    const pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/analysis/${fileId}`);
            if (!res.ok) {
                if (res.status === 404) clearInterval(pollInterval);
                return;
            }

            const data = await res.json();

            if (data.status === 'complete') {
                clearInterval(pollInterval);
                console.log(`✅ Contexts loaded for ${fileName}`);

                // Update with full data
                filesData[fileName] = {
                    ...filesData[fileName],
                    analysis: data.analysis,
                    status: 'complete'
                };
                saveFilesData();

                // Refresh UI
                updateFileSelector();
                if (selectedFiles.has(fileName)) {
                    renderWordCloud();
                    renderTable();
                }

                showSuccess(`Analysis complete for ${fileName}`);
            } else if (data.status === 'error') {
                clearInterval(pollInterval);
                console.error(`❌ Context analysis failed for ${fileName}: ${data.error}`);

                // Cleanup: Remove failed file from local state
                delete filesData[fileName];
                selectedFiles.delete(fileName);
                saveFilesData();

                // Refresh UI to hide the failed file
                renderIncrementalResults();
                showError(`Removed failed file ${fileName}: ${data.error}`);
            }
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 2000); // Poll every 2 seconds
}

// ==========================================
// Results Display
// ==========================================
function showResults() {
    const resultsContent = document.getElementById('resultsContent');
    const actionSection = document.querySelector('.action-section');
    const uploadCard = document.querySelector('.upload-card');

    if (Object.keys(filesData).length > 0) {
        uploadCard.style.display = 'none';
        if (actionSection) actionSection.style.display = 'block';
    } else {
        uploadCard.style.display = 'block';
        if (actionSection) actionSection.style.display = 'none';
    }
    if (resultsContent) resultsContent.style.display = 'block';

    updateFileSelector();
    updateStats();
    renderWordCloud();
    renderTable();
}

/**
 * Refreshes the UI results without hiding the upload progress card
 * Useful for incremental multi-file processing
 */
function renderIncrementalResults() {
    const resultsContent = document.getElementById('resultsContent');
    const actionSection = document.querySelector('.action-section');

    // Ensure results container is visible
    resultsSection.style.display = 'block';
    if (resultsContent) resultsContent.style.display = 'block';
    if (actionSection) actionSection.style.display = 'block';

    // Refresh data views
    updateFileSelector();
    updateStats();
    renderWordCloud();
    renderTable();
}

function updateFileSelector() {
    const files = Object.keys(filesData);

    let html = `
    <div class="file-filters">
      <div class="file-checkboxes">
  `;

    // All files checkbox
    const allChecked = selectedFiles.size === files.length && !showSavedOnly;
    html += `
    <label class="file-checkbox ${allChecked ? 'active' : ''}">
      <input type="checkbox" value="all" ${allChecked ? 'checked' : ''} onchange="toggleAllFiles(this.checked)">
      <span>All (${files.length})</span>
    </label>
  `;

    // Individual file checkboxes
    files.forEach(fileName => {
        const file = filesData[fileName];
        const status = file.status || 'complete'; // Default to complete for old files
        const checked = selectedFiles.has(fileName);
        const shortName = fileName.length > 20 ? fileName.substring(0, 20) + '...' : fileName;

        let statusIcon = '';
        if (status === 'processing') {
            statusIcon = '<span class="status-icon" title="Analyzing context..."><div class="spinner-dot"></div></span>';
        } else if (status === 'complete' && checked) {
            statusIcon = '<span class="status-icon" title="Analysis complete">✅</span>';
        } else if (status === 'error') {
            statusIcon = '<span class="status-icon error" title="Analysis failed">❌</span>';
        }

        const escapedFileName = escapeHtml(fileName);
        const escapedShortName = escapeHtml(shortName);

        html += `
      <div class="file-chip ${checked && !showSavedOnly ? 'active' : ''} ${status}">
        <label class="file-label" title="${escapedFileName}">
          <input type="checkbox" value="${escapedFileName}" data-action="toggle-file" data-file="${escapedFileName}" ${checked && !showSavedOnly ? 'checked' : ''}>
          ${statusIcon}
          <span>${escapedShortName}</span>
        </label>
        <button type="button" class="delete-file-btn" data-action="delete-file" data-file="${escapedFileName}" title="Remove file">×</button>
      </div>
    `;
    });

    // Saved words option
    if (savedWords.length > 0) {
        const phrasesCount = savedWords.filter(w => isPhraseItem(w)).length;
        const wordsCount = savedWords.length - phrasesCount;
        html += `
      <label class="file-checkbox saved-filter ${showSavedOnly ? 'active' : ''}">
        <input type="checkbox" value="saved" ${showSavedOnly ? 'checked' : ''} onchange="toggleSavedOnly(this.checked)">
        <span>⭐ Saved (${savedWords.length})</span>
      </label>
      ${showSavedOnly ? `
        <div class="saved-filter-tabs">
          <button type="button" class="saved-tab-btn ${savedSubfilter === 'all' ? 'active' : ''}" onclick="setSavedSubfilter('all')">Tất cả (${savedWords.length})</button>
          <button type="button" class="saved-tab-btn ${savedSubfilter === 'words' ? 'active' : ''}" onclick="setSavedSubfilter('words')">Từ (${wordsCount})</button>
          <button type="button" class="saved-tab-btn ${savedSubfilter === 'phrases' ? 'active' : ''}" onclick="setSavedSubfilter('phrases')">Cụm từ (${phrasesCount})</button>
        </div>
      ` : ''}
    `;
    }

    html += `
      </div>
    </div>
  `;

    fileSelector.innerHTML = html;
}

function setSavedSubfilter(sub) {
    savedSubfilter = sub;
    invalidateAggregatedData();
    tableData = getAggregatedData().results;
    updateFileSelector();
    updateTable();
}
window.setSavedSubfilter = setSavedSubfilter;

function toggleAllFiles(checked) {
    showSavedOnly = false;
    invalidateAggregatedData();
    if (checked) {
        selectedFiles = new Set(Object.keys(filesData));
    } else {
        selectedFiles.clear();
    }
    updateFileSelector();
    updateStats();
    renderWordCloud();
    renderTable();
}

function toggleFile(fileName, checked) {
    showSavedOnly = false;
    invalidateAggregatedData();
    if (checked) {
        selectedFiles.add(fileName);
    } else {
        selectedFiles.delete(fileName);
    }
    updateFileSelector();
    updateStats();
    renderWordCloud();
    renderTable();
}

function toggleSavedOnly(checked) {
    showSavedOnly = checked;
    invalidateAggregatedData();
    if (checked) {
        // When showing saved only, still use all files for counts
        selectedFiles = new Set(Object.keys(filesData));
    }
    updateFileSelector();
    updateStats();
    renderWordCloud();
    renderTable();
}

// Make these global
window.toggleAllFiles = toggleAllFiles;
window.toggleFile = toggleFile;
window.toggleSavedOnly = toggleSavedOnly;

function deleteFile(fileName) {
    if (!confirm(`Remove "${fileName}" from analysis?`)) return;

    // Notify server to cancel/remove analysis
    const fileInfo = filesData[fileName];
    if (fileInfo && fileInfo.fileId) {
        fetch(`/api/analysis/${fileInfo.fileId}`, { method: 'DELETE' })
            .catch(err => console.error('Failed to notify server of deletion:', err));
    }

    delete filesData[fileName];
    selectedFiles.delete(fileName);
    saveFilesData();

    // If no files left, show upload
    if (Object.keys(filesData).length === 0) {
        resetUpload();
    } else {
        updateFileSelector();
        updateStats();
        renderWordCloud();
        renderTable();
    }
}
window.deleteFile = deleteFile;

function updateStats() {
    const data = getAggregatedData();
    document.getElementById('totalWords').textContent = data.totalWords.toLocaleString();
    document.getElementById('uniqueWords').textContent = data.uniqueWords.toLocaleString();
    savedCountEl.textContent = savedWords.length.toLocaleString();

    // Update CEFR Difficulty & Lexical Profile Radar
    const cefrStats = data.cefrStats;
    if (cefrStats) {
        const overallEl = document.getElementById('overallCefrLevel');
        if (overallEl) overallEl.textContent = cefrStats.overallLevel ? cefrStats.overallLevel.split(' ')[0] : '—';

        const radarCard = document.getElementById('cefrRadarCard');
        if (radarCard && data.totalWords > 0) {
            radarCard.style.display = 'block';
            const badgeEl = document.getElementById('cefrSummaryBadge');
            if (badgeEl) badgeEl.textContent = cefrStats.overallLevel;

            const readinessEl = document.getElementById('readinessScore');
            if (readinessEl) readinessEl.textContent = `${cefrStats.readinessPct || 0}%`;

            const p = cefrStats.percentages || {};
            const setWidth = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.style.width = `${val || 0}%`;
            };
            setWidth('barA1', p.A1);
            setWidth('barA2', p.A2);
            setWidth('barB1', p.B1);
            setWidth('barB2', p.B2);
            setWidth('barC1', p.C1);
            setWidth('barC2', p.C2);

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = `${val || 0}%`;
            };
            setText('pctA1', p.A1);
            setText('pctA2', p.A2);
            setText('pctB1', p.B1);
            setText('pctB2', p.B2);
            setText('pctC1', p.C1);
            setText('pctC2', p.C2);
        }
    }
}

let cachedAggregatedData = null;

function invalidateAggregatedData() {
    cachedAggregatedData = null;
}

function getAggregatedData() {
    if (cachedAggregatedData) {
        return cachedAggregatedData;
    }

    const wordMap = new Map(); // word -> { count, cefr, context[] }
    let totalWords = 0;

    // Aggregate selected files only
    Object.entries(filesData).forEach(([fileName, file]) => {
        if (!selectedFiles.has(fileName)) return;

        file.analysis.results.forEach(item => {
            const existing = wordMap.get(item.word);
            if (existing) {
                existing.count += item.count;
                if (!existing.cefr && item.cefr) existing.cefr = item.cefr;
                // Merge contexts (up to 5 total)
                if (item.context && item.context.length > 0) {
                    const spaceLeft = 5 - existing.context.length;
                    if (spaceLeft > 0) {
                        existing.context.push(...item.context.slice(0, spaceLeft));
                    }
                }
            } else {
                wordMap.set(item.word, {
                    count: item.count,
                    cefr: item.cefr || null,
                    context: item.context ? [...item.context] : []
                });
            }
            totalWords += item.count;
        });
    });

    let results = Array.from(wordMap.entries())
        .map(([word, data]) => ({
            word,
            count: data.count,
            cefr: data.cefr || null,
            context: data.context,
            percentage: totalWords > 0 ? ((data.count / totalWords) * 100).toFixed(2) : '0.00'
        }))
        .sort((a, b) => b.count - a.count);

    // Compute CEFR statistics for aggregated results
    const cefrCounts = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
    let totalCategorized = 0;
    results.forEach(item => {
        const lvl = (item.cefr || 'C2').toUpperCase();
        if (cefrCounts[lvl] !== undefined) {
            cefrCounts[lvl] += item.count;
        } else {
            cefrCounts.C2 += item.count;
        }
        totalCategorized += item.count;
    });

    const cefrPercentages = {};
    for (const [lvl, count] of Object.entries(cefrCounts)) {
        cefrPercentages[lvl] = totalCategorized > 0
            ? ((count / totalCategorized) * 100).toFixed(1)
            : '0.0';
    }

    let overallLevel = 'B1 Intermediate';
    const b2Plus = (cefrCounts.B2 + cefrCounts.C1 + cefrCounts.C2) / (totalCategorized || 1);
    const c1Plus = (cefrCounts.C1 + cefrCounts.C2) / (totalCategorized || 1);
    if (c1Plus > 0.15) overallLevel = 'C1 Advanced';
    else if (b2Plus > 0.35) overallLevel = 'B2 Upper-Int';
    else if (b2Plus > 0.15) overallLevel = 'B1 Intermediate';
    else overallLevel = 'A2 Elementary';

    // Calculate personalized Book Readiness (A1-B2 words + user known words)
    let familiarTokens = 0;
    results.forEach(item => {
        const lvl = (item.cefr || 'C2').toUpperCase();
        const isFamiliar = (lvl === 'A1' || lvl === 'A2' || lvl === 'B1' || lvl === 'B2') || knownWords.has(item.word.toLowerCase());
        if (isFamiliar) familiarTokens += item.count;
    });
    const readinessPct = totalWords > 0 ? Math.min(100, Math.round((familiarTokens / totalWords) * 100)) : 0;

    const cefrStats = {
        counts: cefrCounts,
        percentages: cefrPercentages,
        overallLevel,
        readinessPct
    };

    // Aggregate collocations & multi-book series progression
    const collocMap = new Map();
    const fileWordSets = [];

    Object.entries(filesData).forEach(([fileName, file]) => {
        if (!selectedFiles.has(fileName)) return;

        const currentFileWords = new Set();
        (file.analysis?.results || []).forEach(item => {
            currentFileWords.add(item.word.toLowerCase());
        });

        if (file.analysis?.collocations && Array.isArray(file.analysis.collocations)) {
            file.analysis.collocations.forEach(c => {
                collocMap.set(c.phrase, (collocMap.get(c.phrase) || 0) + c.count);
            });
        }

        fileWordSets.push({ fileName, words: currentFileWords });
    });

    const collocations = Array.from(collocMap.entries())
        .map(([phrase, count], idx) => ({
            rank: idx + 1,
            word: phrase,
            count,
            percentage: totalWords > 0 ? ((count / totalWords) * 100).toFixed(2) : '0.00',
            cefr: null,
            isCollocation: true,
            context: []
        }))
        .sort((a, b) => b.count - a.count);

    collocations.forEach((c, idx) => c.rank = idx + 1);

    // Series progression delta (Words introduced in latest selected file not present in earlier ones)
    let seriesDelta = [];
    if (fileWordSets.length >= 2) {
        const earlierWords = new Set();
        for (let i = 0; i < fileWordSets.length - 1; i++) {
            fileWordSets[i].words.forEach(w => earlierWords.add(w));
        }
        const latestFile = fileWordSets[fileWordSets.length - 1];
        seriesDelta = results
            .filter(item => latestFile.words.has(item.word.toLowerCase()) && !earlierWords.has(item.word.toLowerCase()))
            .map((item, idx) => ({ ...item, rank: idx + 1, isSeriesDelta: true }));
    }

    // Filter for saved words only
    if (showSavedOnly) {
        const savedSet = new Set(savedWords);
        results = results.filter(item => savedSet.has(item.word));

        // Find any words in savedWords that were not in results and append as custom words
        const existingWords = new Set(results.map(r => r.word.toLowerCase()));
        savedWords.forEach(savedWord => {
            if (!existingWords.has(savedWord.toLowerCase())) {
                const meta = savedMetadata[savedWord.toLowerCase()];
                results.push({
                    word: savedWord,
                    count: 0,
                    percentage: '0.00',
                    context: meta?.context ? [meta.context] : [],
                    isCustom: true
                });
            }
        });

        // Apply Subfilter: all, words, phrases
        if (savedSubfilter === 'words') {
            results = results.filter(item => !isPhraseItem(item.word));
        } else if (savedSubfilter === 'phrases') {
            results = results.filter(item => isPhraseItem(item.word));
        }
    }

    // Precompute rank (1-indexed based on frequency order, '—' for custom words)
    results.forEach((item, index) => {
        item.rank = (item.isCustom || item.count === 0) ? '—' : index + 1;
    });

    cachedAggregatedData = {
        results,
        collocations,
        seriesDelta,
        totalWords,
        uniqueWords: wordMap.size,
        cefrStats
    };

    return cachedAggregatedData;
}

// ==========================================
// Word Cloud Visualization
// ==========================================
function renderWordCloud() {
    const container = document.getElementById('wordCloud');
    container.innerHTML = '';

    const data = getAggregatedData();
    if (data.results.length === 0) {
        container.innerHTML = '<p style="color: #6b6b7b; text-align: center;">No words to display</p>';
        return;
    }

    // Calculate accurate content width
    const style = window.getComputedStyle(container);
    const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);

    // Use container.clientWidth for inner width excluding border, then subtract padding
    const rect = container.getBoundingClientRect();
    const width = rect.width - paddingX;

    // Ensure height is reasonable or dynamic
    const height = 300;

    // Dynamic word count based on screen size
    const isMobile = width < 600;
    const maxWords = isMobile ? 40 : 100; // Increased from 60

    const words = data.results.slice(0, maxWords).map(item => ({
        text: item.word,
        size: 12 + (item.count / data.results[0].count) * (isMobile ? 40 : 70) // Bigger font range on desktop
    }));

    const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe'];

    const layout = d3.layout.cloud()
        .size([width, height])
        .words(words)
        .padding(4)
        .rotate(() => (Math.random() > 0.7 ? 90 : 0))
        .font('Inter')
        .fontSize(d => d.size)
        .on('end', draw);

    layout.start();

    function draw(words) {
        d3.select('#wordCloud')
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .append('g')
            .attr('transform', `translate(${width / 2},${height / 2})`)
            .selectAll('text')
            .data(words)
            .enter()
            .append('text')
            .style('font-size', d => `${d.size}px`)
            .style('font-family', 'Inter')
            .style('font-weight', '600')
            .style('fill', () => colors[Math.floor(Math.random() * colors.length)])
            .style('cursor', 'pointer')
            .attr('text-anchor', 'middle')
            .attr('transform', d => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
            .text(d => d.text)
            .on('click', function (event, d) {
                toggleSave(d.text);
                const isSaved = new Set(savedWords).has(d.text);
                d3.select(this)
                    .style('text-shadow', isSaved ? '0 0 8px #10b981' : 'none')
                    .style('stroke', isSaved ? '#10b981' : 'none')
                    .style('stroke-width', isSaved ? '0.5px' : '0');
            });
    }
}

// ==========================================
// Data Table
// ==========================================
let tableData = [];
let sortColumn = 'count';
let sortDirection = 'desc';

let currentFilteredData = [];
let renderedCount = 0;
const CHUNK_SIZE = 100;

function renderRow(item, savedSet) {
    const isSaved = savedSet.has(item.word);
    const isKnown = knownWords.has(item.word.toLowerCase());
    const countDisplay = typeof item.count === 'number' && item.count > 0 ? item.count.toLocaleString() : '0';
    const rankDisplay = item.rank !== undefined ? item.rank : '—';
    const pctDisplay = item.percentage !== undefined ? item.percentage : '0.00';
    const escapedWord = escapeHtml(item.word);
    const isPhrase = isPhraseItem(item.word);
    const meta = savedMetadata[item.word.toLowerCase()];

    let badgeHtml = '';
    if (item.isCollocation) {
        badgeHtml = `<span class="colloc-badge" title="Cụm từ trích xuất tự động">Collocation</span>`;
    } else if (item.isSeriesDelta) {
        badgeHtml = `<span class="badge" style="background:rgba(234, 179, 8, 0.2); color:#eab308; border:1px solid rgba(234, 179, 8, 0.4);" title="Từ mới trong tập tiếp theo">Series New</span>`;
    } else if (isPhrase) {
        badgeHtml = `<span class="badge badge-phrase" title="Cụm từ / Phrase">Phrase</span>`;
    } else if (isSaved) {
        badgeHtml = `<span class="badge badge-word" title="Từ đơn">Word</span>`;
    }

    const meaningPreviewHtml = meta?.meaning
        ? `<div class="phrase-meaning-preview" title="${escapeHtml(meta.meaning)}">${escapeHtml(meta.meaning)}</div>`
        : '';
    const cefrBadge = item.cefr
        ? `<span class="badge badge-cefr badge-${item.cefr.toLowerCase()}">${item.cefr}</span>`
        : `<span class="badge-cefr-empty">—</span>`;

    return `
    <tr class="word-row ${isKnown ? 'is-known-row' : ''}" data-word="${escapedWord}">
      <td data-label="#">${rankDisplay}</td>
      <td class="word-cell" data-label="Word">
        <div>
          <span class="word-text">${escapedWord}</span>
          ${badgeHtml}
          ${meaningPreviewHtml}
        </div>
      </td>
      <td data-label="CEFR">${cefrBadge}</td>
      <td data-label="Count">${countDisplay}</td>
      <td data-label="%">${pctDisplay}%</td>
      <td class="col-actions" data-label="Actions">
        <div style="display:inline-flex; align-items:center; gap:4px;">
          <button type="button" class="known-btn ${isKnown ? 'is-known' : ''}" 
                  data-action="toggle-known" 
                  data-word="${escapedWord}" 
                  title="${isKnown ? 'Bỏ đánh dấu từ đã biết' : 'Đánh dấu từ đã biết (Personal Vocabulary)'}">
            ${isKnown ? '✅' : '👁️'}
          </button>
          <button type="button" class="icon-btn tts-btn" data-action="tts" data-word="${escapedWord}" title="Nghe phát âm">🔊</button>
          <button type="button" class="save-btn ${isSaved ? 'saved' : ''}" 
                  data-action="save"
                  data-word="${escapedWord}" 
                  title="${isSaved ? 'Xóa khỏi sổ từ' : 'Lưu từ/cụm từ'}">
            ${isSaved ? '⭐' : '☆'}
          </button>
          ${isSaved ? `
            <button type="button" class="icon-btn edit-btn" data-action="edit" data-word="${escapedWord}" title="Chỉnh sửa nghĩa / ví dụ" style="font-size:0.9rem; padding:4px;">
              ✏️
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `;
}

function updateTabBadges(data) {
    const wordsBadge = document.getElementById('wordsCountBadge');
    const collocBadge = document.getElementById('collocCountBadge');
    const seriesBadge = document.getElementById('seriesDeltaBadge');
    const seriesTab = document.getElementById('tabSeriesProgression');
    const knownBadge = document.getElementById('knownCountBadge');

    if (wordsBadge) wordsBadge.textContent = (data.results?.length || 0).toLocaleString();
    if (collocBadge) collocBadge.textContent = (data.collocations?.length || 0).toLocaleString();
    if (knownBadge) knownBadge.textContent = knownWords.size.toLocaleString();

    const selectedFileCount = Array.from(selectedFiles).length;
    if (seriesTab) {
        if (selectedFileCount >= 2) {
            seriesTab.style.display = 'inline-flex';
            if (seriesBadge) seriesBadge.textContent = (data.seriesDelta?.length || 0).toLocaleString();
        } else {
            seriesTab.style.display = 'none';
            if (currentTableView === 'series') {
                setTableView('words');
            }
        }
    }
}

function appendNextChunk() {
    if (renderedCount >= currentFilteredData.length) return;
    const nextChunk = currentFilteredData.slice(renderedCount, renderedCount + CHUNK_SIZE);
    renderedCount += nextChunk.length;
    const savedSet = new Set(savedWords);
    const rowsHtml = nextChunk.map(item => renderRow(item, savedSet)).join('');
    tableBody.insertAdjacentHTML('beforeend', rowsHtml);
}

function renderTable() {
    const data = getAggregatedData();
    if (currentTableView === 'collocations') {
        tableData = data.collocations || [];
    } else if (currentTableView === 'series') {
        tableData = data.seriesDelta || [];
    } else {
        tableData = data.results || [];
    }
    updateTabBadges(data);
    updateTable();

    if (!fileSelector.dataset.initialized) {
        document.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                if (sortColumn === column) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = column;
                    sortDirection = column === 'word' ? 'asc' : 'desc';
                }
                document.querySelectorAll('.sortable').forEach(h => h.classList.remove('active'));
                header.classList.add('active');
                updateTable();
            });
        });
        fileSelector.dataset.initialized = 'true';

        // Save header click to toggle filter
        const saveHeader = document.getElementById('saveHeader');
        if (saveHeader) {
            saveHeader.addEventListener('click', () => {
                showSavedOnly = !showSavedOnly;
                invalidateAggregatedData();
                saveHeader.classList.toggle('filter-active', showSavedOnly);
                updateFileSelector();
                updateStats();
                renderWordCloud();
                renderTable();
            });
        }

        // Infinite scroll listeners (window and container)
        window.addEventListener('scroll', () => {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
                appendNextChunk();
            }
        });

        const tableWrapper = document.querySelector('.table-wrapper');
        if (tableWrapper) {
            tableWrapper.addEventListener('scroll', () => {
                if (tableWrapper.scrollTop + tableWrapper.clientHeight >= tableWrapper.scrollHeight - 200) {
                    appendNextChunk();
                }
            });
        }

        // CEFR filter selector listener
        const cefrFilterEl = document.getElementById('cefrFilter');
        if (cefrFilterEl) {
            cefrFilterEl.addEventListener('change', () => {
                updateTable();
            });
        }
    }
}

function updateTable() {
    const searchTerm = searchBox.value.toLowerCase().trim();
    const cefrFilterEl = document.getElementById('cefrFilter');
    const cefrFilterVal = cefrFilterEl ? cefrFilterEl.value : 'all';
    const shouldHideKnown = hideKnownCheckbox && hideKnownCheckbox.checked;

    currentFilteredData = tableData.filter(item => {
        if (shouldHideKnown && knownWords.has(item.word.toLowerCase())) {
            return false;
        }
        if (searchTerm && !item.word.toLowerCase().includes(searchTerm)) {
            return false;
        }
        if (cefrFilterVal !== 'all') {
            const lvl = (item.cefr || 'C2').toUpperCase();
            if (cefrFilterVal === 'hide-a1-a2') return lvl !== 'A1' && lvl !== 'A2';
            if (cefrFilterVal === 'b1-plus') return lvl === 'B1' || lvl === 'B2' || lvl === 'C1' || lvl === 'C2';
            if (cefrFilterVal === 'b2-plus') return lvl === 'B2' || lvl === 'C1' || lvl === 'C2';
            if (cefrFilterVal === 'c1-plus') return lvl === 'C1' || lvl === 'C2';
        }
        return true;
    });

    if (currentFilteredData.length === 0) {
        if (!searchTerm) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px; color: #888;">Không có từ nào phù hợp với bộ lọc</td></tr>';
        } else {
            const savedSet = new Set(savedWords.map(w => w.toLowerCase()));
            const isSaved = savedSet.has(searchTerm.toLowerCase());
            const escapedTerm = escapeHtml(searchTerm);

            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align:center; padding: 35px 20px;">
                        <div style="max-width: 500px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                            <div style="font-size: 1.05rem; color: #a8a8b3;">
                                Không tìm thấy <strong>'${escapedTerm}'</strong> trong tài liệu này.
                            </div>
                            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                                <button id="emptySearchSaveBtn" class="primary-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 0.9rem; cursor: pointer; ${isSaved ? 'background: linear-gradient(135deg, #10b981 0%, #059669 100%);' : ''}">
                                    ${isSaved ? '⭐ Đã lưu' : '⭐ Lưu nhanh'}
                                </button>
                                <button id="emptySearchDetailBtn" class="secondary-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 0.9rem; cursor: pointer;">
                                    ✏️ Thêm chi tiết nghĩa & ngữ cảnh
                                </button>
                                <button id="emptySearchDictBtn" class="primary-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 0.9rem; cursor: pointer; background: #6c757d;">
                                    📖 Xem từ điển
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;

            const saveBtn = document.getElementById('emptySearchSaveBtn');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    toggleSave(searchTerm);
                    const currentlySaved = new Set(savedWords.map(w => w.toLowerCase())).has(searchTerm.toLowerCase());
                    saveBtn.innerHTML = currentlySaved ? '⭐ Đã lưu' : '⭐ Lưu nhanh';
                    saveBtn.style.background = currentlySaved ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '';
                });
            }

            const detailBtn = document.getElementById('emptySearchDetailBtn');
            if (detailBtn) {
                detailBtn.addEventListener('click', () => {
                    openAddPhraseModal(searchTerm);
                });
            }

            const dictBtn = document.getElementById('emptySearchDictBtn');
            if (dictBtn) {
                dictBtn.addEventListener('click', () => {
                    showContext(searchTerm);
                });
            }
        }
        return;
    }

    currentFilteredData.sort((a, b) => {
        let aVal, bVal;
        switch (sortColumn) {
            case 'rank':
                aVal = typeof a.rank === 'number' ? a.rank : 999999999;
                bVal = typeof b.rank === 'number' ? b.rank : 999999999;
                break;
            case 'word':
                aVal = a.word;
                bVal = b.word;
                break;
            case 'count':
                aVal = typeof a.count === 'number' ? a.count : -1;
                bVal = typeof b.count === 'number' ? b.count : -1;
                break;
            case 'percentage':
                aVal = parseFloat(a.percentage) || 0;
                bVal = parseFloat(b.percentage) || 0;
                break;
            case 'cefr': {
                const cefrOrder = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
                aVal = cefrOrder[(a.cefr || 'C2').toUpperCase()] || 99;
                bVal = cefrOrder[(b.cefr || 'C2').toUpperCase()] || 99;
                break;
            }
        }

        if (sortColumn === 'word') {
            return sortDirection === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        } else {
            return sortDirection === 'asc'
                ? aVal - bVal
                : bVal - aVal;
        }
    });

    tableBody.innerHTML = '';
    renderedCount = 0;
    appendNextChunk();
}

// ==========================================
// Save Words & Phrases Feature
// ==========================================
function saveWordOrPhrase(word, meta = {}) {
    const trimmed = (word || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!savedWords.includes(trimmed)) {
        savedWords.push(trimmed);
    }
    const detectedType = meta.type || (trimmed.includes(' ') ? 'phrase' : 'word');
    savedMetadata[lower] = {
        type: detectedType,
        meaning: meta.meaning !== undefined ? meta.meaning : (savedMetadata[lower]?.meaning || ''),
        context: meta.context !== undefined ? meta.context : (savedMetadata[lower]?.context || ''),
        notes: meta.notes !== undefined ? meta.notes : (savedMetadata[lower]?.notes || '')
    };
    saveSavedWords();
    invalidateAggregatedData();
    if (showSavedOnly) {
        tableData = getAggregatedData().results;
    }
    updateFileSelector();
    updateTable();
    updateStats();
    if (typeof syncOneWord === 'function' && authToken) {
        syncOneWord(trimmed);
    }
}
window.saveWordOrPhrase = saveWordOrPhrase;

function toggleSave(word) {
    const index = savedWords.indexOf(word);
    if (index > -1) {
        savedWords.splice(index, 1);
        delete savedMetadata[word.toLowerCase()];
        delete srsData[word];
        saveSavedWords();
        localStorage.setItem('wfa_srs', JSON.stringify(srsData));
        invalidateAggregatedData();
        if (showSavedOnly) {
            tableData = getAggregatedData().results;
        }
        updateFileSelector();
        updateTable();
        updateStats();
        if (typeof syncOneWord === 'function' && authToken) {
            syncOneWord(word);
        }
    } else {
        saveWordOrPhrase(word);
    }
}

window.toggleSave = toggleSave;

// ==========================================
// Context Viewer
// ==========================================
function speakWord(word) {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
}

function renderContextItem(c, word) {
    const isString = typeof c === 'string';
    const text = isString ? c : (c.text || '');
    const source = isString ? 'document' : (c.source || 'document');
    const fileName = isString ? 'tài liệu' : (c.fileName || 'tài liệu');
    const line = isString ? 1 : (c.line || 1);
    const page = isString ? 1 : (c.page || 1);
    const translation = isString ? '' : (c.translation || '');

    const highlighted = highlightWordInText(text, word);

    if (source === 'dictionary') {
        return `<div class="context-item context-dict">
            <div><span class="badge badge-dict">📖 Ví dụ từ điển</span></div>
            <div class="dict-subtext">Ví dụ từ từ điển (không phải từ tài liệu)</div>
            <div class="context-text">${highlighted}</div>
            ${translation ? `<div class="example-translation">💡 ${escapeHtml(translation)}</div>` : ''}
        </div>`;
    }

    // source === 'document'
    const tooltipText = `(File: ${escapeHtml(fileName)} | Dòng: ${line}${page > 1 ? ` | Trang: ${page}` : ''})`;
    const provenanceHtml = `<span class="context-provenance" title="${tooltipText}"><span class="provenance-icon">ℹ️</span><span class="provenance-tooltip">${tooltipText}</span></span>`;
    return `<div class="context-item context-document">
        <span class="context-text">${highlighted}</span>
        ${provenanceHtml}
    </div>`;
}

function renderSourceBadge(source) {
    if (!source || source === 'none') return '';
    if (source === 'offline_lingoes') {
        const titleText = 'Lingoes: Từ điển Anh - Việt (Lạc Việt / Hồ Ngọc Đức - 108.852 từ)';
        return `<span class="source-icon-badge lingoes-badge" title="${escapeHtml(titleText)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 15.5 L2.5 21.8 C3.8 22.3 5.2 21.5 6.6 19.2 L8.2 15.8 Z" fill="#0284c7"/><path d="M8 16 L4.8 22.2 C6 22.5 7.4 21.6 8.4 19.5 L9.3 16.2 Z" fill="#38bdf8"/><path d="M11 3 C9.5 3 8 4.5 8.5 6.5 C7 8.5 6.5 11 6.5 13.8 C6.5 17.2 9 20 12.5 20 C15 20 16.5 18 16.5 15 C16.5 12.2 15.5 10.5 15 8.8 C15.5 6 13.5 3 11 3 Z" fill="#22c55e"/><path d="M10.8 3.2 C9 1.8 7.5 3.2 8.5 5 C9.2 3.8 10 3.4 10.8 3.2 Z" fill="#16a34a"/><path d="M11.8 2.8 C11.2 1.2 12.8 0.6 13.6 1.8 C13 2.3 12.4 2.7 11.8 2.8 Z" fill="#22c55e"/><path d="M14 10 L16.8 11 C16 12 14.8 12.3 13.8 11.6 Z" fill="#d97706"/><path d="M13.5 6.8 C16.2 6.8 20 7.8 20.6 9.8 C21 11.4 19.8 13.8 17.6 14.2 C18.4 12.6 17.8 10.8 13.8 9.5 Z" fill="#f59e0b"/><circle cx="11.6" cy="7.8" r="2.2" fill="#ffffff"/><circle cx="12.2" cy="7.8" r="1.2" fill="#1e293b"/><circle cx="12.6" cy="7.4" r="0.4" fill="#ffffff"/><path d="M7 11 C9.5 10.7 12.4 12.4 11.9 16.2 C11.4 18.5 9 19 7.2 17.8 C5.8 16.5 5.8 12.8 7 11 Z" fill="#0284c7"/><path d="M7.3 13.3 C9 13.3 10.9 14.7 10.4 17.3 C9.8 18.5 8.3 18.5 7.3 17.5 C6.7 16.6 6.7 14.7 7.3 13.3 Z" fill="#38bdf8"/><path d="M10.2 20 C10.2 20.8 11 21.3 11.6 20.8" stroke="#d97706" stroke-width="1.2" stroke-linecap="round" fill="none"/><path d="M12.6 20 C12.6 20.8 13.4 21.3 14 20.8" stroke="#d97706" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg><span class="badge-tooltip">${escapeHtml(titleText)}</span></span>`;
    }
    if (source === 'online_wiktionary') {
        const titleText = 'Wiktionary: Từ điển Quốc tế (Wikimedia CDN)';
        return `<span class="source-icon-badge wiktionary-badge" title="${escapeHtml(titleText)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path><path d="M8 8l2 6 2-6 2 6 2-6" stroke-width="2"></path></svg><span class="badge-tooltip">${escapeHtml(titleText)}</span></span>`;
    }
    if (source === 'online_datamuse') {
        const titleText = 'Datamuse: Từ điển Trực tuyến (Datamuse API)';
        return `<span class="source-icon-badge datamuse-badge" title="${escapeHtml(titleText)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg><span class="badge-tooltip">${escapeHtml(titleText)}</span></span>`;
    }
    const titleText = source;
    return `<span class="source-icon-badge default-source-badge" title="${escapeHtml(titleText)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path></svg><span class="badge-tooltip">${escapeHtml(titleText)}</span></span>`;
}

function renderLemmaBadge(lemma) {
    if (!lemma) return '';
    const escaped = escapeHtml(lemma);
    return `<span class="lemma-wrapper">
        (Nguyên mẫu: <button type="button" class="lemma-badge-btn" onclick="showContext('${escaped}')" title="Tra từ nguyên mẫu '${escaped}'">${escaped} ↗</button>)
    </span>`;
}

function renderMeaningsHtml(meanings) {
    if (!meanings || meanings.length === 0) {
        return '<p class="no-data">No definitions found.</p>';
    }

    const grouped = {};
    meanings.forEach(m => {
        let pos = (m.pos || 'nghĩa').trim();
        if (pos.toLowerCase() === 'general') {
            pos = 'Chung';
        }
        if (!grouped[pos]) grouped[pos] = [];
        grouped[pos].push(m.def);
    });

    const groupEntries = Object.entries(grouped);
    const hasSingleGeneralGroup = groupEntries.length === 1 && groupEntries[0][0] === 'Chung';

    let html = '';
    for (const [pos, defs] of groupEntries) {
        html += `<div class="definition-group">
            ${hasSingleGeneralGroup ? '' : `<span class="part-of-speech">${escapeHtml(pos)}</span>`}
            <ul class="def-list">${defs.slice(0, 4).map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
        </div>`;
    }
    return html;
}

function renderLemmaContextHint(lemma, count) {
    if (!lemma || !count) return '';
    const escaped = escapeHtml(lemma);
    return `<div class="lemma-context-hint">💡 Tài liệu có ${count} câu chứa từ nguyên mẫu <strong>${escaped}</strong>. <button type="button" class="btn-subtle" onclick="showContext('${escaped}')">Xem ngay ↗</button></div>`;
}

async function showContext(word) {
    const data = getAggregatedData();
    const item = data.results.find(i => i.word.toLowerCase() === word.toLowerCase()) || null;

    const modal = document.getElementById('contextModal');
    const wordSpan = document.getElementById('contextWord');
    const list = document.getElementById('contextSentences');
    const escapedWord = escapeHtml(word);

    // Setup Header with Word and Actions
    wordSpan.innerHTML = `
        ${escapedWord}
        <button type="button" class="icon-btn" id="contextHeaderSpeakBtn" title="Listen" style="font-size: 1rem; margin-left: 8px;">🔊</button>
        <a href="https://translate.google.com/?sl=auto&tl=vi&text=${encodeURIComponent(word)}" target="_blank" rel="noopener noreferrer" class="icon-btn" title="Translate (Google)" style="font-size: 1rem; text-decoration: none;">🌐</a>
    `;
    const contextHeaderSpeakBtn = document.getElementById('contextHeaderSpeakBtn');
    if (contextHeaderSpeakBtn) {
        contextHeaderSpeakBtn.addEventListener('click', () => speakWord(word));
    }

    // Check if any selected file is still processing
    const processingFiles = Object.values(filesData).filter(f => selectedFiles.has(f.fileName) && f.status === 'processing');

    const contexts = item?.context || [];
    let contextHtml = '<div class="section-title">Context Examples</div>';

    if (contexts.length > 0) {
        contexts.forEach(c => {
            contextHtml += renderContextItem(c, word);
        });
    } else if (item && item.isCustom) {
        contextHtml += '<div class="context-item info-message">Custom added word (no book context excerpt available).</div>';
    } else if (processingFiles.length > 0) {
        contextHtml += `
            <div class="context-item info-message">
                <div class="spinner-dot"></div>
                Analysis in progress... Context examples will appear shortly.
            </div>`;
    } else {
        contextHtml += '<div class="context-item">No context examples found for this word.</div>';
    }

    // Render modal structure and local context IMMEDIATELY (< 1ms)
    list.innerHTML = `
        <div class="definitions-section" id="definitionsContainer">
            <div class="section-title">Definitions</div>
            <div class="loading" style="padding: 10px 0; font-size: 0.9rem; color: #888;">
                <div class="spinner-dot" style="display:inline-block; vertical-align:middle; margin-right:6px;"></div> Loading definitions...
            </div>
        </div>
        <div class="contexts-section" id="contextsContainer">
            ${contextHtml}
        </div>
    `;
    modal.style.display = 'flex';

    // On-demand context extraction if contexts are 0 and document files exist
    if (contexts.length === 0 && (!item || !item.isCustom)) {
        const activeFiles = Object.values(filesData).filter(f => selectedFiles.has(f.fileName) && f.fileId);
        if (activeFiles.length > 0) {
            fetch(`/api/analysis/${activeFiles[0].fileId}/context/${encodeURIComponent(word)}`)
                .then(r => r.json())
                .then(res => {
                    if (res.success && res.context && res.context.length > 0) {
                        if (item) item.context = res.context;
                        let updatedContextHtml = '<div class="section-title">Context Examples</div>';
                        res.context.forEach(c => {
                            updatedContextHtml += renderContextItem(c, word);
                        });
                        const cContainer = document.getElementById('contextsContainer');
                        if (cContainer) cContainer.innerHTML = updatedContextHtml;
                    }
                })
                .catch(() => {});
        }
    }

    // Offline-first Multi-Tier Dictionary fetch from local server endpoint
    (async () => {
        try {
            const res = await fetch(`/api/dictionary/${encodeURIComponent(word)}`);
            const dict = await res.json();

            const sourceBadgeHtml = (dict.success && dict.source) ? renderSourceBadge(dict.source) : '';
            const lemmaBadgeHtml = dict.lemma ? renderLemmaBadge(dict.lemma) : '';

            let defHtml = `<div class="section-title">
                <span>Definitions</span>
                ${sourceBadgeHtml}
                ${lemmaBadgeHtml}
            </div>`;

            if (dict.phonetic) {
                defHtml += `
                    <div class="phonetic-container" style="margin-bottom: 8px;">
                        <span style="color:#a78bfa; font-weight:500;">/${escapeHtml(dict.phonetic.replace(/^\/+|\/+$/g, ''))}/</span>
                        <button type="button" class="icon-btn" data-action="dict-speak" data-word="${escapeHtml(dict.lemma || word)}" title="Listen" style="font-size: 0.9rem; padding: 2px 4px; margin-left:4px;">🔊</button>
                    </div>`;
            }

            defHtml += renderMeaningsHtml(dict.meanings);

            const defContainer = document.getElementById('definitionsContainer');
            if (defContainer) defContainer.innerHTML = defHtml;

            // Context section check and lemma suggestion
            const cContainer = document.getElementById('contextsContainer');
            if (cContainer) {
                const currentText = cContainer.textContent || '';
                const hasDocContext = item && item.context && item.context.some(c => c.source !== 'dictionary');
                const hasNoDocContext = !hasDocContext ||
                                        currentText.includes('No context examples found') ||
                                        currentText.includes('Custom added word') ||
                                        currentText.includes('Analysis in progress');

                let lemmaHintHtml = '';
                if (hasNoDocContext && dict.lemma) {
                    const aggData = typeof getAggregatedData === 'function' ? getAggregatedData() : null;
                    const lemmaItem = aggData?.results?.find(i => i.word.toLowerCase() === dict.lemma.toLowerCase());
                    const lemmaContextCount = (lemmaItem && lemmaItem.context)
                        ? (lemmaItem.context.filter(c => c.source !== 'dictionary').length || lemmaItem.context.length)
                        : 0;
                    if (lemmaItem && lemmaContextCount > 0) {
                        lemmaHintHtml = renderLemmaContextHint(dict.lemma, lemmaContextCount);
                    }
                }

                if (hasNoDocContext) {
                    if (dict.examples && dict.examples.length > 0) {
                        const dictContexts = dict.examples.map(ex => ({
                            text: ex.en || ex.example,
                            translation: ex.vi || '',
                            source: 'dictionary',
                            dictName: 'Lingoes'
                        }));
                        if (item) item.context = dictContexts;
                        cContainer.innerHTML = '<div class="section-title">Context Examples</div>' +
                            lemmaHintHtml +
                            dictContexts.map(c => renderContextItem(c, word)).join('');
                    } else if (lemmaHintHtml) {
                        cContainer.innerHTML = '<div class="section-title">Context Examples</div>' +
                            lemmaHintHtml +
                            '<div class="context-item">No context examples found for this word.</div>';
                    }
                }
            }
        } catch (err) {
            console.warn('Dict lookup error:', err.message);
            const defContainer = document.getElementById('definitionsContainer');
            if (defContainer) {
                defContainer.innerHTML = '<div class="section-title">Definitions</div><p class="error-text" style="color: #888; font-size: 0.9rem;">Definitions unavailable.</p>';
            }
        }
    })();
}

window.showContext = showContext;
window.speakWord = speakWord;
window.renderSourceBadge = renderSourceBadge;
window.renderLemmaBadge = renderLemmaBadge;
window.renderMeaningsHtml = renderMeaningsHtml;
window.renderLemmaContextHint = renderLemmaContextHint;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        renderSourceBadge,
        renderLemmaBadge,
        renderMeaningsHtml,
        renderLemmaContextHint,
        escapeHtml
    };
}

// Modal close handlers & delegation
if (contextModalEl) {
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            contextModalEl.style.display = 'none';
        });
    }

    contextModalEl.addEventListener('click', (e) => {
        if (e.target.id === 'contextModal') {
            contextModalEl.style.display = 'none';
            return;
        }
        const speakBtn = e.target.closest('[data-action="dict-speak"]');
        if (speakBtn && speakBtn.dataset.word) {
            e.stopPropagation();
            speakWord(speakBtn.dataset.word);
        }
    });
}

// Table row & action delegation
if (tableBody) {
    tableBody.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            const word = actionBtn.dataset.word;
            if (!word) return;
            if (action === 'tts') {
                speakWord(word);
            } else if (action === 'edit') {
                openEditPhraseModal(word);
            } else if (action === 'save') {
                toggleSave(word);
            } else if (action === 'toggle-known') {
                toggleKnownWord(word);
            }
            return;
        }

        const row = e.target.closest('tr.word-row');
        if (row && row.dataset.word) {
            showContext(row.dataset.word);
        }
    });
}

// File selector delegation
if (fileSelector) {
    fileSelector.addEventListener('change', (e) => {
        if (e.target.dataset.action === 'toggle-file') {
            const fileName = e.target.dataset.file;
            toggleFile(fileName, e.target.checked);
        }
    });
    fileSelector.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-action="delete-file"]');
        if (delBtn && delBtn.dataset.file) {
            e.stopPropagation();
            deleteFile(delBtn.dataset.file);
        }
    });
}

// ==========================================
// File Source Selection (for compatibility)
// ==========================================

// ==========================================
// Search & Export
// ==========================================
let searchDebounceTimer = null;
searchBox.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        updateTable();
    }, 150);
});

function escapeCsvField(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    return `"${str.replace(/"/g, '""')}"`;
}

exportBtn.addEventListener('click', () => {
    const data = getAggregatedData();
    if (!data.results.length) return;

    const savedSet = new Set(savedWords);
    const rows = [
        ['Rank', 'Word', 'CEFR', 'Count', 'Percentage', 'Saved', 'Meaning'].map(escapeCsvField),
        ...data.results.map((item, idx) => {
            const meta = savedMetadata[item.word.toLowerCase()] || {};
            return [
                item.rank || (idx + 1),
                item.word,
                item.cefr || '',
                item.count,
                item.percentage + '%',
                savedSet.has(item.word) ? 'Yes' : '',
                meta.meaning || ''
            ].map(escapeCsvField);
        })
    ].map(row => row.join(',')).join('\r\n');

    const blob = new Blob(['\uFEFF' + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `word-frequency-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

// Anki Deck Export (Tab-separated format with Front, Back, Tags)
const exportAnkiBtn = document.getElementById('exportAnkiBtn');
if (exportAnkiBtn) {
    exportAnkiBtn.addEventListener('click', () => {
        const data = getAggregatedData();
        if (!data.results.length) return;

        const lines = data.results.map(item => {
            const meta = savedMetadata[item.word.toLowerCase()] || {};
            const meaning = meta.meaning || '';
            const cefr = item.cefr ? `[${item.cefr}]` : '';
            const rawContext = Array.isArray(item.context) && item.context.length > 0 
                ? (item.context[0].text || item.context[0])
                : (meta.context || '');
            const safeContext = rawContext ? String(rawContext).replace(/\t/g, ' ').trim() : '';
            const back = `<div>${escapeHtml(meaning)}</div>${cefr ? `<div style="color:#667eea; font-weight:600; margin:4px 0;">${cefr}</div>` : ''}${safeContext ? `<div style="font-style:italic; margin-top:6px; color:#555;">"${escapeHtml(safeContext)}"</div>` : ''}`;
            const tag = `wfa ${item.cefr ? `cefr-${item.cefr.toLowerCase()}` : 'cefr-c2'}`;
            return `${item.word}\t${back}\t${tag}`;
        });

        const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `anki-deck-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showSuccess('Đã xuất file Anki Deck (.txt)! Mở Anki -> File -> Import để học.');
    });
}

// ==========================================
// Book DNA Infographic Card Generator
// ==========================================
const shareBookDnaBtn = document.getElementById('shareBookDnaBtn');
const bookDnaModal = document.getElementById('bookDnaModal');
const closeBookDnaBtn = document.getElementById('closeBookDnaBtn');
const copyDnaImgBtn = document.getElementById('copyDnaImgBtn');
const downloadDnaImgBtn = document.getElementById('downloadDnaImgBtn');
const bookDnaCanvas = document.getElementById('bookDnaCanvas');

function renderBookDnaCanvas() {
    if (!bookDnaCanvas) return;
    const ctx = bookDnaCanvas.getContext('2d');
    const width = 1200;
    const height = 675;
    bookDnaCanvas.width = width;
    bookDnaCanvas.height = height;

    const data = getAggregatedData();
    const results = data.results || [];
    const stats = currentAnalysisData?.cefrStats || {};
    const totalTokens = data.totalWords || results.reduce((acc, r) => acc + (r.count || 0), 0);
    const uniqueWords = results.length;

    // Document title
    let docTitle = 'Vocabulary Lexical Profile';
    if (uploadedFiles && uploadedFiles.length > 0) {
        docTitle = uploadedFiles.map(f => f.name).join(', ');
        if (docTitle.length > 40) docTitle = docTitle.substring(0, 37) + '...';
    }

    // 1. Background with sleek gradients
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.5, '#1e1b4b');
    bgGrad.addColorStop(1, '#090d16');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative radial aura
    const aura = ctx.createRadialGradient(width * 0.8, height * 0.2, 50, width * 0.8, height * 0.2, 400);
    aura.addColorStop(0, 'rgba(99, 102, 241, 0.18)');
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, width, height);

    // Outer border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    // 2. Header
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.fillText('🛰️ WordRadar', 60, 80);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 18px Inter, sans-serif';
    ctx.fillText('Pre-Reading Lexical Profiler', 300, 80);

    ctx.fillStyle = '#6366f1';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('wordradar.githsoft.com', width - 60, 80);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 105);
    ctx.lineTo(width - 60, 105);
    ctx.stroke();

    // 3. Document Name & Primary Metrics
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.fillText(docTitle, 60, 160);

    // Mini stats badges
    function drawStatPill(x, y, label, val) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.roundRect(x, y, 220, 50, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px Inter, sans-serif';
        ctx.fillText(label, x + 16, y + 24);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 18px Inter, sans-serif';
        ctx.fillText(val, x + 16, y + 44);
    }
    drawStatPill(60, 185, 'TOTAL TOKENS', totalTokens.toLocaleString());
    drawStatPill(300, 185, 'UNIQUE LEMMAS', uniqueWords.toLocaleString());

    const readinessPct = stats.readinessPct || 85;
    drawStatPill(540, 185, 'READINESS COVERAGE', `${readinessPct}% (Target: 95%)`);

    // 4. CEFR Difficulty & Readiness Card (Right side)
    const cardX = 800;
    const cardY = 140;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, 340, 180, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px Inter, sans-serif';
    ctx.fillText('ESTIMATED BOOK LEVEL', cardX + 24, cardY + 36);

    const level = stats.primaryLevel || 'B2';
    const levelColors = {
        'A1': '#10b981', 'A2': '#06b6d4', 'B1': '#3b82f6',
        'B2': '#6366f1', 'C1': '#8b5cf6', 'C2': '#ec4899', 'Off-list': '#64748b'
    };
    ctx.fillStyle = levelColors[level] || '#6366f1';
    ctx.font = 'bold 44px Inter, sans-serif';
    ctx.fillText(`CEFR ${level}`, cardX + 24, cardY + 90);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px Inter, sans-serif';
    ctx.fillText(`Radar: ${readinessPct}% of words familiar`, cardX + 24, cardY + 125);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('Focus on B2/C1 keywords for 95% flow', cardX + 24, cardY + 148);

    // 5. CEFR Breakdown Horizontal Bar
    const barX = 60;
    const barY = 280;
    const barW = 700;
    const barH = 28;

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillText('LEXICAL DISTRIBUTION (OXFORD 5000 PROFILE)', barX, barY - 12);

    const distribution = stats.distribution || { A1: 40, A2: 25, B1: 15, B2: 10, C1: 5, 'Off-list': 5 };
    let curX = barX;
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'Off-list'];

    // Draw background track
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 8);
    ctx.fill();

    levels.forEach((lvl, idx) => {
        const pct = distribution[lvl] || 0;
        const segmentW = (pct / 100) * barW;
        if (segmentW > 0) {
            ctx.fillStyle = levelColors[lvl] || '#64748b';
            ctx.beginPath();
            if (idx === 0) ctx.roundRect(curX, barY, segmentW, barH, [8, 0, 0, 8]);
            else if (idx === levels.length - 1) ctx.roundRect(curX, barY, segmentW, barH, [0, 8, 8, 0]);
            else ctx.fillRect(curX, barY, segmentW, barH);
            ctx.fill();
            curX += segmentW;
        }
    });

    // Legend below bar
    let legX = barX;
    levels.forEach(lvl => {
        const pct = distribution[lvl] || 0;
        ctx.fillStyle = levelColors[lvl];
        ctx.beginPath();
        ctx.arc(legX + 6, barY + 48, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '13px Inter, sans-serif';
        ctx.fillText(`${lvl}: ${pct}%`, legX + 16, barY + 52);
        legX += 115;
    });

    // 6. Key Gatekeeper Vocabulary (Top 6 B2/C1 words)
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText('🔑 KEY GATEKEEPER WORDS TO UNLOCK THIS BOOK', 60, 400);

    const keyWords = results
        .filter(r => r.cefr === 'B2' || r.cefr === 'C1' || r.cefr === 'B1')
        .slice(0, 6);

    const fallbackWords = results.slice(0, 6);
    const wordsToShow = keyWords.length >= 3 ? keyWords : fallbackWords;

    let chipX = 60;
    let chipY = 430;
    const chipW = 340;
    const chipH = 68;

    wordsToShow.forEach((w, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const cx = 60 + col * (chipW + 25);
        const cy = chipY + row * (chipH + 15);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.beginPath();
        ctx.roundRect(cx, cy, chipW, chipH, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.stroke();

        // Level badge pill
        const lvl = w.cefr || 'B2';
        ctx.fillStyle = levelColors[lvl] || '#6366f1';
        ctx.beginPath();
        ctx.roundRect(cx + 12, cy + 12, 42, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(lvl, cx + 33, cy + 27);
        ctx.textAlign = 'left';

        // Word text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px Inter, sans-serif';
        ctx.fillText(w.word, cx + 64, cy + 29);

        // Meaning or phonetic
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px Inter, sans-serif';
        const meaningText = (w.meaning || w.phonetic || `Frequency: ${w.count}x`).substring(0, 36);
        ctx.fillText(meaningText, cx + 16, cy + 52);
    });

    // 7. Footer Brand Note
    ctx.fillStyle = '#64748b';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('Analyzed by WordRadar • Open-source Pre-Reading Companion for Serious Readers', 60, height - 38);

    ctx.textAlign = 'right';
    const dateStr = new Date().toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    ctx.fillText(`Report Date: ${dateStr}`, width - 60, height - 38);
    ctx.textAlign = 'left';
}

if (shareBookDnaBtn && bookDnaModal) {
    shareBookDnaBtn.addEventListener('click', () => {
        renderBookDnaCanvas();
        bookDnaModal.style.display = 'flex';
    });

    if (closeBookDnaBtn) {
        closeBookDnaBtn.addEventListener('click', () => {
            bookDnaModal.style.display = 'none';
        });
    }

    bookDnaModal.addEventListener('click', (e) => {
        if (e.target === bookDnaModal) bookDnaModal.style.display = 'none';
    });

    if (downloadDnaImgBtn) {
        downloadDnaImgBtn.addEventListener('click', () => {
            if (!bookDnaCanvas) return;
            const link = document.createElement('a');
            link.download = `WordRadar-BookDNA-${Date.now()}.png`;
            link.href = bookDnaCanvas.toDataURL('image/png');
            link.click();
            showSuccess('Đã tải ảnh Thẻ ADN Sách thành công!');
        });
    }

    if (copyDnaImgBtn) {
        copyDnaImgBtn.addEventListener('click', async () => {
            if (!bookDnaCanvas) return;
            try {
                bookDnaCanvas.toBlob(async (blob) => {
                    if (!blob) throw new Error('Canvas toBlob failed');
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                    showSuccess('Đã sao chép ảnh Thẻ ADN Sách vào Clipboard!');
                }, 'image/png');
            } catch (err) {
                if (downloadDnaImgBtn) downloadDnaImgBtn.click();
            }
        });
    }
}

// ==========================================
// New Analysis
// ==========================================
newAnalysisBtn.addEventListener('click', () => {
    resetUpload();
});

// ==========================================
// Utility Functions
// ==========================================
function showError(message) {
    const toast = errorToast;
    const icon = toast.querySelector('.toast-icon');
    const msg = errorMessage;

    // Remove any previous classes
    toast.classList.remove('success-toast');
    toast.classList.add('error-toast');

    icon.textContent = '⚠️';
    msg.textContent = message;
    toast.style.display = 'flex';
    setTimeout(() => toast.style.display = 'none', 5000);
}

function showSuccess(message) {
    const toast = errorToast; // Reusing the same toast element
    const icon = toast.querySelector('.toast-icon');
    const msg = errorMessage;

    // Remove error class, add success class
    toast.classList.remove('error-toast');
    toast.classList.add('success-toast');

    icon.textContent = '✅';
    msg.textContent = message;
    toast.style.display = 'flex';
    setTimeout(() => {
        toast.style.display = 'none';
        // Reset to error style as default
        toast.classList.remove('success-toast');
        toast.classList.add('error-toast');
    }, 5000);
}

function resetUpload() {
    const resultsContent = document.getElementById('resultsContent');
    const actionSection = document.querySelector('.action-section');
    const hasData = Object.keys(filesData).length > 0;

    if (hasData) {
        if (resultsContent) resultsContent.style.display = 'block';
        if (actionSection) actionSection.style.display = 'block';
    } else {
        if (resultsContent) resultsContent.style.display = 'none';
        if (actionSection) actionSection.style.display = 'none';
    }

    uploadCard.style.display = 'block';
    uploadZone.style.display = 'block';
    uploadProgress.style.display = 'none';
    fileInput.value = '';

    // Scroll to upload zone if results are visible
    if (hasData) {
        uploadCard.scrollIntoView({ behavior: 'smooth' });
    }
}

function saveFilesData() {
    invalidateAggregatedData();
    localStorage.setItem('wfa_files', JSON.stringify(filesData));
}

function saveSavedMetadata() {
    localStorage.setItem('wfa_meta', JSON.stringify(savedMetadata));
}

function saveSavedWords() {
    invalidateAggregatedData();
    localStorage.setItem('wfa_saved', JSON.stringify(savedWords));
    saveSavedMetadata();
    updateHeaderSavedCount();
}

// Initialize app when DOM is fully loaded to prevent browser "loading" hang
document.addEventListener('DOMContentLoaded', () => {
    init();
});

// ==========================================
// Flashcards & SRS System
// ==========================================
let srsData = JSON.parse(localStorage.getItem('wfa_srs') || '{}');
let reviewQueue = [];
let currentCardIndex = 0;
let isFlipped = false;

const flashcardsSection = document.getElementById('flashcardsSection');
const flashcard = document.getElementById('flashcard');
const fcWord = document.getElementById('fcWord');
const fcDefinition = document.getElementById('fcDefinition');
const fcContext = document.getElementById('fcContext');
const fcProgressText = document.getElementById('fcProgressText');
const savedCard = document.getElementById('savedCard');
const openFlashcardsBtn = document.getElementById('openFlashcardsBtn');

if (savedCard) {
    savedCard.addEventListener('click', openFlashcards);
}
if (openFlashcardsBtn) {
    openFlashcardsBtn.addEventListener('click', openFlashcards);
}

const closeFlashcardsBtn = document.getElementById('closeFlashcardsBtn');
if (closeFlashcardsBtn) {
    closeFlashcardsBtn.addEventListener('click', () => {
        if (flashcardsSection) flashcardsSection.style.display = 'none';
    });
}

if (flashcardsSection) {
    flashcardsSection.addEventListener('click', (e) => {
        if (e.target === flashcardsSection) {
            flashcardsSection.style.display = 'none';
        }
    });
}

if (flashcard) {
    flashcard.addEventListener('click', (e) => {
        // Don't flip if clicking buttons
        if (e.target.tagName === 'BUTTON') return;

        isFlipped = !isFlipped;
        flashcard.classList.toggle('flipped', isFlipped);
    });
}

// Keyboard shortcuts for Flashcard review (Space to flip, 1-4 for SRS, Esc to close)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', (e) => {
        if (!flashcardsSection || flashcardsSection.style.display !== 'flex') return;

        if (e.key === 'Escape') {
            e.preventDefault();
            flashcardsSection.style.display = 'none';
            return;
        }

        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            isFlipped = !isFlipped;
            if (flashcard) flashcard.classList.toggle('flipped', isFlipped);
            return;
        }

        if (isFlipped) {
            if (e.key === '1') {
                e.preventDefault();
                handleSRS('again');
            } else if (e.key === '2') {
                e.preventDefault();
                handleSRS('hard');
            } else if (e.key === '3') {
                e.preventDefault();
                handleSRS('good');
            } else if (e.key === '4') {
                e.preventDefault();
                handleSRS('easy');
            }
        }
    });
}

function openFlashcards() {
    if (savedWords.length > 0) {
        // Build review queue
        const now = Date.now();
        reviewQueue = savedWords.filter(word => {
            const data = srsData[word];
            // If no data, it's new (due now). If data, check nextReview.
            return !data || data.nextReview <= now;
        });

        if (reviewQueue.length === 0) {
            reviewQueue = [...savedWords].sort(() => Math.random() - 0.5).slice(0, 15);
            showSuccess('Bạn đã hoàn thành các từ đến hạn! Đang mở ôn tập ngẫu nhiên.');
        } else {
            // Sort by due date (overdue first)
            reviewQueue.sort((a, b) => {
                const timeA = srsData[a] ? srsData[a].nextReview : 0;
                const timeB = srsData[b] ? srsData[b].nextReview : 0;
                return timeA - timeB;
            });
        }
    } else {
        // Fallback: If no saved words, use top words from currently analyzed book if available
        const currentData = (currentFilteredData && currentFilteredData.length > 0)
            ? currentFilteredData
            : (tableData || []);

        if (currentData.length > 0) {
            reviewQueue = currentData
                .filter(item => item.word && typeof item.word === 'string')
                .slice(0, 20)
                .map(item => item.word);

            showSuccess('Chưa có từ trong Sổ từ. Đang mở Flashcards cho Top từ vựng trong sách!');
        } else {
            showError('Chưa có từ vựng! Hãy tải sách lên hoặc bấm biểu tượng ⭐ trên các từ để bắt đầu luyện Flashcard.');
            return;
        }
    }

    if (!reviewQueue || reviewQueue.length === 0) {
        showError('Không có từ vựng nào để ôn tập!');
        return;
    }

    currentCardIndex = 0;
    loadCard();
    flashcardsSection.style.display = 'flex';
}

async function loadCard() {
    if (currentCardIndex >= reviewQueue.length) {
        flashcardsSection.style.display = 'none';
        showError('Session complete!');
        return;
    }

    const word = reviewQueue[currentCardIndex];
    isFlipped = false;
    flashcard.classList.remove('flipped');

    const isPhrase = isPhraseItem(word);
    const meta = savedMetadata[word.toLowerCase()] || {};

    const fcTypeBadge = document.getElementById('fcTypeBadge');
    if (fcTypeBadge) {
        fcTypeBadge.className = 'fc-type-badge ' + (isPhrase ? 'phrase' : 'word');
        fcTypeBadge.textContent = isPhrase ? 'Cụm từ / Phrase' : 'Từ đơn / Word';
    }

    const fcSpeakBtn = document.getElementById('fcSpeakBtn');
    if (fcSpeakBtn) {
        fcSpeakBtn.onclick = (e) => {
            e.stopPropagation();
            speakWord(word);
        };
    }

    fcWord.textContent = word;
    fcDefinition.innerHTML = 'Loading definition...';
    fcContext.textContent = 'Loading context...';
    fcProgressText.textContent = `${isPhrase ? 'Phrase' : 'Word'} ${currentCardIndex + 1} of ${reviewQueue.length}`;

    // Fetch details
    // 1. Definition from local server endpoint
    let dictResult = null;
    try {
        const res = await fetch(`/api/dictionary/${encodeURIComponent(word)}`);
        dictResult = await res.json();
    } catch (e) {
        // ignore
    }

    // Build definition HTML
    let defHtml = '';
    if (meta.meaning) {
        defHtml += `
            <div class="fc-custom-meaning">
                <div class="fc-custom-meaning-title">Nghĩa của bạn:</div>
                <div class="fc-custom-meaning-text">${escapeHtml(meta.meaning)}</div>
            </div>
        `;
    }

    if (dictResult && dictResult.meanings && dictResult.meanings.length > 0) {
        const firstMeaning = dictResult.meanings[0];
        let posText = (firstMeaning.pos || '').trim();
        if (posText.toLowerCase() === 'general') posText = '';
        const posPrefix = posText ? `(${posText}) ` : '';
        const dictDefText = `${posPrefix}${firstMeaning.def}`;
        if (meta.meaning) {
            defHtml += `<div style="font-size:0.85rem; color:#a8a8b3; margin-top:6px; text-align:left;">Từ điển: ${escapeHtml(dictDefText)}</div>`;
        } else {
            defHtml = dictDefText;
        }
    } else if (!meta.meaning) {
        defHtml = 'No definition found.';
    }

    fcDefinition.innerHTML = defHtml;

    // 2. Context (Find from saved custom context or local document data or dictionary fallback)
    if (meta.context) {
        fcContext.innerHTML = `"${escapeHtml(meta.context)}" <span style="font-size:0.85rem; color:#f472b6;">(Ví dụ đã lưu)</span>`;
    } else {
        const data = getAggregatedData();
        const item = data.results.find(i => i.word.toLowerCase() === word.toLowerCase());
        if (item && item.context && item.context.length > 0) {
            const ctx = item.context[0];
            const ctxText = typeof ctx === 'string' ? ctx : (ctx.text || '');
            const isDict = typeof ctx === 'object' && ctx.source === 'dictionary';
            fcContext.innerHTML = `"${escapeHtml(ctxText)}"${isDict ? ' <span style="font-size:0.85rem; color:#93c5fd;">(Ví dụ từ điển)</span>' : ''}`;
        } else if (dictResult && dictResult.examples && dictResult.examples.length > 0) {
            const ex = dictResult.examples[0];
            const exText = ex.en || ex.example || '';
            fcContext.innerHTML = `"${escapeHtml(exText)}" <span style="font-size:0.85rem; color:#93c5fd;">(Ví dụ từ điển)</span>`;
        } else {
            fcContext.textContent = isPhrase ? 'Custom added phrase (no book context excerpt available).' : 'Custom added word (no book context excerpt available).';
        }
    }

    // 3. Update SM-2 Interval Preview on Action Buttons
    updateSrsButtonLabels(word);
}

function formatSrsInterval(ms) {
    if (ms <= 60 * 1000) return '<1m';
    if (ms < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.round(ms / (60 * 1000)))}m`;
    const days = Math.round(ms / (24 * 60 * 60 * 1000));
    if (days < 30) return `${days}d`;
    return `${(days / 30).toFixed(1)}mo`;
}

function calculateNextIntervals(word) {
    const ONE_MIN = 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const item = srsData[word] || { interval: 0, reps: 0, ef: 2.5 };
    const reps = item.reps || 0;
    const ef = Math.max(1.3, item.ef || 2.5);
    const curr = item.interval || 0;

    const againInterval = ONE_MIN;
    const hardInterval = curr === 0 ? ONE_DAY : Math.max(ONE_DAY, Math.round(curr * 1.2));

    let goodInterval;
    if (reps === 0) goodInterval = ONE_DAY;
    else if (reps === 1) goodInterval = 6 * ONE_DAY;
    else goodInterval = Math.round(curr * ef);

    let easyInterval;
    if (reps === 0) easyInterval = 4 * ONE_DAY;
    else if (reps === 1) easyInterval = 10 * ONE_DAY;
    else easyInterval = Math.round(curr * ef * 1.3);

    return { againInterval, hardInterval, goodInterval, easyInterval };
}

function updateSrsButtonLabels(word) {
    const { againInterval, hardInterval, goodInterval, easyInterval } = calculateNextIntervals(word);
    const elAgain = document.getElementById('srsAgainTime');
    const elHard = document.getElementById('srsHardTime');
    const elGood = document.getElementById('srsGoodTime');
    const elEasy = document.getElementById('srsEasyTime');
    if (elAgain) elAgain.textContent = formatSrsInterval(againInterval);
    if (elHard) elHard.textContent = formatSrsInterval(hardInterval);
    if (elGood) elGood.textContent = formatSrsInterval(goodInterval);
    if (elEasy) elEasy.textContent = formatSrsInterval(easyInterval);
}

function handleSRS(rating) {
    const word = reviewQueue[currentCardIndex];
    if (!word) return;

    const ONE_MIN = 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    let prev = srsData[word] || { interval: 0, reps: 0, ef: 2.5, streak: 0 };
    let reps = prev.reps || 0;
    let ef = Math.max(1.3, prev.ef || 2.5);
    let curr = prev.interval || 0;
    let newInterval = 0;

    if (rating === 'again') {
        reps = 0;
        ef = Math.max(1.3, ef - 0.2);
        newInterval = ONE_MIN;
        prev.streak = 0;
    } else if (rating === 'hard') {
        reps = Math.max(1, reps);
        ef = Math.max(1.3, ef - 0.15);
        newInterval = curr === 0 ? ONE_DAY : Math.max(ONE_DAY, Math.round(curr * 1.2));
        prev.streak = Math.max(1, prev.streak || 0);
    } else if (rating === 'good') {
        reps += 1;
        if (reps === 1) newInterval = ONE_DAY;
        else if (reps === 2) newInterval = 6 * ONE_DAY;
        else newInterval = Math.round(curr * ef);
        prev.streak = (prev.streak || 0) + 1;
    } else if (rating === 'easy') {
        reps += 1;
        ef = Math.min(3.0, ef + 0.15);
        if (reps === 1) newInterval = 4 * ONE_DAY;
        else if (reps === 2) newInterval = 10 * ONE_DAY;
        else newInterval = Math.round(curr * ef * 1.3);
        prev.streak = (prev.streak || 0) + 1;
    }

    srsData[word] = {
        interval: newInterval,
        reps,
        ef: Number(ef.toFixed(2)),
        streak: prev.streak,
        nextReview: Date.now() + newInterval
    };

    localStorage.setItem('wfa_srs', JSON.stringify(srsData));

    // Ensure word is added to savedWords so it persists in the user's SRS review deck
    if (!savedWords.includes(word)) {
        savedWords.push(word);
        saveSavedWords();
        updateHeaderSavedCount();
        const savedEl = document.getElementById('savedCount');
        if (savedEl) savedEl.textContent = savedWords.length.toLocaleString();
    }

    // Next card
    currentCardIndex++;
    loadCard();
}

window.handleSRS = handleSRS;

// ==========================================
// Authentication & Sync
// ==========================================
let authToken = localStorage.getItem('wfa_token') || null;
let currentUser = null;

const loginModal = document.getElementById('loginModal');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userProfile = document.getElementById('userProfile');
const userEmailSpan = document.getElementById('userEmail');
const loginStep1 = document.getElementById('loginStep1');
const loginStep2 = document.getElementById('loginStep2');
const emailInput = document.getElementById('emailInput');
const otpInput = document.getElementById('otpInput');
const sendOtpBtn = document.getElementById('sendOtpBtn');
const verifyOtpBtn = document.getElementById('verifyOtpBtn');
const backToEmailBtn = document.getElementById('backToEmailBtn');
const otpEmailDisplay = document.getElementById('otpEmailDisplay');
const closeLoginBtn = document.getElementById('closeLoginBtn');

// Auth Init
if (authToken) {
    const savedUser = JSON.parse(localStorage.getItem('wfa_user') || '{}');
    if (savedUser.email) {
        setUser(savedUser);
        syncData(); // Sync on load
    }
}

function setUser(user) {
    currentUser = user;
    localStorage.setItem('wfa_user', JSON.stringify(user));

    loginBtn.style.display = 'none';
    userProfile.style.display = 'flex';
    userEmailSpan.textContent = user.email;
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('wfa_token');
    localStorage.removeItem('wfa_user');

    loginBtn.style.display = 'block';
    userProfile.style.display = 'none';

    // Optional: Clear local data? No, keep it.
    showError('Logged out');
}

// Event Listeners
loginBtn.addEventListener('click', () => {
    loginModal.style.display = 'flex';
    loginStep1.style.display = 'block';
    loginStep2.style.display = 'none';
    emailInput.value = '';
    otpInput.value = '';
});

closeLoginBtn.addEventListener('click', () => loginModal.style.display = 'none');
logoutBtn.addEventListener('click', logout);

// Dropdown menu toggle
const menuToggle = document.getElementById('menuToggle');
const userDropdown = document.getElementById('userDropdown');
const syncBtn = document.getElementById('syncBtn');

if (menuToggle) {
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = userDropdown.style.display === 'block';
        userDropdown.style.display = isVisible ? 'none' : 'block';
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!userProfile.contains(e.target)) {
            userDropdown.style.display = 'none';
        }
    });

    // Sync button
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            userDropdown.style.display = 'none';
            const originalIcon = '🔄';
            syncBtn.innerHTML = '<span class="dropdown-icon">⏳</span><span>Syncing...</span>';

            try {
                await syncData();
                syncBtn.innerHTML = '<span class="dropdown-icon">✅</span><span>Synced!</span>';
                showSuccess('Data synced successfully!');
            } catch (e) {
                syncBtn.innerHTML = '<span class="dropdown-icon">❌</span><span>Sync Failed</span>';
                showError('Sync failed');
            }

            setTimeout(() => {
                syncBtn.innerHTML = '<span class="dropdown-icon">🔄</span><span>Sync Data</span>';
            }, 2000);
        });
    }
}


sendOtpBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) return showError('Please enter email');

    sendOtpBtn.textContent = 'Sending...';
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        if (res.ok) {
            loginStep1.style.display = 'none';
            loginStep2.style.display = 'block';
            otpEmailDisplay.textContent = email;
        } else {
            showError('Failed to send code');
        }
    } catch (e) {
        showError('Network error');
    } finally {
        sendOtpBtn.textContent = 'Send Code';
    }
});

backToEmailBtn.addEventListener('click', () => {
    loginStep2.style.display = 'none';
    loginStep1.style.display = 'block';
});

verifyOtpBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const otp = otpInput.value.trim();
    if (!otp) return showError('Enter code');

    verifyOtpBtn.textContent = 'Verifying...';
    try {
        const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp })
        });
        const data = await res.json();

        if (res.ok) {
            authToken = data.token;
            localStorage.setItem('wfa_token', authToken);
            setUser(data.user);
            loginModal.style.display = 'none';
            showSuccess('Login successful!');
            syncData();
        } else {
            showError(data.error || 'Invalid code');
        }
    } catch (e) {
        showError('Verification failed');
    } finally {
        verifyOtpBtn.textContent = 'Verify & Login';
    }
});

// Sync Logic
async function syncData() {
    if (!authToken) return;

    try {
        // 1. Get remote words
        const res = await fetch('/api/user/words', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const remoteWords = await res.json();

        // 2. Merge Strategies
        // Current Local: savedWords (array of strings), srsData (dict)
        // Remote: Array of objects { word, srsInterval... }

        const localWordsSet = new Set(savedWords);
        const mergedWords = new Map();

        // Add local
        savedWords.forEach(w => {
            const meta = savedMetadata[w.toLowerCase()] || {};
            mergedWords.set(w, {
                word: w,
                type: meta.type || (w.includes(' ') ? 'phrase' : 'word'),
                meaning: meta.meaning || null,
                context: meta.context || null,
                notes: meta.notes || null,
                srsInterval: srsData[w]?.interval || 0,
                nextReview: srsData[w]?.nextReview || null,
                streak: srsData[w]?.streak || 0
            });
        });

        // Merge remote
        remoteWords.forEach(rw => {
            const existing = mergedWords.get(rw.word);
            mergedWords.set(rw.word, {
                word: rw.word,
                type: rw.type || (rw.word.includes(' ') ? 'phrase' : 'word'),
                meaning: rw.meaning || existing?.meaning || null,
                context: rw.context || existing?.context || null,
                notes: rw.notes || existing?.notes || null,
                srsInterval: rw.srsInterval,
                nextReview: rw.nextReview,
                streak: rw.streak
            });
            savedMetadata[rw.word.toLowerCase()] = {
                type: rw.type || (rw.word.includes(' ') ? 'phrase' : 'word'),
                meaning: rw.meaning || '',
                context: rw.context || '',
                notes: rw.notes || ''
            };
        });

        // Update Local State
        savedWords = Array.from(mergedWords.keys());

        const newSrsData = {};
        mergedWords.forEach((val, key) => {
            newSrsData[key] = {
                interval: val.srsInterval,
                nextReview: val.nextReview ? new Date(val.nextReview).getTime() : null,
                streak: val.streak
            };
        });
        srsData = newSrsData;

        saveSavedWords();
        localStorage.setItem('wfa_srs', JSON.stringify(srsData));

        if (Object.keys(filesData).length === 0 && savedWords.length > 0) {
            showSavedOnly = true;
            showResults();
        } else {
            updateStats();
            renderTable();
        }

        // 3. Push merged back to server
        const payload = Array.from(mergedWords.values());
        await fetch('/api/user/words/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ words: payload })
        });

        console.log('Sync complete');

    } catch (e) {
        console.error('Sync failed', e);
    }
}

// Hook into toggleSave to sync
const originalToggleSave = window.toggleSave;
window.toggleSave = function (word) {
    originalToggleSave(word); // updates local
    if (authToken) {
        syncOneWord(word);
    }
};

async function syncOneWord(word) {
    const isSaved = savedWords.includes(word);
    if (!isSaved) {
        // Delete
        await fetch(`/api/user/words/${encodeURIComponent(word)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
    } else {
        // Upsert
        const data = srsData[word] || {};
        const meta = savedMetadata[word.toLowerCase()] || {};
        await fetch('/api/user/words/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                words: [{
                    word,
                    type: meta.type || (word.includes(' ') ? 'phrase' : 'word'),
                    meaning: meta.meaning || null,
                    context: meta.context || null,
                    notes: meta.notes || null,
                    srsInterval: data.interval || 0,
                    nextReview: data.nextReview ? new Date(data.nextReview) : null,
                    streak: data.streak || 0
                }]
            })
        });
    }
}

// Hook into handleSRS to sync
const originalHandleSRS = window.handleSRS;
window.handleSRS = function (rating) {
    originalHandleSRS(rating);
    // Sync current card
    const word = reviewQueue[currentCardIndex - 1]; // index incremented in original
    if (authToken && word) {
        syncOneWord(word);
    }
};

// ==========================================
// Feedback System
// ==========================================
const feedbackBtn = document.getElementById('feedbackBtn'); // Legacy (if exists)
const footerFeedbackBtn = document.getElementById('footerFeedbackBtn');
const feedbackModal = document.getElementById('feedbackModal');
const closeFeedbackBtn = document.getElementById('closeFeedbackBtn');
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');
const fbType = document.getElementById('fbType');
const fbContent = document.getElementById('fbContent');
const fbEmail = document.getElementById('fbEmail');

// Open feedback modal handler
function openFeedbackModal() {
    feedbackModal.style.display = 'flex';
    if (currentUser && currentUser.email) {
        fbEmail.value = currentUser.email;
    }
}

if (feedbackBtn) {
    feedbackBtn.addEventListener('click', openFeedbackModal);
}

if (footerFeedbackBtn) {
    footerFeedbackBtn.addEventListener('click', openFeedbackModal);
}

if (closeFeedbackBtn) {
    closeFeedbackBtn.addEventListener('click', () => feedbackModal.style.display = 'none');

    submitFeedbackBtn.addEventListener('click', async () => {
        const type = fbType.value;
        const content = fbContent.value.trim();
        const email = fbEmail.value.trim();
        const honeypot = document.getElementById('fbHoneypot')?.value || '';
        const mediaInput = document.getElementById('fbMedia');
        const mediaFiles = mediaInput ? mediaInput.files : [];

        if (honeypot) {
            // Anti-spam silent reject
            feedbackModal.style.display = 'none';
            return;
        }

        if (!content && (!mediaFiles || mediaFiles.length === 0)) {
            return showError('Vui lòng nhập nội dung góp ý hoặc đính kèm ảnh chụp.');
        }

        submitFeedbackBtn.textContent = 'Sending...';
        submitFeedbackBtn.disabled = true;
        try {
            const formData = new FormData();
            formData.append('type', type);
            formData.append('content', content);
            if (email) formData.append('email', email);

            // Client Diagnostics
            const clientInfo = {
                ua: navigator.userAgent,
                screen: `${window.screen.width}x${window.screen.height}`,
                lang: navigator.language || 'en',
                timezone: Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : '',
                page: window.location.href
            };
            formData.append('client_info', JSON.stringify(clientInfo));

            // Append all selected files
            if (mediaFiles && mediaFiles.length > 0) {
                for (let i = 0; i < mediaFiles.length; i++) {
                    formData.append('media', mediaFiles[i]);
                }
            }

            const res = await fetch('/api/feedback', {
                method: 'POST',
                body: formData
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok && data.success) {
                showSuccess('Cảm ơn bạn! Góp ý đã được tiếp nhận và tự động chuyển đến đội ngũ phát triển.');
                feedbackModal.style.display = 'none';
                fbContent.value = '';
                fbEmail.value = '';
                if (mediaInput) mediaInput.value = '';
                const hpEl = document.getElementById('fbHoneypot');
                if (hpEl) hpEl.value = '';
            } else {
                showError(data.error || 'Failed to send feedback');
            }
        } catch (e) {
            showError('Network error');
        } finally {
            submitFeedbackBtn.textContent = 'Submit';
            submitFeedbackBtn.disabled = false;
        }
    });
}

// ==========================================
// Phrase & Advanced Vocabulary Management
// ==========================================
const phraseModal = document.getElementById('phraseModal');
const phraseModalTitle = document.getElementById('phraseModalTitle');
const closePhraseModalBtn = document.getElementById('closePhraseModalBtn');
const cancelPhraseBtn = document.getElementById('cancelPhraseBtn');
const savePhraseSubmitBtn = document.getElementById('savePhraseSubmitBtn');
const phraseInput = document.getElementById('phraseInput');
const phraseMeaning = document.getElementById('phraseMeaning');
const phraseContext = document.getElementById('phraseContext');
const phraseNotes = document.getElementById('phraseNotes');
const phraseTypeBadge = document.getElementById('phraseTypeBadge');
const lookupPhraseBtn = document.getElementById('lookupPhraseBtn');
const quickAddBtn = document.getElementById('quickAddBtn');
const quickReviewBtn = document.getElementById('quickReviewBtn');
const tableAddPhraseBtn = document.getElementById('tableAddPhraseBtn');

if (quickAddBtn) quickAddBtn.addEventListener('click', () => openAddPhraseModal());
if (tableAddPhraseBtn) tableAddPhraseBtn.addEventListener('click', () => openAddPhraseModal());
if (quickReviewBtn) quickReviewBtn.addEventListener('click', openFlashcards);

function updatePhraseModalTypeBadge() {
    if (!phraseInput || !phraseTypeBadge) return;
    const val = phraseInput.value.trim();
    const isPhrase = val.includes(' ');
    phraseTypeBadge.className = 'badge ' + (isPhrase ? 'badge-phrase' : 'badge-word');
    phraseTypeBadge.textContent = isPhrase ? 'Cụm từ (Phrase)' : 'Từ đơn (Word)';
}

if (phraseInput) {
    phraseInput.addEventListener('input', updatePhraseModalTypeBadge);
}

async function autoLookupPhrase(text) {
    if (!text || !lookupPhraseBtn) return;
    try {
        lookupPhraseBtn.textContent = '⏳ Đang tra...';
        lookupPhraseBtn.disabled = true;
        const res = await fetch(`/api/dictionary/${encodeURIComponent(text)}`);
        const data = await res.json();
        if (data && data.meanings && data.meanings.length > 0) {
            const defs = data.meanings.map(m => {
                const pos = m.pos && m.pos.toLowerCase() !== 'general' ? `(${m.pos}) ` : '';
                return `${pos}${m.def}`;
            }).slice(0, 3).join('; ');
            if (phraseMeaning && !phraseMeaning.value) {
                phraseMeaning.value = defs;
            }
        }
        if (data && data.examples && data.examples.length > 0 && phraseContext && !phraseContext.value) {
            const ex = data.examples[0];
            phraseContext.value = ex.en || ex.example || '';
        }
    } catch (e) {
        console.warn('Auto lookup failed', e);
    } finally {
        if (lookupPhraseBtn) {
            lookupPhraseBtn.textContent = '🔍 Tra nghĩa';
            lookupPhraseBtn.disabled = false;
        }
    }
}

if (lookupPhraseBtn) {
    lookupPhraseBtn.addEventListener('click', () => {
        if (phraseInput) autoLookupPhrase(phraseInput.value.trim());
    });
}

function openAddPhraseModal(initialText = '', initialContext = '') {
    if (!phraseModal) return;
    phraseModalTitle.textContent = 'Thêm Từ hoặc Cụm từ mới';
    phraseInput.value = initialText;
    phraseInput.disabled = false;
    phraseMeaning.value = '';
    phraseContext.value = initialContext;
    phraseNotes.value = '';
    updatePhraseModalTypeBadge();
    phraseModal.style.display = 'flex';
    phraseInput.focus();

    if (initialText) {
        autoLookupPhrase(initialText);
    }
}

function openEditPhraseModal(word) {
    if (!phraseModal) return;
    phraseModalTitle.textContent = `Chỉnh sửa: ${word}`;
    phraseInput.value = word;
    phraseInput.disabled = true;
    const meta = savedMetadata[word.toLowerCase()] || {};
    phraseMeaning.value = meta.meaning || '';
    phraseContext.value = meta.context || '';
    phraseNotes.value = meta.notes || '';
    updatePhraseModalTypeBadge();
    phraseModal.style.display = 'flex';
    phraseMeaning.focus();
}

function closePhraseModal() {
    if (phraseModal) phraseModal.style.display = 'none';
}

if (closePhraseModalBtn) closePhraseModalBtn.addEventListener('click', closePhraseModal);
if (cancelPhraseBtn) cancelPhraseBtn.addEventListener('click', closePhraseModal);

if (savePhraseSubmitBtn) {
    savePhraseSubmitBtn.addEventListener('click', () => {
        const wordText = phraseInput.value.trim();
        if (!wordText) {
            showError('Vui lòng nhập từ hoặc cụm từ');
            return;
        }
        const detectedType = wordText.includes(' ') ? 'phrase' : 'word';
        saveWordOrPhrase(wordText, {
            type: detectedType,
            meaning: phraseMeaning.value.trim(),
            context: phraseContext.value.trim(),
            notes: phraseNotes.value.trim()
        });
        closePhraseModal();
        showSuccess(`Đã lưu "${wordText}" vào sổ từ!`);
    });
}

window.openAddPhraseModal = openAddPhraseModal;
window.openEditPhraseModal = openEditPhraseModal;

// Floating selection handler for Context Modal
const floatingSavePhraseBtn = document.getElementById('floatingSavePhraseBtn');
const floatingPhraseText = document.getElementById('floatingPhraseText');

if (contextModalEl && floatingSavePhraseBtn) {
    document.addEventListener('selectionchange', () => {
        if (contextModalEl.style.display !== 'flex') {
            floatingSavePhraseBtn.style.display = 'none';
            return;
        }
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            floatingSavePhraseBtn.style.display = 'none';
            return;
        }
        const selectedText = selection.toString().trim();
        if (selectedText.length < 2 || selectedText.length > 80) {
            floatingSavePhraseBtn.style.display = 'none';
            return;
        }

        try {
            const range = selection.getRangeAt(0);
            if (!contextModalEl.contains(range.commonAncestorContainer)) {
                floatingSavePhraseBtn.style.display = 'none';
                return;
            }

            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                floatingSavePhraseBtn.style.display = 'none';
                return;
            }

            floatingPhraseText.textContent = selectedText.length > 25 ? selectedText.slice(0, 25) + '...' : selectedText;
            floatingSavePhraseBtn.style.display = 'block';
            floatingSavePhraseBtn.style.top = `${window.scrollY + rect.top - 8}px`;
            floatingSavePhraseBtn.style.left = `${Math.max(10, window.scrollX + rect.left + (rect.width / 2) - 80)}px`;
            floatingSavePhraseBtn.dataset.phrase = selectedText;

            let container = range.commonAncestorContainer;
            while (container && container !== contextModalEl && !(container.classList && container.classList.contains('context-item'))) {
                container = container.parentNode;
            }
            floatingSavePhraseBtn.dataset.context = container ? (container.querySelector('.context-text')?.textContent || '') : '';
        } catch {
            floatingSavePhraseBtn.style.display = 'none';
        }
    });

    floatingSavePhraseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const phrase = floatingSavePhraseBtn.dataset.phrase || '';
        const sentenceContext = floatingSavePhraseBtn.dataset.context || '';
        floatingSavePhraseBtn.style.display = 'none';
        openAddPhraseModal(phrase, sentenceContext);
    });
}
