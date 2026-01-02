const { getMainMenu } = require('./menu');
const { testApiKey } = require('./utils');

function registerCallbackQueryHandlers(bot, db) {
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const data = callbackQuery.data;
        const userRef = db.collection('user_states').doc(String(chatId));

        bot.answerCallbackQuery(callbackQuery.id);

        const mainMenuHandler = () => {
            const { message, opts } = getMainMenu();
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: msg.message_id,
                ...opts,
            }).catch(() => { /* Ignore error if message is not modified */ });
        };

        const subMenuOpts = (message, inline_keyboard, back_callback = 'main_menu') => {
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: [
                        ...inline_keyboard,
                        [{ text: '⬅️ Back', callback_data: back_callback }]
                    ]
                }
            }).catch(() => { /* Ignore error */ });
        };

        if (data === 'main_menu') return mainMenuHandler();

        const categoryMenus = {
            'pdf_tools': () => subMenuOpts('📄 PDF Tools', [
                [{ text: 'Text to PDF', callback_data: 'convert_text_to_pdf' }, { text: 'Image to PDF', callback_data: 'convert_image_to_pdf' }],
                [{ text: 'Combine Images to PDF', callback_data: 'combine_images_to_pdf' }]
            ]),
            'image_tools': () => subMenuOpts('🖼️ Image Tools', [
                [{ text: 'Convert Format', callback_data: 'convert_image_format' }],
                [{ text: 'To Sticker', callback_data: 'convert_to_sticker' }],
                [{ text: 'Video to Images', callback_data: 'convert_video_to_images' }],
                [{ text: 'JSON to Image', callback_data: 'json_to_image' }],
                [{ text: 'OCR (Image to Text)', callback_data: 'ocr_image' }]
            ]),
            'media_tools': () => subMenuOpts('🎬 Media Tools', [
                [{ text: 'Audio Format', callback_data: 'convert_audio_format' }, { text: 'Video Format', callback_data: 'convert_video_format' }],
                [{ text: 'Extract Audio', callback_data: 'extract_audio_from_video' }]
            ]),
            'dev_tools': () => subMenuOpts('🛠️ Developer Tools', [
                [{ text: 'GitHub', callback_data: 'github' }, { text: 'NPM Search', callback_data: 'npm_search' }],
                [{ text: 'JSON/YAML', callback_data: 'json_yaml_tools' }, { text: 'Base64', callback_data: 'base64_tools' }]
            ]),
            'web_utilities': () => subMenuOpts('🕸️ Web Utilities', [
                [{ text: 'Screenshot', callback_data: 'website_screenshot' }, { text: 'Website to PDF', callback_data: 'website_to_pdf' }],
                [{ text: 'Get Metadata', callback_data: 'get_page_metadata' }, { text: 'Extract Links', callback_data: 'extract_page_links' }],
                [{ text: 'View Source', callback_data: 'view_page_source' }, { text: 'Download URL', callback_data: 'download_from_url' }]
            ]),
            'api_key_manager': () => subMenuOpts('🔑 API Management', [
                [{ text: 'Add/Update', callback_data: 'api_key_add' }, { text: 'List Keys', callback_data: 'api_key_list' }],
                [{ text: 'Delete Key', callback_data: 'api_key_delete' }, { text: 'Test Keys', callback_data: 'api_key_tester' }]
            ]),
            'other_utilities': () => subMenuOpts('🔗 Other Utilities', [
                [{ text: 'Generate QR Code', callback_data: 'generate_qr_code' }, { text: 'Shorten URL', callback_data: 'shorten_url' }],
                [{ text: 'Password Generator', callback_data: 'generate_password' }]
            ]),
            'data_tools': () => subMenuOpts('📊 Data Tools', [
                [{ text: 'JSON to CSV', callback_data: 'json_to_csv' }, { text: 'CSV to JSON', callback_data: 'csv_to_json' }],
                [{ text: 'Text to CSV', callback_data: 'text_to_csv' }]
            ]),
            'base64_tools': () => subMenuOpts('Base64 Tools', [[{ text: 'Encode', callback_data: 'base64_encode' }, { text: 'Decode', callback_data: 'base64_decode' }]], 'dev_tools'),
            'json_yaml_tools': () => subMenuOpts('JSON/YAML Tools', [[{ text: 'Format JSON', callback_data: 'format_json' }], [{ text: 'Format YAML', callback_data: 'format_yaml' }]], 'dev_tools'),
            'convert_image_format': () => subMenuOpts("Please choose the target format:", [[{ text: 'JPG', callback_data: 'format_jpg' }, { text: 'PNG', callback_data: 'format_png' }, { text: 'BMP', callback_data: 'format_bmp' }]], 'image_tools'),
        };

        if (categoryMenus[data]) {
            return categoryMenus[data]();
        }

        // Handle specific actions that require setting state
        const actionHandlers = {
            'convert_text_to_pdf': { state: { action: 'awaiting_text_for_pdf' }, message: "Okay, please send me the text you want to convert to PDF." },
            'convert_image_to_pdf': { state: { action: 'awaiting_image_for_pdf' }, message: "Okay, please send me the image you want to convert to PDF." },
            'combine_images_to_pdf': { state: { action: 'awaiting_images_for_pdf', images: [] }, message: "Okay, send the images to combine. Send 'done' when you are finished." },
            'convert_video_to_images': { state: { action: 'awaiting_frame_count' }, message: "How many frames would you like to extract from the video?" },
            'convert_to_sticker': { state: { action: 'awaiting_image_for_sticker' }, message: "Okay, please send me the image you want to convert to a sticker." },
            'generate_qr_code': { state: { action: 'awaiting_text_for_qr' }, message: "Okay, please send me the text or URL to convert to a QR code." },
            'shorten_url': { state: { action: 'awaiting_url_for_shortening' }, message: "Okay, please send me the URL you want to shorten." },
            'base64_encode': { state: { action: 'awaiting_text_for_base64_encode' }, message: "Okay, please send me the text you want to encode to Base64." },
            'base64_decode': { state: { action: 'awaiting_text_for_base64_decode' }, message: "Okay, please send me the Base64 string you want to decode." },
            'npm_search': { state: { action: 'awaiting_npm_search_query' }, message: "Okay, please send me the name of the NPM package you want to search for." },
            'format_json': { state: { action: 'awaiting_json_for_formatting' }, message: "Okay, please send me the JSON you want to format." },
            'format_yaml': { state: { action: 'awaiting_yaml_for_formatting' }, message: "Okay, please send me the YAML you want to format." },
            'json_to_image': { state: { action: 'awaiting_json_for_image' }, message: "Okay, please send me the JSON you want to convert to an image." },
            'json_to_csv': { state: { action: 'awaiting_json_for_csv' }, message: "Okay, please send me the JSON file you want to convert to CSV." },
            'csv_to_json': { state: { action: 'awaiting_csv_for_json' }, message: "Okay, please send me the CSV file you want to convert to JSON." },
            'text_to_csv': { state: { action: 'awaiting_text_for_csv' }, message: "Okay, please send me the text you want to convert to a CSV file. The first line should be the headers." },
            'api_key_add': { state: { action: 'awaiting_api_key_to_add' }, message: "Please send the service name and the API key in the format `service_name your_api_key`.\n\nYour message will be deleted for security." },
            'api_key_delete': { state: { action: 'awaiting_api_key_to_delete' }, message: "Please send the service name of the key you want to delete." },
            'website_screenshot': { state: { action: 'awaiting_url_for_screenshot' }, message: "Okay, please send me the URL of the website to screenshot (e.g., https://google.com)." },
            'download_from_url': { state: { action: 'awaiting_url_for_download' }, message: "Okay, please send me the URL of the file to download." },
            'website_to_pdf': { state: { action: 'awaiting_url_for_pdf' }, message: "Okay, please send me the URL of the website to convert to PDF (e.g., https://google.com)." },
            'get_page_metadata': { state: { action: 'awaiting_url_for_metadata' }, message: "Okay, please send me the URL of the website to get metadata from." },
            'extract_page_links': { state: { action: 'awaiting_url_for_links' }, message: "Okay, please send me the URL to extract links from." },
            'view_page_source': { state: { action: 'awaiting_url_for_source' }, message: "Okay, please send me the URL to get the page source from." },
            'convert_audio_format': { state: { action: 'awaiting_audio_for_conversion' }, message: "Okay, please send me the audio file you want to convert, then the target format (e.g., `mp3`, `wav`, `ogg`)." },
            'convert_video_format': { state: { action: 'awaiting_video_for_conversion' }, message: "Okay, please send me the video file you want to convert, then the target format (e.g., `mp4`, `avi`, `mov`)." },
            'extract_audio_from_video': { state: { action: 'awaiting_video_for_audio_extraction' }, message: "Okay, please send me the video file from which you want to extract audio." },
            'generate_password': { state: { action: 'awaiting_password_options' }, message: "Please specify password length and options. Format: `<length> <options>`\n\nOptions (combine them):\n`u` - Uppercase\n`l` - Lowercase\n`n` - Numbers\n`s` - Symbols\n\nExample: `16 ulns` (for a 16-char password with all character types)" },
            'ocr_image': { state: { action: 'awaiting_image_for_ocr' }, message: "Okay, please send me the image you want to extract text from." },
        };

        if (actionHandlers[data]) {
            const { message, state } = actionHandlers[data];
            await userRef.set(state, { merge: true });
            return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
        
        if (data.startsWith('format_')) {
            const format = data.split('_')[1];
            await userRef.set({ action: 'awaiting_image_for_conversion', format: format }, { merge: true });
            return bot.sendMessage(chatId, `Okay, please send me the image you want to convert to ${format.toUpperCase()}.`);
        }

        if (data.startsWith('test_api_key_')) {
            const serviceName = data.replace('test_api_key_', '');
            const userDoc = await userRef.get();
            const apiKey = userDoc.exists && userDoc.data().api_keys ? userDoc.data().api_keys[serviceName] : null;
            if (apiKey) {
                return testApiKey(bot, chatId, serviceName, apiKey);
            } else {
                return bot.sendMessage(chatId, 'Could not find a stored API key for `' + serviceName + '`.', { parse_mode: 'Markdown' });
            }
        }
        
        if (data === 'api_key_list') {
            const doc = await userRef.get();
            const keys = doc.exists && doc.data().api_keys ? Object.keys(doc.data().api_keys) : [];
            if (keys.length > 0) {
                let listMessage = "You have API keys stored:\n";
                keys.forEach(key => { listMessage += '- `' + key + '`\n'; });
                bot.sendMessage(chatId, listMessage, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "You have no API keys stored.");
            }
            return;
        }

        if (data === 'api_key_tester') {
            const userDoc = await userRef.get();
            const testKeys = userDoc.exists && userDoc.data().api_keys ? Object.keys(userDoc.data().api_keys) : [];
            if (testKeys.length > 0) {
                const keyboard = testKeys.map(key => ([{ text: `Test: ${key}`, callback_data: `test_api_key_${key}` }]));
                subMenuOpts("Select an API key to test:", keyboard, 'api_key_manager');
            } else {
                bot.sendMessage(chatId, "You have no API keys stored to test.");
            }
            return;
        }

        if (data === 'ai_chat') {
            const doc = await userRef.get();
            const apiKey = doc.exists && doc.data().api_keys ? doc.data().api_keys['gemini'] : null;
            if (apiKey) {
                await userRef.set({ action: 'ai_chat_active' }, { merge: true });
                bot.sendMessage(chatId, "You can now chat with the AI using Gemini 2.5 Flash. To end the conversation, send /endchat command.");
            } else {
                await userRef.set({ action: 'awaiting_gemini_key_for_chat' }, { merge: true });
                bot.sendMessage(chatId, "To use the AI Chat, please send me your Google AI Studio API key.");
            }
            return;
        }
    });
}

module.exports = {
    registerCallbackQueryHandlers,
};