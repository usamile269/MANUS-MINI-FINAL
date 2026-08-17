const { cmd } = require('../ahmad-core');
const { toSansBoldItalic } = require('../lib/menu-styles');
const axios = require('axios');

function parseSimPayload(data) {
    if (data && typeof data === 'object') return data;
    if (typeof data === 'string') {
        // This API inconsistently returns clean JSON for some requests and
        // JSON text with a trailing "/ " for others. Parse both forms.
        const raw = data.replace(/^\uFEFF/, '').trim();
        try { return JSON.parse(raw); } catch {}
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
        }
    }
    return null;
}

function extractSimRecords(payload) {
    const data = parseSimPayload(payload);
    const candidates = [data?.records, data?.record, data?.data?.records, data?.data?.record, data?.data];
    for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length) return candidate;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return [candidate];
    }
    return [];
}

async function lookupSim(apiUrl, numbers) {
    let lastResponse = null;
    for (const search of [...new Set(numbers.filter(Boolean))]) {
        const response = await axios.get(apiUrl, {
            params: { search },
            timeout: 12000,
            validateStatus: status => status >= 200 && status < 500
        });
        lastResponse = parseSimPayload(response.data);
        const records = extractSimRecords(lastResponse);
        const success = lastResponse?.success === true || String(lastResponse?.success).toLowerCase() === 'true' || Number(lastResponse?.count) > 0;
        if (success && records.length) return { record: records[0], searched: search };
    }
    return { record: null, searched: numbers[0], response: lastResponse };
}

function simCard(record, searchedNumber) {
    const B = toSansBoldItalic;
    const name = record.name || 'N/A';
    const mobile = record.mobile || record.number || searchedNumber;
    const cnic = record.cnic || 'N/A';
    const address = record.address || 'N/A';
    const network = record.network || record.operator || 'N/A';
    return `╭━━━〔 📱 ${B('SIM INFORMATION')} 〕━━━╮
┃
┃ 👤 ${B('Name')}: ${name}
┃ 🪪 ${B('CNIC')}: ${cnic}
┃ 📞 ${B('Number')}: ${mobile}
┃ 🏠 ${B('Address')}: ${address}
┃ 📡 ${B('Network')}: ${network}
┃
╰━━━━━━━━━━━━━━━━━━━━╯
> ${B('AHMAD MINI')} ⚡ ${B('Verified information')}`;
}

cmd({
    pattern: 'sim',
    alias: ['numberinfo', 'siminfo'],
    desc: 'Get SIM owner details',
    category: 'tools',
    use: '.sim 0324xxxxxxx',
    react: '📱'
}, async (conn, mek, m, { args, from, reply }) => {
    const input = args.join('').trim();
    if (!input) return reply('❌ Number provide karo.\n📝 Usage: .sim 03249560618');

    let number = input.replace(/[^0-9]/g, '');
    if (number.startsWith('92')) number = '0' + number.slice(2);
    if (!number.startsWith('0') && number.length === 10) number = '0' + number;
    if (number.length < 10 || number.length > 15) return reply('❌ Valid mobile number provide karo.');

    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: m.key } });
        const apiUrl = 'https://wasifali.biz.id/public_apis/sim-info-api.php';
        const international = number.startsWith('0') ? `92${number.slice(1)}` : number;
        const lookup = await lookupSim(apiUrl, [number, international]);
        if (!lookup.record) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return conn.sendMessage(from, { text: '❌ Is number ka koi SIM record nahi mila.' }, { quoted: mek });
        }
        await conn.sendMessage(from, { text: simCard(lookup.record, number) }, { quoted: mek });
        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
    } catch (error) {
        console.error('[SIM ERROR]', error.message);
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        return conn.sendMessage(from, { text: '❌ SIM API temporarily unavailable. Thori dair baad try karo.' }, { quoted: mek });
    }
});
