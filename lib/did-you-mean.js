// "Did you mean?" — when someone types a mistyped .command (e.g. .mmenu),
// suggest the closest real command instead of staying silent.
// Pure JS, no dependencies. Used by main.js for unknown commands only.

// Damerau-Levenshtein (optimal string alignment): plain edit distance, but a
// swapped pair of letters (meun -> menu) costs 1, not 2 — transpositions are
// the most common typo, so they must count as a single mistake.
function damerauLevenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev2 = new Array(n + 1).fill(0);
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        const cur = new Array(n + 1);
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
            }
        }
        prev2 = prev;
        prev = cur;
    }
    return prev[n];
}

// One suggestion per sender per 10s — a typo burst in a group must not
// turn into a burst of bot replies.
const lastSuggestedAt = new Map();

// typed: the unknown command word (already lowercased by the dispatcher).
// commands: the registered commands array (each entry has .pattern + .alias).
// Candidates are patterns AND aliases — .play is an alias of ytmp3, so a
// typo like .paly must suggest *.ᴘʟᴀʏ*, not *.ʏᴛᴍᴘ3*. The suggested name
// is the exact string the user should type.
// sender: sender jid, for the throttle. Returns the closest name or null.
function suggestCommand(typed, commands, sender) {
    const word = (typed || '').toLowerCase().trim();
    if (word.length < 3) return null; // too short — too many false positives
    const maxDist = word.length <= 4 ? 1 : 2;
    let best = null;
    let bestDist = Infinity;
    let bestLenDiff = Infinity;
    for (const c of commands || []) {
        const names = [c && c.pattern, ...(c && Array.isArray(c.alias) ? c.alias : [])];
        for (const raw of names) {
            const p = (raw ? String(raw) : '').toLowerCase();
            if (!p || p === word) continue;
            const d = damerauLevenshtein(word, p);
            // Tie-break: the intended command is usually the same length as
            // the typo (a swapped/substituted letter), not a shorter one —
            // so .paly means .play, not .pay.
            const lenDiff = Math.abs(p.length - word.length);
            if (d < bestDist || (d === bestDist && lenDiff < bestLenDiff)) {
                bestDist = d;
                bestLenDiff = lenDiff;
                best = p;
            }
        }
    }
    if (!best || bestDist > maxDist) return null;
    const now = Date.now();
    const last = lastSuggestedAt.get(sender) || 0;
    if (now - last < 10000) return null;
    lastSuggestedAt.set(sender, now);
    return best;
}

module.exports = { suggestCommand, damerauLevenshtein };
