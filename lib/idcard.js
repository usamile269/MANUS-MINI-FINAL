// lib/idcard.js — generates the Ahmad MD member ID card as a real PNG image
// (@napi-rs/canvas + qrcode). Used by the user panel ("Download my card")
// and the .idcard WhatsApp command.
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const QRCode = require('qrcode');

let fontsPromise = null;
function registerFromDir(dir) {
    let n = 0;
    try {
        for (const f of fs.readdirSync(dir)) {
            if (f.toLowerCase().endsWith('.ttf')) {
                try { GlobalFonts.registerFromPath(path.join(dir, f)); n++; } catch {}
            }
        }
    } catch {}
    return n;
}
// Poppins (the card font) is fetched once per boot into the tmp dir — the
// repo stays free of binary font files — with DejaVu Sans as the fallback
// in the font stack if the download is unavailable.
function ensureFonts() {
    if (fontsPromise) return fontsPromise;
    fontsPromise = (async () => {
        const local = process.env.IDCARD_FONTS_DIR || path.join(__dirname, '..', 'assets', 'fonts');
        if (registerFromDir(local) >= 2) return;
        try {
            const os = require('os');
            const dir = path.join(os.tmpdir(), 'ahmad-md-fonts');
            fs.mkdirSync(dir, { recursive: true });
            const base = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/';
            for (const w of ['Regular', 'SemiBold', 'Bold']) {
                const file = path.join(dir, `Poppins-${w}.ttf`);
                if (!fs.existsSync(file) || fs.statSync(file).size < 50000) {
                    const res = await fetch(base + `Poppins-${w}.ttf`);
                    if (!res.ok) throw new Error('font download failed');
                    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
                }
            }
            registerFromDir(dir);
        } catch {}
    })();
    return fontsPromise;
}
const FONT = '"Poppins", "DejaVu Sans", sans-serif';

function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function fitText(ctx, text, maxWidth) {
    let t = String(text || '');
    if (ctx.measureText(t).width <= maxWidth) return t;
    while (t.length && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
}
// The toolkit's verified seal, scaled to size s at (x, y).
function drawTick(ctx, x, y, s) {
    const pts = [[23.4,12],[21.9,14],[22.5,16.4],[20.4,17.6],[20.1,20.1],[17.6,20.4],[16.4,22.5],[14,21.9],[12,23.4],[10,21.9],[7.6,22.5],[6.4,20.4],[3.9,20.1],[3.6,17.6],[1.5,16.4],[2.1,14],[0.6,12],[2.1,10],[1.5,7.6],[3.6,6.4],[3.9,3.9],[6.4,3.6],[7.6,1.5],[10,2.1],[12,0.6],[14,2.1],[16.4,1.5],[17.6,3.6],[20.1,3.9],[20.4,6.4],[22.5,7.6],[21.9,10]];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 24, s / 24);
    ctx.beginPath();
    pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
    ctx.closePath();
    ctx.fillStyle = '#0095F6';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8.1, 12.5); ctx.lineTo(10.6, 15); ctx.lineTo(15.9, 9.4);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

async function generateIdCard({ name, number, picUrl, logoUrl, botName, statusText, connected } = {}) {
    await ensureFonts();
    const W = 1000, H = 630;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const displayName = (name || '').trim() || ('+' + number);
    const bot = (botName || 'Ahmad MD').trim();

    // Background: dark zinc + soft brand glows
    ctx.fillStyle = '#0c0c0d';
    ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(880, -60, 60, 880, -60, 640);
    g.addColorStop(0, 'rgba(34,197,94,0.28)'); g.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(40, 660, 60, 40, 660, 620);
    g.addColorStop(0, 'rgba(14,165,233,0.24)'); g.addColorStop(1, 'rgba(14,165,233,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Card border
    rr(ctx, 14, 14, W - 28, H - 28, 30);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2; ctx.stroke();

    // Header: brand pic (owner's Bot Image from the Control Center) in a
    // circle — or the gradient "A" mark when no pic is set.
    let logoImg = null;
    if (logoUrl) { try { logoImg = await loadImage(logoUrl); } catch { logoImg = null; } }
    if (logoImg) {
        ctx.save();
        ctx.beginPath(); ctx.arc(86, 80, 34, 0, Math.PI * 2); ctx.clip();
        const sc = Math.max(68 / logoImg.width, 68 / logoImg.height);
        ctx.drawImage(logoImg, 86 - (logoImg.width * sc) / 2, 80 - (logoImg.height * sc) / 2, logoImg.width * sc, logoImg.height * sc);
        ctx.restore();
        ctx.beginPath(); ctx.arc(86, 80, 34, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    } else {
        const lg = ctx.createLinearGradient(54, 48, 118, 112);
        lg.addColorStop(0, '#22c55e'); lg.addColorStop(1, '#0ea5e9');
        rr(ctx, 54, 48, 64, 64, 16);
        ctx.fillStyle = lg; ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `700 36px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('A', 86, 82);
        ctx.textAlign = 'left';
    }
    ctx.fillStyle = '#f4f4f5';
    ctx.font = `700 37px ${FONT}`;
    ctx.fillText('AHMAD MD', 138, 72);
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText('O F F I C I A L   M E M B E R   C A R D', 139, 103);

    // Status chip (top right)
    const chipText = connected ? '● ACTIVE' : '● OFFLINE';
    ctx.font = `600 17px ${FONT}`;
    const chipW = ctx.measureText(chipText).width + 40;
    rr(ctx, W - 54 - chipW, 54, chipW, 44, 22);
    ctx.fillStyle = connected ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.13)';
    ctx.fill();
    ctx.strokeStyle = connected ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)';
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = connected ? '#4ade80' : '#fca5a5';
    ctx.fillText(chipText, W - 54 - chipW + 20, 77);

    // Divider
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(54, 140, W - 108, 2);

    // Profile photo (circle, gradient ring) or initial fallback
    const cx = 164, cy = 268, rad = 104;
    const ring = ctx.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
    ring.addColorStop(0, '#22c55e'); ring.addColorStop(1, '#0ea5e9');
    ctx.beginPath(); ctx.arc(cx, cy, rad + 6, 0, Math.PI * 2);
    ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = '#1f2937'; ctx.fill();
    let picImg = null;
    if (picUrl) { try { picImg = await loadImage(picUrl); } catch { picImg = null; } }
    if (picImg) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip();
        const scale = Math.max((rad * 2) / picImg.width, (rad * 2) / picImg.height);
        const dw = picImg.width * scale, dh = picImg.height * scale;
        ctx.drawImage(picImg, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
    } else {
        ctx.fillStyle = '#fff';
        ctx.font = `700 92px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText((displayName || 'A').charAt(0).toUpperCase(), cx, cy + 4);
        ctx.textAlign = 'left';
    }

    // Name / number / details
    const tx = 316;
    ctx.fillStyle = '#f4f4f5';
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(fitText(ctx, displayName, 620), tx, 218);
    ctx.fillStyle = '#d4d4d8';
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText('+' + number, tx, 268);
    const rows = [
        ['BOT NAME', bot],
        ['STATUS', statusText || (connected ? 'Connected' : 'Offline')]
    ];
    let ry = 330;
    for (const [label, value] of rows) {
        ctx.fillStyle = '#a1a1aa';
        ctx.font = `600 15px ${FONT}`;
        ctx.fillText(label, tx, ry);
        ctx.fillStyle = '#f4f4f5';
        ctx.font = `600 25px ${FONT}`;
        ctx.fillText(fitText(ctx, value, 600), tx, ry + 32);
        ry += 78;
    }

    // Bottom-left: developed-by line with the real seal
    drawTick(ctx, 54, H - 92, 30);
    ctx.fillStyle = '#d4d4d8';
    ctx.font = `500 19px ${FONT}`;
    ctx.fillText('Developed by', 96, H - 76);
    const dw2 = ctx.measureText('Developed by ').width;
    ctx.fillStyle = '#f4f4f5';
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText('Dev Ahmad', 96 + dw2, H - 76);

    // QR (bottom right) — scans to the member's own WhatsApp
    try {
        const qrBuf = await QRCode.toBuffer('https://wa.me/' + number, { type: 'png', width: 168, margin: 1 });
        const qrImg = await loadImage(qrBuf);
        const qx = W - 54 - 150, qy = H - 196;
        rr(ctx, qx - 8, qy - 8, 166, 166, 14);
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.drawImage(qrImg, qx, qy, 150, 150);
        ctx.fillStyle = '#a1a1aa';
        ctx.font = `600 13px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('SCAN TO CHAT', qx + 75, qy + 186);
        ctx.textAlign = 'left';
    } catch {}

    return canvas.toBuffer('image/png');
}

module.exports = { generateIdCard };
