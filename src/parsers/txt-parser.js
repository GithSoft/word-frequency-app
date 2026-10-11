const fs = require('fs');

/**
 * Parses TXT file and extracts text
 * @param {string} filePath - Path to TXT file
 * @returns {Promise<string>} Extracted text
 */
async function parseTXT(filePath) {
    try {
        return await fs.promises.readFile(filePath, 'utf-8');
    } catch (error) {
        throw new Error(`Failed to parse TXT: ${error.message}`);
    }
}

module.exports = { parseTXT };
