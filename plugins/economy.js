const { cmd } = require('../lib/command');

// Simple in-memory economy (use DB in production)
const balances = {};
const lastDaily = {};

function getBal(user) {
    return balances[user] || 0;
}
function setBal(user, amt) {
    balances[user] = amt;
}
function addBal(user, amt) {
    balances[user] = getBal(user) + amt;
}

cmd({
    pattern: 'daily',
    desc: 'Claim daily coins',
    category: 'economy',
    react: '💰',
}, async (conn, mek, m, { reply, sender }) => {
    const now = Date.now();
    const last = lastDaily[sender] || 0;
    const cooldown = 24 * 60 * 60 * 1000; // 24 hours
    
    if (now - last < cooldown) {
        const remaining = Math.ceil((cooldown - (now - last)) / (60 * 60 * 1000));
        return reply(`⏳ Already claimed! Come back in ${remaining}h`);
    }
    
    const reward = 100 + Math.floor(Math.random() * 400); // 100-500
    addBal(sender, reward);
    lastDaily[sender] = now;
    reply(`💰 *DAILY REWARD*\n\n+${reward} coins!\nBalance: ${getBal(sender)} coins`);
});

cmd({
    pattern: 'balance',
    alias: ['bal', 'wallet'],
    desc: 'Check your balance',
    category: 'economy',
    react: '💳',
}, async (conn, mek, m, { reply, sender }) => {
    reply(`💳 *WALLET*\n\nBalance: ${getBal(sender)} coins 🪙`);
});

cmd({
    pattern: 'gamble',
    alias: ['bet'],
    desc: 'Gamble coins',
    category: 'economy',
    react: '🎲',
}, async (conn, mek, m, { reply, sender, args }) => {
    const amount = parseInt(args[0]);
    if (!amount || amount <= 0) return reply('❌ Usage: .gamble <amount>');
    if (getBal(sender) < amount) return reply(`❌ Not enough coins! Balance: ${getBal(sender)}`);
    
    const win = Math.random() < 0.45; // 45% win chance
    if (win) {
        const winnings = Math.floor(amount * 1.5);
        addBal(sender, winnings);
        reply(`🎉 *YOU WON!*\n\n+${winnings} coins!\nBalance: ${getBal(sender)} coins`);
    } else {
        addBal(sender, -amount);
        reply(`💔 *YOU LOST!*\n\n-${amount} coins\nBalance: ${getBal(sender)} coins`);
    }
});

cmd({
    pattern: 'transfer',
    alias: ['pay', 'give'],
    desc: 'Transfer coins to someone',
    category: 'economy',
    react: '💸',
}, async (conn, mek, m, { reply, sender, args, mentionedJid }) => {
    const amount = parseInt(args[0]);
    const target = mentionedJid?.[0];
    if (!amount || amount <= 0 || !target) return reply('❌ Usage: .transfer <amount> @user');
    if (getBal(sender) < amount) return reply(`❌ Not enough coins!`);
    
    addBal(sender, -amount);
    addBal(target, amount);
    reply(`💸 Transferred ${amount} coins!`);
});

cmd({
    pattern: 'leaderboard',
    alias: ['lb', 'top'],
    desc: 'Richest users',
    category: 'economy',
    react: '🏆',
}, async (conn, mek, m, { reply }) => {
    const sorted = Object.entries(balances).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!sorted.length) return reply('No one has coins yet! Use .daily first!');
    
    let text = '🏆 *LEADERBOARD*\n\n';
    sorted.forEach(([user, bal], i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
        text += `${medal} @${user.split('@')[0]} — ${bal} coins\n`;
    });
    reply(text);
});

console.log('[ECONOMY] loaded: daily, balance, gamble, transfer, leaderboard');
