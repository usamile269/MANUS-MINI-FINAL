// ============================================================================
// plugins/scam-vote.js — Vote on scam-check polls
// ----------------------------------------------------------------------------
// .vote <pollId> <yes|no>  -> privately vote whether a number is a scammer.
// Votes are stored in the 'scampolls' collection. One vote per user per poll.
// Only the admin sees results (via admin panel). Fully private.
// ============================================================================

const { cmd } = require('../ahmad-core');
const { model } = require('../lib/mongo');

const ScamPollsDB = model('scampolls');

cmd({
    pattern: 'vote',
    desc: 'Vote on a scam-check poll (private)',
    category: 'general',
    react: '🗳️',
    use: '.vote poll_abc123 yes'
}, async (conn, mek, m, { sender, pushname, reply, args }) => {
    const [pollId, choiceRaw] = args;
    if (!pollId || !choiceRaw) {
        return reply('🗳️ *Vote*\n\nUse: .vote <pollId> <yes|no>\nExample: .vote poll_abc123 yes\n\nYou get the poll ID when admin asks for community verification.');
    }
    const choice = choiceRaw.toLowerCase();
    if (!['yes', 'no', 'y', 'n'].includes(choice)) {
        return reply('❌ Vote must be *yes* or *no*.\nExample: .vote ' + pollId + ' yes');
    }
    const voteYes = ['yes', 'y'].includes(choice);
    const voter = sender.split('@')[0];

    try {
        const poll = await ScamPollsDB.findOne({ pollId });
        if (!poll) return reply('❌ Poll not found. Check the poll ID.');
        if (poll.status !== 'open') return reply('🔒 This poll is closed. Thanks anyway!');

        const votes = poll.votes || {};
        if (votes[voter]) {
            return reply(`⚠️ You already voted *${votes[voter]}* on this poll.`);
        }
        votes[voter] = voteYes ? 'yes' : 'no';
        await ScamPollsDB.findOneAndUpdate({ pollId }, {
            votes,
            yes: (poll.yes || 0) + (voteYes ? 1 : 0),
            no: (poll.no || 0) + (voteYes ? 0 : 1),
        });
        reply(`✅ Vote recorded: *${voteYes ? 'YES — scammer' : 'NO — safe'}*\n\nYour vote is private. Only the admin sees totals. Shukriya! 🙏`);
    } catch (e) {
        console.log('[VOTE] failed:', e.message);
        reply('❌ Vote failed, try again.');
    }
});
