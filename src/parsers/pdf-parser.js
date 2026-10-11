const pdfParse = require('pdf-parse');
const fs = require('fs');

/**
 * Parses PDF file and extracts text
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} Extracted text
 */
async function parsePDF(filePath) {
    try {
        const dataBuffer = await fs.promises.readFile(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    } catch (error) {
        throw new Error(`Failed to parse PDF: ${error.message}`);
    }
}

module.exports = { parsePDF };
