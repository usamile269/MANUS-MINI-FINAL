const { cmd } = require('../lib/command');
const { PDFDocument } = require('pdf-lib');

cmd({
    pattern: "topdf",
    desc: "Convert images to PDF (reply to image or send with caption)",
    category: "utility",
    use: ".topdf (reply to image)",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        // Get quoted image
        const quoted = m.quoted;
        if (!quoted) return reply("Please reply to an image with .topdf");
        
        const mime = (quoted.msg || quoted).mimetype || '';
        if (!mime.startsWith('image/')) return reply("Please reply to an image file.");
        
        await reply("Converting to PDF...");
        
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const stream = await downloadContentFromMessage(quoted, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        
        const pdfDoc = await PDFDocument.create();
        let image;
        if (mime.includes('png')) {
            image = await pdfDoc.embedPng(buffer);
        } else {
            image = await pdfDoc.embedJpg(buffer);
        }
        
        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        
        const pdfBytes = await pdfDoc.save();
        
        await conn.sendMessage(from, {
            document: Buffer.from(pdfBytes),
            mimetype: 'application/pdf',
            fileName: `converted_${Date.now()}.pdf`
        }, { quoted: mek });
        
    } catch (e) {
        console.log('[TOPDF] error:', e.message);
        reply("Failed to convert to PDF. Try again.");
    }
});
