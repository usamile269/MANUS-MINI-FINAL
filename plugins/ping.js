const { cmd } = require('../ahmad-core');
const config = require('../config');

// `.ping` is intentionally one lightweight send: no media, database lookup,
// network probe, presence update, or awaited cosmetic reaction.
const boldDigits = value => String(value).replace(/[0-9]/g, digit => '𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵'[digit]);
const compactPingStyles = [
    (name, ms) => `> 𓆩◆𓆪 *${name}*\n> ⌁ 𝙋𝙊𝙉𝙂  •  ${boldDigits(ms)}𝗺𝘀  •  𝙊𝙉𝙇𝙄𝙉𝙀`,
    (name, ms) => `> ♛ *${name}*\n> ◉ 𝙋𝙊𝙉𝙂  •  ${boldDigits(ms)}𝗺𝘀  •  𝙊𝙉𝙇𝙄𝙉𝙀`,
    (name, ms) => `> ◈ *${name}*\n> ◉ 𝙋𝙊𝙉𝙂  •  ${boldDigits(ms)}𝗺𝘀  •  𝙍𝙀𝘼𝘿𝙔`,
];

const channelContext = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: config.CHANNEL_JID || '120363427856127926@newsletter',
        newsletterName: config.BOT_NAME || 'AHMAD MINI',
        serverMessageId: 2,
    },
};

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
    const botName = config.BOT_NAME || 'AHMAD MINI';

    const style = compactPingStyles[Math.floor(Math.random() * compactPingStyles.length)];
    const text = style(botName, processMs);

    // Exactly one user-visible operation keeps group ping responsive.
    await conn.sendMessage(from, { text, contextInfo: channelContext }, { quoted: mek });
  } catch (e) {
    console.error(e);
    await conn.sendMessage(from, { text: '❌ Ping failed' }, { quoted: mek }).catch(() => {});
  }
});
