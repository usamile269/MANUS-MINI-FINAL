const { cmd } = require('../ahmad-core');
const { toSansBoldItalic, randomFooter, renderCuteBox } = require('../lib/menu-styles');
const config = require('../config');
const os = require('os');

const PING_START_REACTIONS = ['🐣', '🐰', '🐼', '🧸', '🌷', '🪽', '🌙', '🍓'];
const PING_SUCCESS_REACTIONS = ['🦋', '💗', '🤍', '✨', '🌸', '💞'];
const randomPingReaction = list => list[Math.floor(Math.random() * list.length)];

// 🎨 REDESIGN (Bunty: "channel forward style mein hai hi nahi 🫠"): the
// previous version only attached the channel-forward contextInfo to the
// throwaway "calculating..." placeholder message — the SECOND call (the
// one that actually `edit`s the message into its final, visible form) had
// no contextInfo at all, so the forward badge silently disappeared the
// moment the edit landed. Rewritten to never edit at all: the network-send
// timing is measured with a cheap, invisible presence-update probe first,
// then ONE single real message is sent with the full result AND the full
// channel-forward context attached from the very start — nothing to lose
// on a second call.
const channelContext = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: config.CHANNEL_JID || "120363427856127926@newsletter",
        newsletterName: config.BOT_NAME,
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

    // Cheap, invisible network round-trip probe (a presence update touches
    // WhatsApp's servers just like a real send does, but produces no
    // visible message) — measured BEFORE the real reply, so the real
    // reply can be sent once, fully formed, contextInfo included from the
    // start.
    const sendStart = Date.now();
    await Promise.race([
      conn.sendPresenceUpdate('available', from).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 150))
    ]);
    const networkMs = Math.max(1, Date.now() - sendStart);

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
        { emoji: '🌷', label: 'SPEED',  value: `${networkMs}ms` },
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
