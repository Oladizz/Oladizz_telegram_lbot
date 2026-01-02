const https = require('https');

function getGeminiChatResponse(apiKey, chatHistory, callback) {
    const systemPromptObject = chatHistory.find(item => item.role === 'system');
    const systemPrompt = systemPromptObject ? systemPromptObject.content : "You are a helpful assistant.";

    // Convert chat history to Gemini's format
    const contents = chatHistory
        .filter(item => item.role !== 'system')
        .map(item => ({
            role: item.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: item.content }]
        }));

    const data = JSON.stringify({
        contents: contents,
        system_instruction: {
          parts: [ {text: systemPrompt} ]
        }
    });

    const options = {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };

    const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
            responseBody += chunk;
        });

        res.on('end', () => {
            callback(res.statusCode, responseBody);
        });
    });

    req.on('error', (error) => {
        console.error("Request Error:", error);
        callback(null, JSON.stringify({ error: { message: "Could not connect to the AI service." } }));
    });

    req.write(data);
    req.end();
}

module.exports = {
    getGeminiChatResponse,
};
