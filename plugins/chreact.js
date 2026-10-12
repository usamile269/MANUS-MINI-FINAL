// 🆕 .chreact — channel ki latest post par ALL connected sessions se react.
// Ahmad: "User koii bhii emoji amount use kar skein"
// Use: .chreact <emoji(s)> [amount] [test]
// Misal: .chreact 👌🏻💯😘 6
//        .chreact 😘 test   <- DRY RUN: bhejega nahi, sirf batayega kya hota
//
// ⚠️ WhatsApp ka rule: 1 account = 1 react per post. Is liye "amount" kabhi
// connected sessions se zyada nahi ho sakta — zyada manga to cap karke
// honestly report hota hai. Fake/ghost reacts ka koi option nahi: WhatsApp
// par react sirf asal account se lagta hai, jhoot bolne wala code nahi hai.
const { cmd } = require('../ahmad-core');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Emoji extract: glued (👌🏻💯😘) ya spaced dono chalte hain. Skin-tone aur
// ZWJ sequences bhi sahi pakre jate hain.
const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}+)*/gu;

cmd({
    pattern: 'chreact',
    alias: ['channelreact', 'chre'],
    desc: 'Latest channel post par sab sessions se react',
    category: 'channel',
    react: '💯',
}, async (conn, mek, m, { q, reply }) => {
    try {
        // ---------- parse: emojis + optional trailing amount + test flag ----------
        let raw = (q || '').trim();
        // test/dry flag: ".chreact 😘 test" — kuch nahi bhejega, sirf plan batayega
        const dryRun = /\b(test|dry|dryrun|--dry)\b/i.test(raw);
        raw = raw.replace(/\b(test|dry|dryrun|--dry)\b/gi, '').trim();
        let amount = 0;
        let emojiPart = raw;
        const mAmt = raw.match(/^(.*?)(\d+)\s*$/);
        if (mAmt && mAmt[1].trim()) {
            amount = parseInt(mAmt[2], 10);
            emojiPart = mAmt[1].trim();
        }
        const emojis = [...new Set(emojiPart.match(EMOJI_RE) || [])];
        if (!emojis.length) {
            return reply('❓ *Use:* .chreact <emoji> [amount] [test]\n\n_Misal:_ `.chreact 👌🏻💯😘 6`\n_Test:_ `.chreact 😘 test`\n_1 account = 1 react (WhatsApp ka rule)_');
        }

        // ---------- channel JIDs (autoreact wali hi config) ----------
        const config = require('../config');
        const newsletterJids = (Array.isArray(config.AUTO_FOLLOW_JIDS) && config.AUTO_FOLLOW_JIDS.length)
            ? config.AUTO_FOLLOW_JIDS
            : (config.CHANNEL_JID ? [config.CHANNEL_JID] : []);
        if (!newsletterJids.length) return reply('❌ Koi channel configure nahi hai.');

        // ---------- latest tracked post ----------
        const lastPosts = global.__lastChannelPost || {};
        const targets = newsletterJids.filter(j => lastPosts[j] && lastPosts[j].serverId);
        if (!targets.length) {
            return reply('⏳ Abhi tak koi post track nahi hui.\n_Channel me nayi post aate hi dobara try karo!_');
        }

        // ---------- genuinely connected sessions ----------
        const reg = global.__ahmadSessionRegistry || {};
        const activeSockets = reg.activeSockets;
        const openState = reg.connectionOpenState;
        const conns = [];
        if (activeSockets) {
            for (const [num, sock] of activeSockets) {
                if (openState && openState.get(num) !== true) continue;
                if (sock && typeof sock.newsletterReactMessage === 'function') conns.push({ num, sock });
            }
        }
        if (!conns.length) return reply('❌ Koi session connected nahi hai.');

        const want = amount > 0 ? Math.min(amount, conns.length) : conns.length;
        const use = conns.slice(0, want);

        // ---------- DRY RUN (test): kuch mat bhejo, sirf plan batao ----------
        if (dryRun) {
            const plan = use.map((s, i) => `• ${s.num}: ${emojis[i % emojis.length]}`).join('\n');
            const capped = amount > conns.length ? `\n⚠️ Amount ${amount} → cap ${conns.length} (1 account = 1 react)` : '';
            return reply(`🧪 *TEST MODE* — kuch nahi bheja!\n\n📮 Post: ${targets.length} channel ki latest\n📡 Plan:\n${plan}${capped}\n\n_Bhejna ho to bina "test" likhe dobara chalao._`);
        }

        // ---------- react: har session 1 react, emoji rotate ----------
        let sent = 0;
        for (let i = 0; i < use.length; i++) {
            const { sock } = use[i];
            const emoji = emojis[i % emojis.length];
            for (const jid of targets) {
                const serverId = lastPosts[jid].serverId;
                try {
                    await sock.newsletterReactMessage(jid, serverId, emoji);
                    sent++;
                } catch (e1) {
                    try { // self-heal: follow karke retry (autoreact jaisa)
                        await sock.newsletterFollow(jid);
                        await sock.newsletterReactMessage(jid, serverId, emoji);
                        sent++;
                    } catch (e2) { /* is session se skip */ }
                }
            }
            if (i < use.length - 1) await sleep(700); // hammer nahi, araam se
        }

        const capped = amount > conns.length
            ? `\n⚠️ Amount ${amount} manga tha — lekin *1 account = 1 react* (WhatsApp ka rule), is liye max ${conns.length} ho saka.`
            : '';
        await reply(`✅ *${sent} react${sent === 1 ? '' : 's'}* bhej diye! ${emojis.join(' ')}\n📡 ${use.length} session${use.length === 1 ? '' : 's'} se${capped}`);
    } catch (e) {
        console.log('[CHREACT] error:', e.message);
        try { await reply('❌ Error: ' + e.message); } catch (_) {}
    }
});

console.log('[CHREACT] loaded: chreact');
