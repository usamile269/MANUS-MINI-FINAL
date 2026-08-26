const { cmd } = require('../ahmad-core');
const { toSansBoldItalic, randomFooter, renderCuteBox } = require('../lib/menu-styles');
const config = require('../config');
const os = require('os');

const PING_START_REACTIONS = ['🐣', '🐰', '🐼', '🧸', '🌷', '🪽', '🌙', '🍓'];
const PING_SUCCESS_REACTIONS = ['🦋', '💗', '🤍', '✨', '🌸', '💞'];
const randomPingReaction = list => list[Math.floor(Math.random() * list.length)];

// `.ping` intentionally uses the bot's attractive channel-post style. The
// probe remains non-blocking, so this visual metadata does not add latency.
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
}, async (conn, mek, m, { from, reply, arrivalTs }) => {

  try {
    conn.sendMessage(from, {
      react: { text: randomPingReaction(PING_START_REACTIONS), key: m.key }
    }).catch(() => {});

    const processMs = Math.max(1, Date.now() - (arrivalTs || Date.now()));

    // Keep the probe non-blocking. It is a health signal, not part of the
    // user-visible reply latency; waiting for it made group ping feel slow.
    conn.sendPresenceUpdate('available', from).catch(() => {});
    const probeLabel = 'BACKGROUND';

    const uptimeSec = process.uptime();
    const uh = Math.floor(uptimeSec / 3600);
    const um = Math.floor((uptimeSec % 3600) / 60);
    const us = Math.floor(uptimeSec % 60);
    const uptimeStr = `${uh}h ${um}m ${us}s`;

    const botName = config.BOT_NAME || 'AHMAD MINI';

    // 🎀 (Bunty: "yeh 4 cute box styles lagao, random ain") — random pick
    // each time from the 4 cute box frames, via shared renderCuteBox helper
    // (also used by .uptime) so both share the same style pool.
    const text = renderCuteBox(botName, [
        { emoji: '🩷', label: 'SYSTEM', value: 'ONLINE' },
        { emoji: '🦋', label: 'PONG',   value: 'PONG' },
        { emoji: '🌷', label: 'SERVER', value: `${processMs}ms` },
        { emoji: '📡', label: 'WA PROBE', value: probeLabel },
        { emoji: '⏱️', label: 'UPTIME', value: uptimeStr },
    ]);

    const resultReaction = randomPingReaction(PING_SUCCESS_REACTIONS);

    await conn.sendMessage(from, {
      text,
      contextInfo: channelContext
    }, { quoted: mek });

    await conn.sendMessage(from, {
      react: { text: resultReaction, key: m.key }
    });

  } catch (e) {
    console.error(e);
    await conn.sendMessage(from, {
      react: { text: "❌", key: m.key }
    });
    reply("❌ *Failed!*");
  }
});
