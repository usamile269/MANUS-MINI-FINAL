// ============================================================================
// plugins/report-scam.js — Scam/fraud number reporting
// ----------------------------------------------------------------------------
// .report <number> <reason>  -> privately reports a scammer/fraud number.
// Reports are saved to the 'reports' collection (MongoDB via lib/mongo.js,
// falls back to local JSON) and forwarded to the bot owner's DM.
// Only the owner/admin can view reports (via admin panel or .reports cmd).
// Reports are NEVER shown publicly.
// ============================================================================

const { cmd } = require('../ahmad-core');
const { model } = require('../lib/mongo');

const Reports = model('reports');

cmd({
    pattern: 'report',
    alias: ['reportscam', 'reportfraud'],
    desc: 'Privately report a scammer/fraud number to the admin',
    category: 'general',
    react: '🚨',
    use: '.report 923001234567 wo paise leke bhag gaya'
}, async (conn, mek, m, { sender, pushname, reply, text, args, botNumber }) => {
    const raw = (text || args.join(' ')).trim();
    if (!raw) {
        return reply('🚨 *Report a Scammer*\n\nUse: .report <number> <reason>\nExample: .report 923001234567 paise leke bhag gaya\n\n⚠️ Reports go *privately* to the admin only — never public.');
    }

    const parts = raw.split(/\s+/);
    let num = parts[0].replace(/[^0-9]/g, '');
    if (num.startsWith('00')) num = num.slice(2);
    const reason = parts.slice(1).join(' ').trim();

    if (!/^\d{7,15}$/.test(num)) {
        return reply('❌ Invalid number. Example: .report 923001234567 reason yahan likho');
    }
    if (!reason || reason.length < 3) {
        return reply('❌ Please add a short reason.\nExample: .report 923001234567 fake deal karke paise liye');
    }

    const reporter = sender.split('@')[0];
    // Prevent self-reports and duplicate spam (same reporter+number within 24h)
    if (reporter === num) return reply('❌ You cannot report your own number.');
    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const dup = await Reports.findOne({ reporter, number: num, createdAt: { $gte: since } });
        if (dup) return reply('⚠️ You already reported this number in the last 24 hours.');
    } catch (e) { /* non-fatal */ }

    const doc = {
        number: num,
        reason: reason.slice(0, 500),
        reporter,
        reporterName: pushname || 'Unknown',
        status: 'pending', // pending | reviewed | blocked | dismissed
        createdAt: new Date().toISOString(),
    };
    try {
        await Reports.create(doc);
        // Auto-block check: 5+ reports → auto block
        const all = await Reports.find({ number: num });
        const pc = (all || []).filter(r => r.status === 'pending' || r.status === 'reviewed').length;
        if (pc >= 5) {
            await Reports.updateMany({ number: num }, { status: 'blocked', autoBlocked: true });
        }
    } catch (e) { console.log('[REPORT] save failed:', e.message); }

    // (Admin panel shows new reports via /reports — no WhatsApp spam)

    reply('✅ *Report received privately.*\n\nThe admin will review +'+num+' soon. Your identity stays private — reports are never shown publicly. Shukriya! 🙏');
});

// Owner-only: list pending reports in chat
cmd({
    pattern: 'reports',
    desc: 'Owner: list pending scam reports',
    category: 'owner',
    react: '📋',
    use: '.reports'
}, async (conn, mek, m, { sender, reply, isOwner }) => {
    if (!isOwner) return reply('❌ Owner only.');
    try {
        const list = await Reports.find({ status: 'pending' });
        if (!list || !list.length) return reply('✅ No pending reports. All clear!');
        const lines = list.slice(0, 15).map((r, i) =>
            `${i + 1}. 📞 +${r.number}\n   👤 by +${r.reporter} (${r.reporterName || '?'})\n   📝 ${r.reason}\n   🕐 ${r.createdAt ? r.createdAt.slice(0, 16).replace('T', ' ') : '?'}`
        );
        reply(`🚨 *Pending Scam Reports (${list.length})*\n\n${lines.join('\n\n')}\n\nUse admin panel for details & actions.`);
    } catch (e) {
        reply('❌ Could not load reports.');
    }
});
