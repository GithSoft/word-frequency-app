const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { parseFile } = require('../src/parsers');

async function runTest() {
    console.log('🧪 Testing EPUB Parser...');

    // 1. Generate a mock EPUB in memory
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    
    // Chapter 1
    zip.file('OEBPS/chapter1.xhtml', `
        <?xml version="1.0" encoding="utf-8"?>
        <!DOCTYPE html>
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Chapter 1</title></head>
        <body>
            <h1>Chapter 1: The Voyage</h1>
            <p>The mysterious vessel navigated through the perilous storm &amp; ferocious waves.</p>
            <p>Captain Miller didn&apos;t abandon his crew, despite the insurmountable odds.</p>
        </body>
        </html>
    `);

    // Chapter 2
    zip.file('OEBPS/chapter2.xhtml', `
        <?xml version="1.0" encoding="utf-8"?>
        <!DOCTYPE html>
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Chapter 2</title></head>
        <body>
            <h1>Chapter 2: Discovery</h1>
            <p>At dawn, an uncharted archipelago appeared on the horizon.</p>
        </body>
        </html>
    `);

    const tempPath = path.join(__dirname, 'mock_book.epub');
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.promises.writeFile(tempPath, content);

    try {
        const extractedText = await parseFile(tempPath, 'application/epub+zip');
        console.log('--- Extracted Text Preview ---');
        console.log(extractedText);
        console.log('------------------------------');

        if (!extractedText.includes('Chapter 1: The Voyage')) throw new Error('Missing Chapter 1 title');
        if (!extractedText.includes('perilous storm & ferocious waves')) throw new Error('HTML entity &amp; decode failed');
        if (!extractedText.includes("didn't abandon")) throw new Error("Entity &apos; decode failed");
        if (!extractedText.includes('uncharted archipelago')) throw new Error('Missing Chapter 2 text');

        console.log('✅ EPUB Parser successfully parsed all chapters with correct entity decoding!');
    } finally {
        if (fs.existsSync(tempPath)) {
            await fs.promises.unlink(tempPath);
        }
    }
}

runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
