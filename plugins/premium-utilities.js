const axios = require('axios');
const moment = require('moment-timezone');
const os = require('os');
const { cmd, commands } = require('../ahmad-core');
const { renderQuotedCard, renderError } = require('../lib/menu-styles');

const fail = (reply, message) => reply(renderError(message));
const clean = value => String(value || '').trim();

async function geocode(city) {
    const name = clean(city);
    if (!name) throw new Error('City name is required.');
    const { data } = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
        params: { name, count: 1, language: 'en', format: 'json' },
        timeout: 7000
    });
    const place = data?.results?.[0];
    if (!place) throw new Error(`Location not found: ${name}`);
    return place;
}

async function weatherFor(place, extra = {}) {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
            latitude: place.latitude,
            longitude: place.longitude,
            timezone: 'auto',
            current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure',
            daily: extra.daily || 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
            forecast_days: extra.forecast_days || 3
        },
        timeout: 8000
    });
    return data;
}

const weatherLabel = code => ({
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    80: 'Rain showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Storm with hail', 99: 'Storm with hail'
}[code] || 'Unknown conditions');

cmd({ pattern: 'forecast', alias: ['weather5', 'weatherforecast'], desc: 'Three-day weather forecast', category: 'tools', react: '🌦️', filename: __filename },
async (conn, mek, m, { q, reply }) => {
    try {
        const place = await geocode(q);
        const data = await weatherFor(place, { forecast_days: 3 });
        const d = data.daily || {};
        const rows = [`📍 Location: ${place.name}, ${place.country || ''}`];
        for (let i = 0; i < Math.min(3, d.time?.length || 0); i++) {
            rows.push(`📅 ${moment(d.time[i]).format('ddd, DD MMM')}: ${d.temperature_2m_min[i]}°C – ${d.temperature_2m_max[i]}°C  •  ☔ ${d.precipitation_probability_max?.[i] ?? 0}%`);
        }
        reply(renderQuotedCard('3-DAY FORECAST', rows, undefined, '🌦️'));
    } catch (e) { fail(reply, e.message || 'Forecast service is temporarily unavailable.'); }
});

cmd({ pattern: 'air', alias: ['aqi', 'airquality'], desc: 'Air quality and pollution information', category: 'tools', react: '🌫️', filename: __filename },
async (conn, mek, m, { q, reply }) => {
    try {
        const place = await geocode(q);
        const { data } = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
            params: { latitude: place.latitude, longitude: place.longitude, timezone: 'auto', current: 'european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide' },
            timeout: 8000
        });
        const c = data.current || {};
        const aqi = Number(c.european_aqi);
        const level = aqi <= 20 ? 'Good' : aqi <= 40 ? 'Fair' : aqi <= 60 ? 'Moderate' : aqi <= 80 ? 'Poor' : 'Very poor';
        reply(renderQuotedCard('AIR QUALITY', [`📍 Location: ${place.name}, ${place.country || ''}`, `🟢 AQI: ${Number.isFinite(aqi) ? aqi : 'N/A'}  •  ${level}`, `🌫️ PM2.5: ${c.pm2_5 ?? 'N/A'} μg/m³  •  PM10: ${c.pm10 ?? 'N/A'} μg/m³`, `🧪 NO₂: ${c.nitrogen_dioxide ?? 'N/A'} μg/m³`, `💡 Advice: ${level === 'Good' || level === 'Fair' ? 'Outdoor activity is generally fine.' : 'Sensitive people should limit prolonged outdoor activity.'}`], undefined, '🌫️'));
    } catch (e) { fail(reply, e.message || 'Air-quality service is temporarily unavailable.'); }
});

cmd({ pattern: 'sun', alias: ['sunrise', 'sunset'], desc: 'Sunrise and sunset information', category: 'tools', react: '🌅', filename: __filename },
async (conn, mek, m, { q, reply }) => {
    try {
        const place = await geocode(q);
        const data = await weatherFor(place, { forecast_days: 1 });
        const d = data.daily || {};
        const rise = d.sunrise?.[0] ? moment(d.sunrise[0]).format('hh:mm A') : 'N/A';
        const set = d.sunset?.[0] ? moment(d.sunset[0]).format('hh:mm A') : 'N/A';
        reply(renderQuotedCard('SUN INFORMATION', [`📍 Location: ${place.name}, ${place.country || ''}`, `🌅 Sunrise: ${rise}`, `🌇 Sunset: ${set}`, `☀️ Daylight: ${rise !== 'N/A' && set !== 'N/A' ? 'Available today' : 'N/A'}`], undefined, '🌅'));
    } catch (e) { fail(reply, e.message || 'Sun information is temporarily unavailable.'); }
});

function moonPhase(date = new Date()) {
    const known = Date.UTC(2000, 0, 6, 18, 14);
    const synodic = 29.530588853;
    const age = ((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - known) / 86400000) % synodic;
    const normalized = (age + synodic) % synodic;
    const illumination = Math.round((1 - Math.cos((normalized / synodic) * 2 * Math.PI)) * 50);
    const names = [[1.85, 'New Moon', '🌑'], [5.53, 'Waxing Crescent', '🌒'], [9.22, 'First Quarter', '🌓'], [12.91, 'Waxing Gibbous', '🌔'], [16.61, 'Full Moon', '🌕'], [20.30, 'Waning Gibbous', '🌖'], [23.99, 'Last Quarter', '🌗'], [27.68, 'Waning Crescent', '🌘']];
    const [limit, name, emoji] = names.find(x => normalized < x[0]) || names[0];
    return { name, emoji, illumination, age: normalized.toFixed(1) };
}

cmd({ pattern: 'moon', alias: ['moonphase'], desc: 'Current moon phase', category: 'tools', react: '🌙', filename: __filename },
async (conn, mek, m, { reply }) => {
    const moon = moonPhase();
    reply(renderQuotedCard('MOON PHASE', [`${moon.emoji} Phase: ${moon.name}`, `💡 Illumination: ${moon.illumination}%`, `🌘 Moon age: ${moon.age} days`, `📅 Date: ${moment().format('dddd, DD MMMM YYYY')}`], undefined, '🌙'));
});

cmd({ pattern: 'calendar', alias: ['dateinfo', 'today'], desc: 'Full date and calendar information', category: 'tools', react: '📅', filename: __filename },
async (conn, mek, m, { reply }) => {
    const now = moment().tz('Asia/Karachi');
    const islamic = new Intl.DateTimeFormat('en-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(now.toDate());
    const end = moment(`${now.year()}-12-31`).endOf('day');
    reply(renderQuotedCard('CALENDAR TODAY', [`📅 ${now.format('dddd, DD MMMM YYYY')}`, `🌙 Islamic date: ${islamic}`, `🕘 Pakistan time: ${now.format('hh:mm:ss A')}`, `📊 Week: ${now.isoWeek()}  •  Day ${now.dayOfYear()} of ${now.daysInYear()}`, `⏳ Year remaining: ${end.diff(now, 'days')} days`], undefined, '📅'));
});

cmd({ pattern: 'system', alias: ['sysinfo', 'botinfo'], desc: 'Bot runtime and system status', category: 'system', react: '🖥️', filename: __filename },
async (conn, mek, m, { reply }) => {
    const mem = process.memoryUsage();
    const up = Math.floor(process.uptime());
    const uptime = `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${up % 60}s`;
    reply(renderQuotedCard('SYSTEM STATUS', [`🟢 Bot: Online`, `⚡ Node: ${process.version}`, `⏳ Uptime: ${uptime}`, `💾 Memory: ${Math.round(mem.rss / 1048576)} MB`, `🧩 Plugins: ${commands.length}`, `🖥️ Platform: ${os.platform()} ${os.arch()}`], undefined, '🖥️'));
});

cmd({ pattern: 'help', alias: ['findcmd', 'commands'], desc: 'Search bot commands', category: 'general', react: '🔎', filename: __filename },
async (conn, mek, m, { q, reply }) => {
    const query = clean(q).toLowerCase();
    const matches = commands.filter(c => {
        const hay = `${c.pattern || ''} ${(c.alias || []).join(' ')} ${c.desc || ''}`.toLowerCase();
        return !query || hay.includes(query);
    }).filter((c, i, arr) => arr.findIndex(x => x.pattern === c.pattern) === i).slice(0, 18);
    if (!matches.length) return fail(reply, `No commands found for: ${q}`);
    const rows = query ? [`🔎 Search: ${query}`, ...matches.map(c => `.${c.pattern} — ${c.desc || 'No description'}`)] : [`📚 Available commands: ${commands.length}`, '💡 Search with: .help weather', ...matches.map(c => `.${c.pattern} — ${c.desc || 'No description'}`)];
    reply(renderQuotedCard(query ? 'COMMAND SEARCH' : 'COMMAND GUIDE', rows, undefined, '🔎'));
});

module.exports = {};
