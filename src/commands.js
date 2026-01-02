const { getMainMenu } = require('./menu');
const { FieldValue } = require('firebase-admin/firestore');

function registerCommandHandlers(bot, db) {
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const { message, opts } = getMainMenu();
        bot.sendMessage(chatId, message, opts);
    });

    bot.onText(/\/cancel/, async (msg) => {
        const chatId = msg.chat.id;
        const userRef = db.collection('user_states').doc(String(chatId));
        const doc = await userRef.get();

        if (doc.exists) {
            await userRef.delete();
            bot.sendMessage(chatId, "The current operation has been cancelled. Send /start to begin a new one.");
        } else {
            bot.sendMessage(chatId, "There is no operation to cancel. Send /start to see available options.");
        }
    });

    bot.onText(/\/endchat/, async (msg) => {
        const chatId = msg.chat.id;
        const userRef = db.collection('user_states').doc(String(chatId));
        const doc = await userRef.get();

        if (doc.exists && doc.data().action === 'ai_chat_active') {
            await userRef.update({
                action: FieldValue.delete(),
                chat_history: FieldValue.delete()
            });
            bot.sendMessage(chatId, "You have ended the chat with the AI. Send /start to see other options.");
        } else {
            bot.sendMessage(chatId, "You are not in an active AI chat session.");
        }
    });
}

module.exports = {
    registerCommandHandlers,
};
