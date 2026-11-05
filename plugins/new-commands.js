// 🆕 New commands pack (Ahmad pick #3, 2026-11-05): .quiz .timer .quran
// .hadith .namaz .hangman .lovecalc .passgen .fancy .motivate
// All replies are English. .quran / .namaz use free no-key public APIs
// (AlQuran Cloud + Aladhan) with offline fallbacks, so the commands keep
// working even if an API is down.
const { cmd } = require('../ahmad-core');
const { randomFooter, toSmallCaps, toSansBoldItalic, toBoldSerif, toBoldItalicSerif } = require('../lib/menu-styles');
const axios = require('axios');

const FOOTER = () => `\n\n> ${randomFooter()}`;
const B = toSansBoldItalic;

// ---------------------------------------------------------------- .quiz
const QUIZ_BANK = [
    { q: 'What is the capital of Pakistan?', opts: ['Karachi', 'Lahore', 'Islamabad', 'Peshawar'], a: 2 },
    { q: 'Which is the largest planet in our solar system?', opts: ['Mars', 'Saturn', 'Jupiter', 'Neptune'], a: 2 },
    { q: 'How many players are there in a cricket team on the field?', opts: ['9', '10', '11', '12'], a: 2 },
    { q: 'Which Surah is called the heart of the Quran?', opts: ['Al-Fatiha', 'Ya-Sin', 'Al-Mulk', 'Ar-Rahman'], a: 1 },
    { q: 'What is the chemical symbol for gold?', opts: ['Ag', 'Fe', 'Au', 'Pb'], a: 2 },
    { q: 'Who wrote the national anthem of Pakistan?', opts: ['Allama Iqbal', 'Hafeez Jalandhari', 'Faiz Ahmed Faiz', 'Ahmed Faraz'], a: 1 },
    { q: 'How many days are there in a leap year?', opts: ['365', '366', '364', '360'], a: 1 },
    { q: 'Which is the longest river in the world?', opts: ['Amazon', 'Yangtze', 'Nile', 'Indus'], a: 2 },
    { q: 'What is 15 x 4?', opts: ['50', '55', '60', '65'], a: 2 },
    { q: 'Which organ pumps blood through the human body?', opts: ['Liver', 'Brain', 'Lungs', 'Heart'], a: 3 },
];
const quizState = new Map(); // chat jid -> { answer, question }
const QUIZ_LETTERS = ['A', 'B', 'C', 'D'];

cmd({
    pattern: 'quiz',
    desc: 'Play a quiz — answer with .quiz A/B/C/D',
    category: 'fun',
    react: '🧠',
}, async (conn, mek, m, { from, q, reply }) => {
    const arg = (q || '').trim().toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(arg)) {
        const active = quizState.get(from);
        if (!active) return reply(`❌ No active quiz here. Start one with *.${toSmallCaps('quiz')}*${FOOTER()}`);
        quizState.delete(from);
        if (QUIZ_LETTERS.indexOf(arg) === active.answer) {
            return reply(`✅ *Correct!* Well done 🎉${FOOTER()}`);
        }
        return reply(`❌ Wrong! The correct answer was *${QUIZ_LETTERS[active.answer]}* — ${active.opts[active.answer]}.${FOOTER()}`);
    }
    const item = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
    quizState.set(from, { answer: item.a, opts: item.opts });
    const opts = item.opts.map((o, i) => `${QUIZ_LETTERS[i]}. ${o}`).join('\n');
    return reply(`🧠 *${B('Quiz Time!')}*\n\n${item.q}\n\n${opts}\n\nReply with *.${toSmallCaps('quiz')} A* (or B / C / D)${FOOTER()}`);
});

// ---------------------------------------------------------------- .timer
cmd({
    pattern: 'timer',
    desc: 'Set a timer — .timer <minutes>',
    category: 'utility',
    react: '⏰',
}, async (conn, mek, m, { from, q, reply }) => {
    const mins = parseInt((q || '').trim(), 10);
    if (!mins || mins < 1 || mins > 180) {
        return reply(`❌ Usage: *.${toSmallCaps('timer')} 10*\nSet a timer from 1 to 180 minutes.${FOOTER()}`);
    }
    setTimeout(() => {
        conn.sendMessage(from, { text: `⏰ *Timer done!* ${mins} minute${mins > 1 ? 's' : ''} passed.${FOOTER()}` }).catch(() => {});
    }, mins * 60 * 1000);
    return reply(`⏰ Timer set for *${mins} minute${mins > 1 ? 's' : ''}*. I will remind you here.${FOOTER()}`);
});

// ---------------------------------------------------------------- .quran
const IKHLAS_FALLBACK = {
    arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ ﴿١﴾ اللَّهُ الصَّمَدُ ﴿٢﴾ لَمْ يَلِدْ وَلَمْ يُولَدْ ﴿٣﴾ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ ﴿٤﴾',
    english: 'Say, "He is Allah, [who is] One, Allah, the Eternal Refuge. He neither begets nor is born, nor is there to Him any equivalent."',
    ref: 'Surah Al-Ikhlas (112:1-4)',
};

cmd({
    pattern: 'quran',
    desc: 'Get a random Quran verse with English translation',
    category: 'islamic',
    react: '📖',
}, async (conn, mek, m, { reply }) => {
    try {
        const res = await axios.get('https://api.alquran.cloud/v1/ayah/random/editions/quran-uthmani,en.sahih', { timeout: 10000 });
        const editions = res?.data?.data;
        if (!Array.isArray(editions) || !editions.length) throw new Error('empty');
        const ar = editions.find(e => e?.edition?.identifier === 'quran-uthmani') || editions[0];
        const en = editions.find(e => e?.edition?.identifier === 'en.sahih') || editions[1];
        const ref = `Surah ${ar?.surah?.englishName || ''} (${ar?.surah?.number}:${ar?.numberInSurah})`;
        return reply(`📖 *${B(ref)}*\n\n${ar?.text || ''}\n\n_${en?.text || ''}_${FOOTER()}`);
    } catch (e) {
        return reply(`📖 *${B(IKHLAS_FALLBACK.ref)}*\n\n${IKHLAS_FALLBACK.arabic}\n\n_${IKHLAS_FALLBACK.english}_${FOOTER()}`);
    }
});

// ---------------------------------------------------------------- .hadith
const HADITH_BANK = [
    { text: 'Actions are but by intentions, and every man shall have only that which he intended.', src: 'Sahih al-Bukhari 1' },
    { text: 'None of you truly believes until he loves for his brother what he loves for himself.', src: 'Sahih al-Bukhari 13' },
    { text: 'Cleanliness is half of faith.', src: 'Sahih Muslim 223' },
    { text: 'The best among you are those who learn the Quran and teach it.', src: 'Sahih al-Bukhari 5027' },
    { text: 'Kindness is not found in anything except that it adds beauty to it.', src: 'Sahih Muslim 2594' },
    { text: 'Whoever believes in Allah and the Last Day, let him speak good or remain silent.', src: 'Sahih al-Bukhari 6018' },
    { text: 'The strong is not the one who overcomes people by wrestling, but the strong is the one who controls himself in anger.', src: 'Sahih al-Bukhari 6114' },
    { text: 'Allah is Gentle and loves gentleness in all things.', src: 'Sahih al-Bukhari 6927' },
];

cmd({
    pattern: 'hadith',
    desc: 'Get a random Hadith with its source',
    category: 'islamic',
    react: '📜',
}, async (conn, mek, m, { reply }) => {
    const h = HADITH_BANK[Math.floor(Math.random() * HADITH_BANK.length)];
    return reply(`📜 *${B('Hadith')}*\n\n_"${h.text}"_\n\n— ${h.src}${FOOTER()}`);
});

// ---------------------------------------------------------------- .namaz
// City coordinates for instant lookup (no network); any other city is
// geocoded free via OpenStreetMap Nominatim. Times via Aladhan (method 1,
// University of Islamic Sciences, Karachi — the standard for Pakistan).
const CITY_COORDS = {
    lahore: [31.5204, 74.3587], karachi: [24.8607, 67.0011], islamabad: [33.6844, 73.0479],
    faisalabad: [31.4181, 73.0791], rawalpindi: [33.6007, 73.0679], multan: [30.1575, 71.5249],
    peshawar: [34.0151, 71.5249], quetta: [30.1798, 66.9750],
};

cmd({
    pattern: 'namaz',
    desc: 'Prayer times for a city — .namaz <city>',
    category: 'islamic',
    react: '🕌',
}, async (conn, mek, m, { q, reply }) => {
    const city = (q || '').trim() || 'Lahore';
    try {
        let latLon = CITY_COORDS[city.toLowerCase()];
        if (!latLon) {
            const geo = await axios.get('https://nominatim.openstreetmap.org/search', {
                params: { format: 'json', q: city, limit: 1 },
                headers: { 'User-Agent': 'AhmadMD-Bot/1.0' },
                timeout: 10000,
            });
            const hit = geo?.data?.[0];
            if (!hit) throw new Error('city not found');
            latLon = [parseFloat(hit.lat), parseFloat(hit.lon)];
        }
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const res = await axios.get(`https://api.aladhan.com/v1/timings/${dd}-${mm}-${today.getFullYear()}`, {
            params: { latitude: latLon[0], longitude: latLon[1], method: 1 },
            timeout: 10000,
        });
        const t = res?.data?.data?.timings;
        const d = res?.data?.data?.date;
        if (!t) throw new Error('no timings');
        const clean = s => String(s).split(' ')[0];
        return reply(`🕌 *${B('Prayer Times')} — ${city}*\n\n` +
            `🌅 *Fajr:* ${clean(t.Fajr)}\n` +
            `☀️ *Sunrise:* ${clean(t.Sunrise)}\n` +
            `🕛 *Dhuhr:* ${clean(t.Dhuhr)}\n` +
            `🌤️ *Asr:* ${clean(t.Asr)}\n` +
            `🌇 *Maghrib:* ${clean(t.Maghrib)}\n` +
            `🌙 *Isha:* ${clean(t.Isha)}\n` +
            (d?.hijri ? `\n📅 Hijri: ${d.hijri.day} ${d.hijri.month.en} ${d.hijri.year} AH` : '') +
            FOOTER());
    } catch (e) {
        return reply(`❌ Could not find prayer times for "${city}". Try *.${toSmallCaps('namaz')} Lahore*${FOOTER()}`);
    }
});

// ---------------------------------------------------------------- .hangman
const HANGMAN_WORDS = ['pakistan', 'cricket', 'islamabad', 'karachi', 'lahore', 'mountain', 'river', 'school', 'friend', 'family', 'garden', 'window', 'bridge', 'market', 'doctor', 'teacher', 'banana', 'orange', 'guitar', 'rocket'];
const hangmanState = new Map(); // chat jid -> { word, guessed:Set, wrong }

function hangmanView(g) {
    const shown = [...g.word].map(ch => (g.guessed.has(ch) ? ch : '_')).join(' ');
    return `🎮 *${B('Hangman')}*\n\n${shown}\n\nWrong: ${[...g.wrong].join(', ') || 'none'} (${g.wrong.size}/6)\n\nGuess a letter: *.${toSmallCaps('hangman')} a*`;
}

cmd({
    pattern: 'hangman',
    desc: 'Play hangman — .hangman <letter>',
    category: 'fun',
    react: '🎮',
}, async (conn, mek, m, { from, q, reply }) => {
    const arg = (q || '').trim().toLowerCase();
    if (!arg) {
        let g = hangmanState.get(from);
        if (!g) {
            const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
            g = { word, guessed: new Set(), wrong: new Set() };
            hangmanState.set(from, g);
            return reply(hangmanView(g) + FOOTER());
        }
        return reply(hangmanView(g) + FOOTER());
    }
    const g = hangmanState.get(from);
    if (!g) return reply(`❌ No game running. Start one with *.${toSmallCaps('hangman')}*${FOOTER()}`);
    if (!/^[a-z]$/.test(arg)) return reply(`❌ Guess one letter, e.g. *.${toSmallCaps('hangman')} a*${FOOTER()}`);
    if (g.guessed.has(arg) || g.wrong.has(arg)) return reply(`⚠️ You already tried *${arg.toUpperCase()}*.\n\n${hangmanView(g)}${FOOTER()}`);
    if (g.word.includes(arg)) {
        g.guessed.add(arg);
        if ([...g.word].every(ch => g.guessed.has(ch))) {
            hangmanState.delete(from);
            return reply(`🎉 *You won!* The word was *${g.word.toUpperCase()}*.${FOOTER()}`);
        }
        return reply(`✅ Good guess!\n\n${hangmanView(g)}${FOOTER()}`);
    }
    g.wrong.add(arg);
    if (g.wrong.size >= 6) {
        hangmanState.delete(from);
        return reply(`💀 *Game over!* The word was *${g.word.toUpperCase()}*. Start a new game with *.${toSmallCaps('hangman')}*${FOOTER()}`);
    }
    return reply(`❌ No *${arg.toUpperCase()}* in the word.\n\n${hangmanView(g)}${FOOTER()}`);
});

// ---------------------------------------------------------------- .lovecalc
function nameHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}

cmd({
    pattern: 'lovecalc',
    alias: ['lovecalculator'],
    desc: 'Love percentage between two names',
    category: 'fun',
    react: '❤️',
}, async (conn, mek, m, { q, reply }) => {
    const parts = (q || '').split(/[,+&]| and /i).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
        return reply(`❌ Usage: *.${toSmallCaps('lovecalc')} Ali, Sara*${FOOTER()}`);
    }
    const [n1, n2] = parts;
    const pct = (nameHash(n1.toLowerCase()) + nameHash(n2.toLowerCase())) % 101;
    const verdict = pct >= 90 ? 'A perfect match! 💖' : pct >= 70 ? 'Strong connection! 💕' : pct >= 50 ? 'Good potential! 💗' : pct >= 30 ? 'It could work — with effort! 🙂' : 'Better as friends! 😅';
    return reply(`❤️ *${B('Love Calculator')}*\n\n${n1} + ${n2} = *${pct}%*\n\n${verdict}${FOOTER()}`);
});

// ---------------------------------------------------------------- .passgen
cmd({
    pattern: 'passgen',
    alias: ['genpass', 'passwordgen'],
    desc: 'Generate a random password — .passgen <length>',
    category: 'utility',
    react: '🔐',
}, async (conn, mek, m, { q, reply }) => {
    const crypto = require('crypto');
    let len = parseInt((q || '').trim(), 10);
    if (!len || len < 4) len = 12;
    if (len > 32) len = 32;
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*?';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
    return reply(`🔐 *${B('Your password')} (${len} chars):*\n\n\`${out}\`\n\nKeep it safe — do not share it.${FOOTER()}`);
});

// ---------------------------------------------------------------- .fancy
cmd({
    pattern: 'fancy',
    desc: 'Fancy fonts for your text — .fancy <text>',
    category: 'utility',
    react: '✨',
}, async (conn, mek, m, { q, reply }) => {
    const text = (q || '').trim();
    if (!text) return reply(`❌ Usage: *.${toSmallCaps('fancy')} hello*${FOOTER()}`);
    if (text.length > 40) return reply(`❌ Keep it under 40 characters.${FOOTER()}`);
    return reply(`✨ *${B('Fancy Text')}*\n\n` +
        `Small caps: ${toSmallCaps(text)}\n` +
        `Bold: ${toSansBoldItalic(text)}\n` +
        `Serif: ${toBoldSerif(text)}\n` +
        `Italic serif: ${toBoldItalicSerif(text)}${FOOTER()}`);
});

// ---------------------------------------------------------------- .motivate
const MOTIVATION_BANK = [
    'The best time to start was yesterday. The next best time is now.',
    'Small steps every day lead to big results.',
    'Do not wait for the perfect moment — take the moment and make it perfect.',
    'Hard work beats talent when talent does not work hard.',
    'Your only limit is the one you set for yourself.',
    'Success is not final, failure is not fatal — it is the courage to continue that counts.',
    'Dream big, start small, act now.',
    'Discipline is choosing what you want most over what you want now.',
    'Every expert was once a beginner.',
    'Do not count the days — make the days count.',
    'Believe you can, and you are halfway there.',
    'A little progress each day adds up to big results.',
];

cmd({
    pattern: 'motivate',
    alias: ['motivation'],
    desc: 'Get a motivational quote',
    category: 'fun',
    react: '💪',
}, async (conn, mek, m, { reply }) => {
    const line = MOTIVATION_BANK[Math.floor(Math.random() * MOTIVATION_BANK.length)];
    return reply(`💪 *${B('Motivation')}*\n\n_"${line}"_${FOOTER()}`);
});
