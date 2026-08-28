const { cmd } = require('../ahmad-core');
const config = require('../config');

// One user-visible send with the requested WhatsApp channel/forward envelope.
// No media, database lookup, network probe, presence update, or reaction is
// performed on the ping path.
const channelContext = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: config.CHANNEL_JID || '120363427856127926@newsletter',
        newsletterName: 'AHMAD MINI',
        serverMessageId: 2,
    },
};

const pingHeaders = [
    '╭━━〔 ⚡ 𝘼𝙃𝙈𝘼𝘿 𝙈𝙄𝙉𝙄 〕━━╮',
    '╭━━〔 ♛ 𝘼𝙃𝙈𝘼𝘿 𝙈𝙄𝙉𝙄 〕━━╮',
    '╭━━〔 ◈ 𝘼𝙃𝙈𝘼𝘿 𝙈𝙄𝙉𝙄 〕━━╮',
];

cmd({
  pattern: 'ping',
  desc: '⚡ Check bot speed',
  category: 'main',
  filename: __filename,
}, async (conn, mek, m, { from, arrivalTs }) => {
  try {
    const processMs = Math.max(1, Date.now() - (arrivalTs || Date.now()));
    const uptimeSec = Math.floor(process.uptime());
    const uh = Math.floor(uptimeSec / 3600);
    const um = Math.floor((uptimeSec % 3600) / 60);
    const us = uptimeSec % 60;
    const header = pingHeaders[Math.floor(Math.random() * pingHeaders.length)];
    const body = `${header}\n┃ 🟢 𝙊𝙉𝙇𝙄𝙉𝙀 & 𝙍𝙀𝘼𝘿𝙔\n┃ ⚡ 𝙎𝙋𝙀𝙀𝘿 : ${processMs}ms\n┃ ⏱️ 𝙐𝙋𝙏𝙄𝙈𝙀 : ${uh}h ${um}m ${us}s\n┃ 🚀 𝙋𝙄𝙉𝙂 : 𝙎𝙐𝘾𝘾𝙀𝙎𝙎 ✓\n╰━━━━━━━━━━━━━━╯`;
    const text = body;

    // Exactly one user-visible operation keeps group ping responsive.
    await conn.sendMessage(from, { text, contextInfo: channelContext });
  } catch (e) {
    console.error(e);
    await conn.sendMessage(from, { text: '❌ Ping failed' }, { quoted: mek }).catch(() => {});
  }
});

module.exports = { pingHeaders };
