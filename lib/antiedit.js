const { getAntieditStatus, getAntieditSendTo } = require('../data/Antiedit.js');
const { getContentType } = require('@whiskeysockets/baileys');
const config = require('../config');

function extractText(message) {
    if (!message) return null;
    // 🚨 BUG FIX (Ahmad: "antiedit ata but edit msg ni ata, updated ata") —
    // WhatsApp's editedMessage payload isn't always a plain content object;
    // it sometimes arrives double-wrapped as { message: {...actual content} }.
    // extractText used to only look at the top level, so it silently fell
    // through to "(no text found)" for any edit shaped that way. Unwrap one
    // level first if needed.
    if (!getContentType(message) && message.message) message = message.message;
    const type = getContentType(message);
    if (!type) return null;
    if (type === 'conversation') return message.conversation;
    if (type === 'extendedTextMessage') return message.extendedTextMessage.text;
    if (type === 'imageMessage' && message.imageMessage.caption) return `[image] ${message.imageMessage.caption}`;
    if (type === 'videoMessage' && message.videoMessage.caption) return `[video] ${message.videoMessage.caption}`;
    if (type === 'documentMessage' && message.documentMessage.caption) return `[document] ${message.documentMessage.caption}`;
    if (type === 'buttonsMessage' && message.buttonsMessage.contentText) return message.buttonsMessage.contentText;
    if (type === 'templateMessage') {
        const content = message.templateMessage.hydratedTemplate?.hydratedContentText;
        if (content) return content;
    }
    if (type === 'listMessage' && message.listMessage.description) return message.listMessage.description;
    return null;
}

async function reportEdit(conn, store, chatId, messageId, participant, editedMessage) {
    const botNumber = conn.user.id.split(':')[0].split('@')[0];
    const isEnabled = await getAntieditStatus(botNumber, chatId);
    if (!isEnabled) return;

    const oldMsg = store && store.messages[chatId]
        ? await store.loadMessage(chatId, messageId)
        : null;
    const oldText = oldMsg ? extractText(oldMsg.message) : null;
    const newText = extractText(editedMessage) || '(no text found)';

    const sendTo = await getAntieditSendTo(botNumber, chatId);
    const isPrivate = sendTo === 'private';
    const destination = isPrivate
        ? conn.user.id.split(':')[0].split('@')[0] + "@s.whatsapp.net"
        : chatId;

    const { toSansBold } = require('../lib/menu-styles');
    const alertText = `╭──────────────────────╮
│  ✏️ ${toSansBold('MESSAGE EDITED')}
╰──────────────────────╯
👤 ${toSansBold('User')}: @${participant.split('@')[0]}
💬 ${toSansBold('Chat')}: ${isPrivate ? chatId : 'here'}

📤 ${toSansBold('Before')}:
${oldText || '(not cached / unknown)'}

📥 ${toSansBold('After')}:
${newText}

📅 ${toSansBold(new Date().toLocaleString())}
${config.BOT_FOOTER || ''}`;
    await conn.sendMessage(destination, { text: alertText, mentions: [participant] });

    // Keep the cache in sync so a second edit of the same message still
    // shows the correct "before" text next time.
    if (store && store.messages[chatId]) {
        const cached = store.messages[chatId].find(m => m.key && m.key.id === messageId);
        if (cached) cached.message = editedMessage;
    }
}

// 🚨 BUG FIX: antiedit only ever listened via messages.upsert (a NEW message
// carrying a protocolMessage of type 14). antidelete has TWO detection paths
// (messages.update AND messages.upsert) because different WhatsApp/Baileys
// versions report the SAME event differently — antiedit was missing the
// messages.update path entirely, so edits delivered that way were silently
// never caught, regardless of the on/off toggle.
const handleAntiedit = async (conn, updates, store) => {
    try {
        for (const update of updates) {
            const proto = update.update?.message?.protocolMessage;
            if (!proto || proto.type !== 14 /* MESSAGE_EDIT */) continue;

            const chatId = update.key.remoteJid;
            const messageId = proto.key?.id || update.key.id;
            const participant = update.key.participant || proto.key?.participant || chatId;
            if (!messageId) continue;

            await reportEdit(conn, store, chatId, messageId, participant, proto.editedMessage);
        }
    } catch (e) { console.error("Antiedit Error (update path):", e); }
};

// WhatsApp reports a message edit as a NEW message via messages.upsert containing
// a protocolMessage of type 14 (MESSAGE_EDIT). protocolMessage.key points at the
// ORIGINAL message id, and protocolMessage.editedMessage holds the new content.
const handleAntieditUpsert = async (conn, messages, store) => {
    try {
        for (const mek of messages) {
            const proto = mek.message?.protocolMessage;
            if (!proto || proto.type !== 14 /* MESSAGE_EDIT */) continue;

            const chatId = mek.key.remoteJid;
            const messageId = proto.key?.id;
            const participant = mek.key.participant || proto.key?.participant || chatId;
            if (!messageId) continue;

            await reportEdit(conn, store, chatId, messageId, participant, proto.editedMessage);
        }
    } catch (e) { console.error("Antiedit Error (upsert path):", e); }
};

module.exports = { handleAntiedit, handleAntieditUpsert };
