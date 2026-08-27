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
const compactPingStyles = [
    (name, ms) => `> 𓆩◆𓆪 *${name}* 𓆩◆𓆪\n> ⌁  𝙋𝙊𝙉𝙂   •   ${ms}ms   •   𝙊𝙉𝙇𝙄𝙉𝙀`,
    (name, ms) => `> ♛ *${name}* ♛\n> ◉  𝙋𝙊𝙉𝙂   •   ${ms}ms   •   𝙊𝙉𝙇𝙄𝙉𝙀`,
    (name, ms) => `> ◈ *${name}* ◈\n> ◉  𝙋𝙊𝙉𝙂   •   ${ms}ms   •   𝙍𝙀𝘼𝘿𝙔`,
];


cmd({
  pattern: "ping",
  desc: "⚡ Check bot speed",
  category: "main",
  filename: __filename
}, async (conn, mek, m, { from, arrivalTs }) => {
  try {
    const processMs = Math.max(1, Date.now() - (arrivalTs || Date.now()));
    const uptimeSec = process.uptime();
    const uh = Math.floor(uptimeSec / 3600);
    const um = Math.floor((uptimeSec % 3600) / 60);
    const us = Math.floor(uptimeSec % 60);
    const uptimeStr = `${uh}h ${um}m ${us}s`;
    const botName = '𝘼𝙃𝙈𝘼𝘿 𝙈𝙄𝙉𝙄';

    const style = compactPingStyles[Math.floor(Math.random() * compactPingStyles.length)];
    const text = style(botName, processMs);

    // Exactly one user-visible operation keeps group ping responsive.
    await conn.sendMessage(from, { text, contextInfo: channelContext });
  } catch (e) {
    console.error(e);
    await conn.sendMessage(from, { text: '❌ Ping failed' }, { quoted: mek }).catch(() => {});
  }
});
