// ============================================================================
// plugins/appeal.js — WhatsApp ban appeal generator.
// A bot can NEVER lift a WhatsApp ban by itself — only WhatsApp can. What
// this does is draft a strong, formal appeal email to WhatsApp Support
// (support@whatsapp.com) and give the user a tap-to-send mailto link, so
// the appeal goes out from their OWN email app. Temporary bans have a
// much better chance than permanent ones, and the reply says so honestly.
//
// .appeal <number> [temporary|permanent]
//   Example: .appeal 923001234567
//   Example: .appeal 923001234567 permanent
// Alias: .unbanwa
//
// NOTE: .unban already exists in plugins/owner.js (owner-only, removes a
// number from the BOT's own ban list) — so this uses .appeal, not .unban.
// ============================================================================
const { cmd } = require('../ahmad-core');
const { randomFooter } = require('../lib/menu-styles');

const FOOTER = () => `\n\n> ${randomFooter()}`;
const SUPPORT_EMAIL = 'support@whatsapp.com';

function normalizeNumber(raw) {
    let digits = String(raw || '').replace(/[^0-9]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    return digits;
}

function buildAppeal(number, banType) {
    const typeLine = banType === 'permanent'
        ? 'My account was permanently banned.'
        : banType === 'temporary'
            ? 'My account was temporarily banned.'
            : 'My account was recently banned.';
    const subject = `Request for Review - WhatsApp Account Ban on +${number}`;
    const body = `Dear WhatsApp Support Team,

I am writing to request a review of the ban on my WhatsApp account registered with the phone number +${number}.

${typeLine} I believe this ban may have been applied in error, as I have always tried to use WhatsApp in line with the Terms of Service.

I kindly request you to review my account and restore access if the ban was a mistake. I am ready to follow all WhatsApp rules going forward.

Phone number: +${number}

Thank you for your time and support.

Best regards`;
    return { subject, body };
}

cmd({
    pattern: 'appeal',
    alias: ['unbanwa'],
    desc: 'Generate a WhatsApp ban appeal email (temporary or permanent ban)',
    category: 'appeal',
    react: '✉️'
}, async (conn, mek, m, { q, reply }) => {
    const parts = String(q || '').trim().split(/\s+/).filter(Boolean);
    const number = normalizeNumber(parts[0]);
    if (!number || number.length < 7 || number.length > 15) {
        return reply('❌ Usage: .appeal <number> [temporary|permanent]\nExample: .appeal 923001234567\nExample: .appeal 923001234567 permanent' + FOOTER());
    }
    const typeArg = String(parts[1] || '').toLowerCase();
    const banType = ['temporary', 'temp'].includes(typeArg) ? 'temporary'
        : ['permanent', 'perm'].includes(typeArg) ? 'permanent' : null;
    const { subject, body } = buildAppeal(number, banType);
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const odds = banType === 'permanent'
        ? 'Note: permanent bans are harder to reverse — WhatsApp usually restores the account only if the ban was a mistake.'
        : banType === 'temporary'
            ? 'Note: temporary bans often end on their own — this appeal can speed up the review.'
            : 'Note: temporary bans have a much better chance than permanent ones.';
    reply(`✉️ *WhatsApp Ban Appeal — +${number}*\n\n*To:* ${SUPPORT_EMAIL}\n*Subject:* ${subject}\n\n${body}\n\n👉 Tap to send this appeal from your email app:\n${mailto}\n\n_Send it from the email linked to this WhatsApp account. WhatsApp usually replies within 24-72 hours._\n${odds}` + FOOTER());
});
