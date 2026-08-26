// Conversational AI output intentionally stays plain text.
function plainAIResponse(response) {
    return String(response ?? '').trim();
}

module.exports = { plainAIResponse };

