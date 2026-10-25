const { parsePDF } = require('./pdf-parser');
const { parseDOCX } = require('./docx-parser');
const { parseTXT } = require('./txt-parser');
const { parseCSV } = require('./csv-parser');
const { parseEPUB } = require('./epub-parser');

/**
 * Parses a file based on its extension
 * @param {string} filePath - Path to the file
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<string>} Extracted text
 */
async function parseFile(filePath, mimeType) {
    const ext = filePath.split('.').pop().toLowerCase();

    switch (ext) {
        case 'pdf':
            return await parsePDF(filePath);

        case 'epub':
            return await parseEPUB(filePath);

        case 'docx':
        case 'doc':
            return await parseDOCX(filePath);

        case 'txt':
        case 'text':
            return await parseTXT(filePath);

        case 'csv':
            return await parseCSV(filePath);

        default:
            // Try to read as text if unknown type
            try {
                return await parseTXT(filePath);
            } catch {
                throw new Error(`Unsupported file type: ${ext}`);
            }
    }
}

module.exports = { parseFile };
