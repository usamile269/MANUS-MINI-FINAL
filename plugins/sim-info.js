const { cmd } = require('../ahmad-core');
const { toSansBoldItalic } = require('../lib/menu-styles');
const axios = require('axios');

function parseSimPayload(data) {
    if (data && typeof data === 'object') return data;
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return null; }
    }
    return null;
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
        const response = await axios.get(apiUrl, {
            params: { search: number },
            timeout: 15000,
            validateStatus: status => status >= 200 && status < 500
        });
        const data = parseSimPayload(response.data);
        const records = Array.isArray(data?.records) ? data.records : [];
        if (data?.success !== true || records.length === 0) {
            await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
            return conn.sendMessage(from, { text: '❌ Is number ka koi SIM record nahi mila.' }, { quoted: mek });
        }
        await conn.sendMessage(from, { text: simCard(records[0], number) }, { quoted: mek });
        await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
    } catch (error) {
        console.error('[SIM ERROR]', error.message);
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } });
        return conn.sendMessage(from, { text: '❌ SIM API temporarily unavailable. Thori dair baad try karo.' }, { quoted: mek });
    }
});
