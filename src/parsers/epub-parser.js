const fs = require('fs');
const JSZip = require('jszip');

/**
 * Extracts plain text from an EPUB file buffer
 * @param {string} filePath - Path to the EPUB file
 * @returns {Promise<string>} Extracted book text
 */
async function parseEPUB(filePath) {
    const buffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);

    // Collect all HTML/XHTML content documents
    const contentFiles = Object.keys(zip.files).filter(filename => {
        const lower = filename.toLowerCase();
        return (
            (lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xml')) &&
            !zip.files[filename].dir &&
            !lower.includes('mimetype') &&
            !lower.includes('container.xml') &&
            !lower.includes('toc.ncx') &&
            !lower.includes('nav.xhtml')
        );
    });

    // Sort to maintain sequential chapter reading order
    contentFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const textSections = [];

    for (const fileName of contentFiles) {
        try {
            const rawContent = await zip.files[fileName].async('text');

            // Strip style and script blocks
            let clean = rawContent
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                .replace(/<[^>]+>/g, ' '); // Strip all HTML/XML tags

            // Decode common HTML entities
            clean = clean
                .replace(/&nbsp;/gi, ' ')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/&quot;/gi, '"')
                .replace(/&#39;/gi, "'")
                .replace(/&apos;/gi, "'")
                .replace(/&mdash;/gi, ' — ')
                .replace(/&ndash;/gi, ' – ')
                .replace(/&hellip;/gi, '…')
                .replace(/\s+/g, ' ')
                .trim();

            if (clean.length > 0) {
                textSections.push(clean);
            }
        } catch (_) {
            // Skip corrupted sub-file
        }
    }

    if (textSections.length === 0) {
        throw new Error('No readable text content found inside EPUB file.');
    }

    return textSections.join('\n\n');
}

module.exports = { parseEPUB };
