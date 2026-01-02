const https = require('https');
const crypto = require('crypto');

function downloadFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            const data = [];
            response.on('data', (chunk) => {
                data.push(chunk);
            });
            response.on('end', () => {
                resolve(Buffer.concat(data));
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function testApiKey(bot, chatId, serviceName, apiKey) {
    let options;
    let testUrl;

    const lowerCaseServiceName = serviceName.toLowerCase();

    if (lowerCaseServiceName.includes('openai')) {
        testUrl = 'https://api.openai.com/v1/models';
        options = { headers: { 'Authorization': `Bearer ${apiKey}` } };
    } else if (lowerCaseServiceName.includes('stripe')) {
        testUrl = 'https://api.stripe.com/v1/charges';
        options = { headers: { 'Authorization': `Bearer ${apiKey}` } };
    } else if (lowerCaseServiceName.includes('github')) {
        testUrl = 'https://api.github.com/user';
        options = { headers: { 'Authorization': `token ${apiKey}`, 'User-Agent': 'Telegram-Bot' } };
    } else {
        bot.sendMessage(chatId, `Sorry, testing for the service "${serviceName}" is not supported yet.`);
        return;
    }

    bot.sendMessage(chatId, `Testing API key for \`${serviceName}\`...`);

    https.get(testUrl, options, (res) => {
        let userFriendlyMessage = '';
        if (res.statusCode >= 200 && res.statusCode < 300) {
            userFriendlyMessage = `✅ Your API key for \`${serviceName}\` is working! (Status: ${res.statusCode})`;
        } else {
            userFriendlyMessage = `❌ Your API key for \`${serviceName}\` is NOT working. (Status: ${res.statusCode}). Please check your key or its permissions.`;
        }
        bot.sendMessage(chatId, userFriendlyMessage, { parse_mode: 'Markdown' });
    }).on('error', (err) => {
        console.error(`API Test Error for ${serviceName}:`, err);
        bot.sendMessage(chatId, `❌ An error occurred while trying to test your API key for \`${serviceName}\`. This might be a connection issue or an invalid service name. Please try again.`, { parse_mode: 'Markdown' });
    });
}

function jsonToHtml(jsonString) {
    // A simple syntax highlighter
    let html = jsonString.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        let cls = 'number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'key';
            } else {
                cls = 'string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'boolean';
        } else if (/null/.test(match)) {
            cls = 'null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });

    return `
        <html>
            <head>
                <style>
                    body { background-color: #1E1E1E; font-family: monospace; font-size: 16px; padding: 20px; display: inline-block; }
                    pre { color: #D4D4D4; white-space: pre-wrap; word-wrap: break-word; }
                    .string { color: #CE9178; }
                    .number { color: #B5CEA8; }
                    .boolean { color: #569CD6; }
                    .null { color: #569CD6; }
                    .key { color: #9CDCFE; }
                </style>
            </head>
            <body>
                <pre>${html}</pre>
            </body>
        </html>
    `;
}

function generatePassword(length, options) {
    const charSets = {
        u: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        l: 'abcdefghijklmnopqrstuvwxyz',
        n: '0123456789',
        s: '!@#$%^&*()_+-=[]{}|;:,.<>?'
    };

    let charset = '';
    const includedChars = [];
    if (options.includes('u')) {
        charset += charSets.u;
        includedChars.push(charSets.u[crypto.randomInt(charSets.u.length)]);
    }
    if (options.includes('l')) {
        charset += charSets.l;
        includedChars.push(charSets.l[crypto.randomInt(charSets.l.length)]);
    }
    if (options.includes('n')) {
        charset += charSets.n;
        includedChars.push(charSets.n[crypto.randomInt(charSets.n.length)]);
    }
    if (options.includes('s')) {
        charset += charSets.s;
        includedChars.push(charSets.s[crypto.randomInt(charSets.s.length)]);
    }

    if (!charset) {
        return null; // No character types selected
    }

    let password = includedChars.join('');
    const remainingLength = length - password.length;

    if (remainingLength < 0) {
        // This case can happen if length is smaller than the number of selected charsets.
        // We will just truncate the generated password with included chars and shuffle it.
        return password.split('').sort(() => 0.5 - Math.random()).join('').substring(0, length);
    }

    for (let i = 0; i < remainingLength; i++) {
        const randomIndex = crypto.randomInt(charset.length);
        password += charset[randomIndex];
    }
    
    // Shuffle the password to ensure randomness of character positions
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

module.exports = {
    downloadFile,
    testApiKey,
    jsonToHtml,
    generatePassword,
};
