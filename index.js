const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');
const http = require('http'); // Import http module
require('dotenv').config();

const { registerCommandHandlers } = require('./src/commands');
const { registerCallbackQueryHandlers } = require('./src/callbackQueryHandler');
const { registerMessageHandlers } = require('./src/messageHandler');
const { registerGithubHandlers } = require('./src/githubHandler');
const db = require('./src/firestore');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not set in the environment variables.");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Create a directory for temporary files
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Register all handlers, passing the Firestore db instance
registerCommandHandlers(bot, db);
registerCallbackQueryHandlers(bot, db);
registerMessageHandlers(bot, db, tempDir);
registerGithubHandlers(bot, db, tempDir);

// Start a simple HTTP server to listen on a port for Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Oladizz bot (telegram) is running!');
}).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

console.log('Oladizz bot (telegram) started...');
