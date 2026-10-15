'use strict';

/**
 * Normalize a user-entered number for Baileys pairing.
 * Baileys expects digits only, including the international country code.
 * Pakistan mobile national format `03XXXXXXXXX` is accepted as a convenience;
 * its trunk `0` is removed when adding the `92` country code.
 */
function normalizePairingNumber(input) {
    let digits = String(input ?? '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);

    if (/^03\d{9}$/.test(digits)) {
        return `92${digits.slice(1)}`;
    }
    if (/^9203\d{9}$/.test(digits)) {
        return `92${digits.slice(3)}`;
    }

    return digits;
}

module.exports = { normalizePairingNumber };
