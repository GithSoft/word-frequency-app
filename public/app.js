/**
 * Word Frequency Analyzer - Frontend Application
 * Handles file uploads, caching, vocabulary saving, and visualization
 */

// ==========================================
// State Management
// ==========================================
let filesData = JSON.parse(localStorage.getItem('wfa_files') || '{}');
let savedWords = JSON.parse(localStorage.getItem('wfa_saved') || '[]');
let selectedFiles = new Set(); // Multi-select files
let showSavedOnly = false;

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

// ==========================================
// Initialization
// ==========================================
function init() {
    if (Object.keys(filesData).length > 0) {
        // Select all files by default
        selectedFiles = new Set(Object.keys(filesData));
        showResults();

        // Resume polling for processing files
        Object.values(filesData).forEach(file => {
            if (file.status === 'processing' && file.fileId) {
                fetchContexts(file.fileId, file.fileName);
            }
        });
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

    uploadCard.style.display = 'none';
    if (resultsContent) resultsContent.style.display = 'block';
    if (actionSection) actionSection.style.display = 'block';

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

        html += `
      <div class="file-chip ${checked && !showSavedOnly ? 'active' : ''} ${status}">
        <label class="file-label" title="${fileName}">
          <input type="checkbox" value="${fileName}" ${checked && !showSavedOnly ? 'checked' : ''} onchange="toggleFile('${fileName}', this.checked)">
          ${statusIcon}
          <span>${shortName}</span>
        </label>
        <button class="delete-file-btn" onclick="deleteFile('${fileName}')" title="Remove file">×</button>
      </div>
    `;
    });

    // Saved words option
    if (savedWords.length > 0) {
        html += `
      <label class="file-checkbox saved-filter ${showSavedOnly ? 'active' : ''}">
        <input type="checkbox" value="saved" ${showSavedOnly ? 'checked' : ''} onchange="toggleSavedOnly(this.checked)">
        <span>⭐ Saved (${savedWords.length})</span>
      </label>
    `;
    }

    html += `
      </div>
    </div>
  `;

    fileSelector.innerHTML = html;
}

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
}

let cachedAggregatedData = null;

function invalidateAggregatedData() {
    cachedAggregatedData = null;
}

function getAggregatedData() {
    if (cachedAggregatedData) {
        return cachedAggregatedData;
    }

    const wordMap = new Map(); // word -> { count, context[] }
    let totalWords = 0;

    // Aggregate selected files only
    Object.entries(filesData).forEach(([fileName, file]) => {
        if (!selectedFiles.has(fileName)) return;

        file.analysis.results.forEach(item => {
            const existing = wordMap.get(item.word);
            if (existing) {
                existing.count += item.count;
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
            context: data.context,
            percentage: totalWords > 0 ? ((data.count / totalWords) * 100).toFixed(2) : '0.00'
        }))
        .sort((a, b) => b.count - a.count);

    // Filter for saved words only
    if (showSavedOnly) {
        const savedSet = new Set(savedWords);
        results = results.filter(item => savedSet.has(item.word));
    }

    // Precompute rank (1-indexed based on frequency order)
    results.forEach((item, index) => {
        item.rank = index + 1;
    });

    cachedAggregatedData = {
        results,
        totalWords,
        uniqueWords: wordMap.size
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
                renderWordCloud();
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
    return `
    <tr class="word-row" onclick="showContext('${item.word}')">
      <td>${item.rank}</td>
      <td class="word-cell">
        <span class="word-text">${item.word}</span>
        <button class="icon-btn tts-hover-btn" onclick="event.stopPropagation(); speakWord('${item.word}')" title="Listen">🔊</button>
      </td>
      <td>${item.count.toLocaleString()}</td>
      <td>${item.percentage}%</td>
      <td onclick="event.stopPropagation()">
        <button class="save-btn ${isSaved ? 'saved' : ''}" 
                onclick="toggleSave('${item.word}')" 
                title="${isSaved ? 'Remove from saved' : 'Save word'}">
          ${isSaved ? '⭐' : '☆'}
        </button>
      </td>
    </tr>
  `;
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
    tableData = data.results;
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
    }
}

function updateTable() {
    const searchTerm = searchBox.value.toLowerCase().trim();

    currentFilteredData = searchTerm
        ? tableData.filter(item => item.word.toLowerCase().includes(searchTerm))
        : [...tableData];

    currentFilteredData.sort((a, b) => {
        let aVal, bVal;
        switch (sortColumn) {
            case 'rank':
                aVal = a.rank;
                bVal = b.rank;
                break;
            case 'word':
                aVal = a.word;
                bVal = b.word;
                break;
            case 'count':
                aVal = a.count;
                bVal = b.count;
                break;
            case 'percentage':
                aVal = parseFloat(a.percentage);
                bVal = parseFloat(b.percentage);
                break;
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
// Save Words Feature
// ==========================================
function toggleSave(word) {
    const index = savedWords.indexOf(word);
    if (index > -1) {
        savedWords.splice(index, 1);
    } else {
        savedWords.push(word);
    }
    saveSavedWords();
    invalidateAggregatedData();
    if (showSavedOnly) {
        tableData = getAggregatedData().results;
    }
    updateFileSelector();
    updateTable();
    updateStats();
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

async function showContext(word) {
    const data = getAggregatedData();
    const item = data.results.find(i => i.word === word);

    if (!item) return;

    const modal = document.getElementById('contextModal');
    const wordSpan = document.getElementById('contextWord');
    const list = document.getElementById('contextSentences');

    // Setup Header with Word and Actions
    wordSpan.innerHTML = `
        ${word}
        <button class="icon-btn" onclick="speakWord('${word}')" title="Listen" style="font-size: 1rem; margin-left: 8px;">🔊</button>
        <a href="https://translate.google.com/?sl=auto&tl=vi&text=${word}" target="_blank" class="icon-btn" title="Translate (Google)" style="font-size: 1rem; text-decoration: none;">🌐</a>
    `;

    // Reset and show loading state
    list.innerHTML = '<div class="loading">Loading details...</div>';
    modal.style.display = 'flex';

    // Check if any selected file is still processing
    const processingFiles = Object.values(filesData).filter(f => selectedFiles.has(f.fileName) && f.status === 'processing');

    const contexts = item.context || [];
    let contextHtml = '';

    // Prepare Context HTML
    contextHtml += '<div class="section-title">Context Examples</div>';

    if (processingFiles.length > 0 && contexts.length === 0) {
        contextHtml += `
            <div class="context-item info-message">
                <div class="spinner-dot"></div>
                Analysis in progress... Context examples will appear shortly.
            </div>`;
    } else if (contexts.length === 0) {
        contextHtml += '<div class="context-item">No context examples found for this word.</div>';
    } else {
        contexts.forEach(sentence => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            const highlighted = sentence.replace(regex, match => `<strong>${match}</strong>`);
            contextHtml += `<div class="context-item">${highlighted}</div>`;
        });
    }

    // Fetch Definitions
    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        const defs = await res.json();

        let defHtml = '<div class="section-title">Definitions</div>';
        if (Array.isArray(defs) && defs.length > 0) {
            defs[0].meanings.forEach(m => {
                defHtml += `<div class="definition-group">
                    <span class="part-of-speech">${m.partOfSpeech}</span>
                    <ul class="def-list">${m.definitions.slice(0, 2).map(d => `<li>${d.definition}</li>`).join('')}</ul>
                </div>`;
            });
        } else {
            defHtml += '<p class="no-data">No definitions found.</p>';
        }

        list.innerHTML = `
            <div class="definitions-section">${defHtml}</div>
            <div class="contexts-section">${contextHtml}</div>
        `;
    } catch (err) {
        console.error('Dict fetch error', err);
        // Fallback to just showing context
        list.innerHTML = `
            <div class="definitions-section"><p class="error-text">Could not load definitions.</p></div>
            <div class="contexts-section">${contextHtml}</div>
        `;
    }
}

window.showContext = showContext;
window.speakWord = speakWord;

// Modal close handlers
document.getElementById('closeModalBtn').addEventListener('click', () => {
    document.getElementById('contextModal').style.display = 'none';
});

document.getElementById('contextModal').addEventListener('click', (e) => {
    if (e.target.id === 'contextModal') {
        document.getElementById('contextModal').style.display = 'none';
    }
});

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

exportBtn.addEventListener('click', () => {
    const data = getAggregatedData();
    if (!data.results.length) return;

    const savedSet = new Set(savedWords);
    const csv = [
        ['Rank', 'Word', 'Count', 'Percentage', 'Saved'],
        ...data.results.map((item, idx) => [
            item.rank || (idx + 1),
            item.word,
            item.count,
            item.percentage + '%',
            savedSet.has(item.word) ? 'Yes' : ''
        ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'word-frequency-analysis.csv';
    a.click();
    URL.revokeObjectURL(url);
});

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

function saveSavedWords() {
    invalidateAggregatedData();
    localStorage.setItem('wfa_saved', JSON.stringify(savedWords));
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

if (savedCard) {
    savedCard.addEventListener('click', openFlashcards);
}

document.getElementById('closeFlashcardsBtn').addEventListener('click', () => {
    flashcardsSection.style.display = 'none';
});

flashcard.addEventListener('click', (e) => {
    // Don't flip if clicking buttons
    if (e.target.tagName === 'BUTTON') return;

    isFlipped = !isFlipped;
    flashcard.classList.toggle('flipped', isFlipped);
});

function openFlashcards() {
    if (savedWords.length === 0) {
        showError('No saved words to review!');
        return;
    }

    // Build review queue
    const now = Date.now();
    reviewQueue = savedWords.filter(word => {
        const data = srsData[word];
        // If no data, it's new (due now). If data, check nextReview.
        return !data || data.nextReview <= now;
    });

    if (reviewQueue.length === 0) {
        // Optional: Allow reviewing all if nothing due? 
        // For now, let's just say "All caught up! Reviewing random words."
        reviewQueue = [...savedWords].sort(() => Math.random() - 0.5).slice(0, 10);
        showError('All caught up! Starting random review.');
    } else {
        // Sort by due date (overdue first)
        reviewQueue.sort((a, b) => {
            const timeA = srsData[a] ? srsData[a].nextReview : 0;
            const timeB = srsData[b] ? srsData[b].nextReview : 0;
            return timeA - timeB;
        });
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

    fcWord.textContent = word;
    fcDefinition.innerHTML = 'Loading definition...';
    fcContext.textContent = 'Loading context...';
    fcProgressText.textContent = `Word ${currentCardIndex + 1} of ${reviewQueue.length}`;

    // Fetch details
    // 1. Definition
    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        const defs = await res.json();
        if (Array.isArray(defs) && defs.length > 0 && defs[0].meanings.length > 0) {
            const firstDef = defs[0].meanings[0].definitions[0].definition;
            fcDefinition.textContent = firstDef;
        } else {
            fcDefinition.textContent = 'No definition found.';
        }
    } catch (e) {
        fcDefinition.textContent = 'Could not load definition.';
    }

    // 2. Context (Find from local data)
    const data = getAggregatedData();
    const item = data.results.find(i => i.word === word);
    if (item && item.context && item.context.length > 0) {
        fcContext.innerHTML = `"${item.context[0]}"`;
    } else {
        fcContext.textContent = 'No context available.';
    }
}

function handleSRS(rating) {
    const word = reviewQueue[currentCardIndex];
    let interval = 1; // Default 1 minute
    let nextReview = Date.now();

    // Simple SRS Algorithm
    // existing: { interval (mins), multiplier }
    // Hard: 1 min
    // Good: 1 day (1440 mins) or curr * 2
    // Easy: 4 days (5760 mins) or curr * 4

    // Storing intervals in MINUTES
    // 1 day = 1440 mins

    const ONE_MIN = 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    let prevData = srsData[word] || { interval: 0, streak: 0 };
    let newInterval = 0; // ms

    if (rating === 'hard') {
        newInterval = ONE_MIN;
        prevData.streak = 0;
    } else if (rating === 'good') {
        if (prevData.streak === 0) newInterval = ONE_DAY; // 1 day
        else newInterval = prevData.interval * 2;
        prevData.streak++;
    } else if (rating === 'easy') {
        if (prevData.streak === 0) newInterval = 4 * ONE_DAY; // 4 days
        else newInterval = prevData.interval * 4;
        prevData.streak++;
    }

    srsData[word] = {
        interval: newInterval,
        streak: prevData.streak,
        nextReview: Date.now() + newInterval
    };

    localStorage.setItem('wfa_srs', JSON.stringify(srsData));

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
            mergedWords.set(w, {
                word: w,
                srsInterval: srsData[w]?.interval || 0,
                nextReview: srsData[w]?.nextReview || null,
                streak: srsData[w]?.streak || 0
            });
        });

        // Merge remote
        remoteWords.forEach(rw => {
            const existing = mergedWords.get(rw.word);
            // Remote wins for SRS data if newer? 
            // For simplicity, just overwrite local if remote exists
            mergedWords.set(rw.word, {
                word: rw.word,
                srsInterval: rw.srsInterval,
                nextReview: rw.nextReview,
                streak: rw.streak
            });
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

        updateStats();
        renderTable();

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
        // Debounce or just fire? Fire for now.
        // We only need to sync this specific word or all.
        // Let's just trigger full sync for simplicity or optimizing later.
        // Optimization: just sync this word
        syncOneWord(word);
    }
};

async function syncOneWord(word) {
    const isSaved = savedWords.includes(word);
    if (!isSaved) {
        // Delete
        await fetch(`/api/user/words/${word}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
    } else {
        // Upsert
        const data = srsData[word] || {};
        await fetch('/api/user/words/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                words: [{
                    word,
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
        const mediaInput = document.getElementById('fbMedia');
        const mediaFiles = mediaInput.files;

        if (!content) return showError('Please enter a message');

        submitFeedbackBtn.textContent = 'Sending...';
        try {
            const formData = new FormData();
            formData.append('type', type);
            formData.append('content', content);
            if (email) formData.append('email', email);

            // Append all selected files
            for (let i = 0; i < mediaFiles.length; i++) {
                formData.append('media', mediaFiles[i]);
            }

            const res = await fetch('/api/feedback', {
                method: 'POST',
                body: formData // Don't set Content-Type header, browser will set it with boundary
            });

            if (res.ok) {
                showSuccess('Feedback sent! Thank you.');
                feedbackModal.style.display = 'none';
                fbContent.value = '';
                fbEmail.value = '';
                mediaInput.value = ''; // Clear file input
            } else {
                showError('Failed to send feedback');
            }
        } catch (e) {
            showError('Network error');
        } finally {
            submitFeedbackBtn.textContent = 'Submit';
        }
    });
}
