// 🆕 SHIM (2026-10-12): plugins/economy.js aur plugins/hd-pics.js
// require('../lib/command') karte hain, lekin ye file repo me kabhi
// commit hi nahi hui — is liye dono plugins MODULE_NOT_FOUND ki wajah
// se load hi nahi ho rahe thay (.attitude/.aesthetic/.girls/.islamic
// aur saare economy commands silently dead thay).
// Ye shim asal implementation (ahmad-core.js) ko re-export karta hai.
module.exports = require('../ahmad-core');
