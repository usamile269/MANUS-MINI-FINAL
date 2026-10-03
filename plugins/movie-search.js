'use strict';

/**
 * Movie discovery commands only.
 *
 * Required environment variable:
 *   TMDB_API_KEY=your_tmdb_v3_api_key
 *
 * This plugin never creates or returns pirated download links. It provides
 * movie metadata, legal discovery links, trailers, and Internet Archive links
 * for a small curated public-domain catalogue.
 */
const axios = require('axios');
const ytSearch = require('yt-search');
const { cmd } = require('../ahmad-core');

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w780';
const REQUEST_TIMEOUT = 1800;
const MOVIE_REGION = process.env.MOVIE_REGION || 'US';

function yearOf(date) {
    return date ? String(date).slice(0, 4) : 'N/A';
}

function cleanText(value, max = 650) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return 'No plot available.';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function tmdbRequired(reply) {
    if (process.env.TMDB_API_KEY) return true;
    reply('❌ TMDB API key configured nahi hai. Railway/Vercel environment mein `TMDB_API_KEY` add karein.');
    return false;
}

function justWatchLink(title) {
    return `https://www.justwatch.com/${MOVIE_REGION.toLowerCase()}/search?q=${encodeURIComponent(title)}`;
}

function netflixSearchLink(title) {
    return `https://www.netflix.com/search?q=${encodeURIComponent(title)}`;
}

async function searchTrailer(title, year) {
    try {
        const result = await ytSearch(`${title} ${year !== 'N/A' ? year : ''} official trailer`);
        const item = result.videos?.find(video => /official\s+trailer|trailer/i.test(video.title)) || result.videos?.[0];
        return item?.url || null;
    } catch (error) {
        console.log('[MOVIE] trailer search failed:', error.message);
        return null;
    }
}

function movieText(movie, trailerUrl) {
    const title = movie.title || movie.original_title || 'Unknown';
    const year = yearOf(movie.release_date);
    const rating = Number.isFinite(Number(movie.vote_average)) ? `${Number(movie.vote_average).toFixed(1)}/10` : 'N/A';
    const trailer = trailerUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${year} official trailer`)}`;
    return [
        '╭━━〔 🎬 MOVIE INFO 〕━━╮',
        `┃ 🎞️ Title: ${title}`,
        `┃ 📅 Year: ${year}`,
        `┃ ⭐ TMDB Rating: ${rating}`,
        `┃ 🌍 Language: ${(movie.original_language || 'N/A').toUpperCase()}`,
        '┃',
        `┃ 📝 Plot: ${cleanText(movie.overview)}`,
        '┃',
        '┃ 🔗 Legal Links:',
        `┃ 📺 JustWatch: ${justWatchLink(title)}`,
        `┃ 🍿 Netflix Search: ${netflixSearchLink(title)}`,
        `┃ ▶️ YouTube Trailer: ${trailer}`,
        '╰━━━━━━━━━━━━━━━━━━━━━━╯',
        'ℹ️ Streaming availability region aur waqt ke hisaab se change ho sakti hai.'
    ].join('\n');
}

cmd({
    pattern: 'movie',
    desc: 'Search movie info, rating, plot and legal links',
    category: 'search',
    filename: __filename,
    react: '🎬'
}, async (conn, mek, m, { q, reply, from }) => {
    const query = String(q || '').trim();
    if (!query) return reply('📝 Usage: .movie <movie name>\nExample: .movie Lover');
    if (!tmdbRequired(reply)) return;

    try {
        const params = {
            api_key: process.env.TMDB_API_KEY,
            query,
            include_adult: false,
            language: 'en-US',
            page: 1,
            region: MOVIE_REGION
        };
        const searchResponse = await axios.get(`${TMDB_API}/search/movie`, { params, timeout: REQUEST_TIMEOUT });
        const movie = searchResponse.data?.results?.[0];
        if (!movie) return reply(`❌ Movie nahi mili: ${query}`);

        const year = yearOf(movie.release_date);
        const [detailsResponse, trailerUrl] = await Promise.all([
            axios.get(`${TMDB_API}/movie/${movie.id}`, {
                params: { api_key: process.env.TMDB_API_KEY, language: 'en-US' },
                timeout: REQUEST_TIMEOUT
            }).catch(() => ({ data: movie })),
            searchTrailer(movie.title || movie.original_title, year)
        ]);
        const details = { ...movie, ...(detailsResponse.data || {}) };
        const text = movieText(details, trailerUrl);
        const poster = details.poster_path ? `${TMDB_IMAGE}${details.poster_path}` : null;

        if (poster) {
            await conn.sendMessage(from, { image: { url: poster }, caption: text }, { quoted: mek });
        } else {
            await conn.sendMessage(from, { text }, { quoted: mek });
        }
    } catch (error) {
        console.log('[MOVIE] TMDB error:', error.response?.status || error.message);
        await reply('❌ Movie search temporarily unavailable hai. Thori dair baad dobara try karein.');
    }
});

// Curated titles whose public-domain status is well established. Metadata and
// watch pages are resolved from Internet Archive; no third-party download host
// or torrent link is exposed.
const PUBLIC_DOMAIN_MOVIES = [
    ['night_of_the_living_dead', 'Night of the Living Dead'],
    ['his_girl_friday', 'His Girl Friday'],
    ['the_general', 'The General'],
    ['charade_1963', 'Charade'],
    ['detour_1945', 'Detour']
];

async function archiveMovie([identifier, fallbackTitle]) {
    try {
        const { data } = await axios.get(`https://archive.org/metadata/${identifier}`, { timeout: REQUEST_TIMEOUT });
        const meta = data?.metadata || {};
        return {
            title: meta.title || fallbackTitle,
            year: meta.year || 'N/A',
            description: cleanText(meta.description, 180),
            url: `https://archive.org/details/${identifier}`
        };
    } catch {
        return { title: fallbackTitle, year: 'N/A', description: 'Public-domain catalogue entry', url: `https://archive.org/details/${identifier}` };
    }
}

cmd({
    pattern: 'publicmovie',
    alias: ['pdmovie', 'publicdomain'],
    desc: 'Show public-domain movies from Internet Archive',
    category: 'search',
    filename: __filename,
    react: '🏛️'
}, async (conn, mek, m, { reply, args }) => {
    const requested = args.join(' ').trim().toLowerCase();
    try {
        const movies = await Promise.all(PUBLIC_DOMAIN_MOVIES.map(archiveMovie));
        const filtered = requested
            ? movies.filter(movie => movie.title.toLowerCase().includes(requested))
            : movies;
        if (!filtered.length) return reply(`❌ Public-domain movie nahi mili: ${requested}`);
        const lines = [
            '╭━━〔 🏛️ PUBLIC-DOMAIN MOVIES 〕━━╮',
            '┃ Internet Archive — legal watch pages',
            '┃'
        ];
        filtered.forEach((movie, index) => {
            lines.push(`┃ ${index + 1}. ${movie.title} (${movie.year})`);
            lines.push(`┃ 📝 ${movie.description}`);
            lines.push(`┃ 🔗 ${movie.url}`);
            lines.push('┃');
        });
        lines.push('╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯');
        lines.push('ℹ️ Usage: .publicmovie ya .publicmovie <title>');
        await reply(lines.join('\n'));
    } catch (error) {
        console.log('[PUBLICMOVIE] Internet Archive error:', error.message);
        await reply('❌ Internet Archive catalogue abhi unavailable hai.');
    }
});

module.exports = { PUBLIC_DOMAIN_MOVIES };
