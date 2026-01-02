function getMainMenu() {
    const message = "Welcome to the 𝕆𝕃𝔸𝔻𝕀ℤℤ bot! Please choose a category from the options below.";
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🤖 Chat with AI', callback_data: 'ai_chat' }
                ],
                [
                    { text: '📄 PDF Tools', callback_data: 'pdf_tools' },
                    { text: '🖼️ Image Tools', callback_data: 'image_tools' },
                    { text: '🎬 Media Tools', callback_data: 'media_tools' }
                ],
                [
                    { text: '🛠️ Developer Tools', callback_data: 'dev_tools' },
                    { text: '🕸️ Web Utilities', callback_data: 'web_utilities' },
                    { text: '📊 Data Tools', callback_data: 'data_tools' }
                ],
                [
                    { text: '🔑 API Management', callback_data: 'api_key_manager' },
                    { text: '🔗 Other Utilities', callback_data: 'other_utilities' }
                ]
            ]
        }
    };
    return { message, opts };
}

module.exports = { getMainMenu };
