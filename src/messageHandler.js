const PDFDocument = require('pdfkit');
const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');
const sharp = require('sharp');
const qrcode = require('qrcode');
const yaml = require('js-yaml');
const { Parser } = require('json2csv');
const csv = require('csv-parser');
const { downloadFile, jsonToHtml, generatePassword, translateText, convertUnits, checkDeadLinks, checkWebsiteSecurity } = require('./utils');
const { getGeminiChatResponse } = require('./aiHandler');
const { askForColorTheme } = require('./menu');
const { FieldValue } = require('firebase-admin/firestore');
const Tesseract = require('tesseract.js');
const puppeteer = require('puppeteer');

function registerMessageHandlers(bot, db, tempDir) {
    bot.on('text', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        const userRef = db.collection('user_states').doc(String(chatId));
        const userDoc = await userRef.get();

        // Ignore commands
        if (text.startsWith('/')) {
            return;
        }
        
        const state = userDoc.exists ? userDoc.data() : {};

        if (state.action === 'awaiting_name_for_profile_card') {
            await userRef.update({
                name: text,
                action: 'awaiting_title_for_profile_card'
            });
            bot.sendMessage(chatId, `Great. Now, what's your title, role, or a short description?`);
        } else if (state.action === 'awaiting_title_for_profile_card') {
            const title = text;
            await userRef.update({
                title: title,
                action: 'awaiting_qr_choice_for_profile_card'
            });

            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Yes', callback_data: 'profile_card_qr_yes' }, { text: 'No', callback_data: 'profile_card_qr_no' }]
                    ]
                }
            };
            bot.sendMessage(chatId, "Excellent. Would you like to add a QR code to your card (e.g., linking to your website or LinkedIn)?", opts);
        } else if (state.action === 'awaiting_qr_url_for_profile_card') {
            if (!text.startsWith('http')) {
                bot.sendMessage(chatId, "That doesn't look like a valid URL. Please send a full URL starting with http:// or https://.");
                return;
            }
            await userRef.update({ qrUrl: text, action: 'awaiting_color_choice' });
            // We need to send a new message to get a message_id to edit for the color theme menu
            const sentMessage = await bot.sendMessage(chatId, 'URL received. Now, let\'s pick a color...');
            askForColorTheme(bot, chatId, sentMessage.message_id);
        } else if (state.action === 'awaiting_temp_text') {
            await userRef.delete();
            const parts = text.split('|');
            const content = parts[0].trim();
            const expiryMinutes = parts.length > 1 ? parseInt(parts[1].trim(), 10) : 60; // Default to 60 minutes

            if (!content) {
                bot.sendMessage(chatId, "Please provide some text to store.");
                return;
            }
            if (isNaN(expiryMinutes) || expiryMinutes <= 0) {
                bot.sendMessage(chatId, "Invalid expiry time. Please provide a positive number of minutes.");
                return;
            }

            const tempId = Math.random().toString(36).substring(2, 10); // Simple unique ID
            const expiryTime = Date.now() + expiryMinutes * 60 * 1000;

            await db.collection('temp_storage').doc(tempId).set({
                type: 'text',
                content: content,
                expiry: expiryTime,
                chatId: chatId,
            });

            bot.sendMessage(chatId, `Your text has been stored temporarily! Use \`/gettemp ${tempId}\` to retrieve it. It will expire in ${expiryMinutes} minutes.`);
        } else if (state.action === 'awaiting_unit_conversion') {
            await userRef.delete();
            const conversionResult = convertUnits(text);
            bot.sendMessage(chatId, conversionResult);
        } else if (state.action === 'awaiting_hash_algorithm_for_file') {
            const algorithm = text.trim();
            const supportedAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];

            if (!supportedAlgorithms.includes(algorithm)) {
                bot.sendMessage(chatId, `Unsupported algorithm. Please use one of: ${supportedAlgorithms.join(', ')}.`);
                return;
            }

            await userRef.delete();
            bot.sendMessage(chatId, `Hashing file with ${algorithm}...`);

            try {
                const fileLink = await bot.getFileLink(state.file_id);
                const fileBuffer = await downloadFile(fileLink);
                
                const crypto = require('crypto');
                const hash = crypto.createHash(algorithm).update(fileBuffer).digest('hex');
                bot.sendMessage(chatId, `*${algorithm.toUpperCase()} Hash:*\n\`\`\`\n${hash}\n\`\`\``, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error("Error hashing file:", error);
                bot.sendMessage(chatId, "Sorry, I couldn't hash that file.");
            }
        } else if (state.action === 'awaiting_text_for_hashing') {
            await userRef.delete();
            const parts = text.split('|');
            if (parts.length !== 2) {
                bot.sendMessage(chatId, "Invalid format. Please use `text | algorithm` (e.g., `my text | md5`).");
                return;
            }
            const [textToHash, algorithm] = parts.map(p => p.trim());
            const supportedAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];

            if (!supportedAlgorithms.includes(algorithm)) {
                bot.sendMessage(chatId, `Unsupported algorithm. Please use one of: ${supportedAlgorithms.join(', ')}.`);
                return;
            }

            const crypto = require('crypto');
            const hash = crypto.createHash(algorithm).update(textToHash).digest('hex');
            bot.sendMessage(chatId, `*${algorithm.toUpperCase()} Hash:*\n\`\`\`\n${hash}\n\`\`\``, { parse_mode: 'Markdown' });
        } else if (state.action === 'awaiting_password_options') {
            await userRef.delete();
            bot.deleteMessage(chatId, msg.message_id);

            const args = text.split(' ');
            const length = parseInt(args[0], 10);
            const options = args[1] || 'ulns'; // Default to all character types

            if (isNaN(length) || length <= 0) {
                bot.sendMessage(chatId, "Invalid length. Please provide a positive number.");
                return;
            }
            
            if (length > 1024) {
                bot.sendMessage(chatId, "Password length cannot exceed 1024 characters.");
                return;
            }

            const password = generatePassword(length, options);

            if (!password) {
                bot.sendMessage(chatId, "Invalid options. Please select at least one character type: u, l, n, s.");
                return;
            }

            const warningMessage = "⚠️ Here is your generated password. This message will be deleted in 30 seconds for your security. Please copy it and store it in a safe place. The bot will not save it.";
            
            bot.sendMessage(chatId, warningMessage).then(() => {
                bot.sendMessage(chatId, `\`\`\`\n${password}\n\`\`\``, { parse_mode: 'Markdown' })
                    .then((sentMessage) => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sentMessage.message_id).catch(err => console.error("Error deleting password message:", err));
                        }, 30000); // 30 seconds
                    });
            });
        } else if (state.action === 'awaiting_frame_count') {
            const frameCount = parseInt(text, 10);
            if (isNaN(frameCount) || frameCount <= 0) {
                bot.sendMessage(chatId, "Please provide a valid number greater than 0.");
                return;
            }
            await userRef.set({ 
                frameCount: frameCount,
                action: 'awaiting_video_for_images' 
            }, { merge: true });
            bot.sendMessage(chatId, `Okay, I will extract ${frameCount} frames. Please send me the video.`);
        } else if (state.action === 'awaiting_text_for_pdf') {
            await userRef.delete();
            const doc = new PDFDocument();
            const filePath = path.join(tempDir, `output_${chatId}_${Date.now()}.pdf`);
            const stream = fs.createWriteStream(filePath);

            doc.pipe(stream);
            doc.fontSize(12).text(text, {
                align: 'left'
            });
            doc.end();

            stream.on('finish', () => {
                bot.sendDocument(chatId, filePath).then(() => {
                    // Clean up the file after sending
                    fs.unlinkSync(filePath);
                    bot.sendMessage(chatId, "Text converted to PDF successfully! Send /start to convert more.");
                }).catch(error => {
                    console.error("Error sending document:", error);
                    bot.sendMessage(chatId, "There was an error sending your PDF.");
                });
            });
        } else if (state.action === 'awaiting_text_for_csv') {
            await userRef.delete();
            try {
                const csvPath = path.join(tempDir, `text_${chatId}_${Date.now()}.csv`);
                fs.writeFileSync(csvPath, text);
                bot.sendDocument(chatId, csvPath).then(() => {
                    fs.unlinkSync(csvPath);
                    bot.sendMessage(chatId, "Text converted to CSV successfully!");
                });
            } catch (error) {
                bot.sendMessage(chatId, "Sorry, I couldn't convert that text to CSV.");
                console.error("Error converting text to CSV:", error);
            }
        } else if (state.action === 'awaiting_images_for_pdf' && text.toLowerCase() === 'done') {
            if (!state.images || state.images.length === 0) {
                bot.sendMessage(chatId, "You haven't sent any images yet. Please send some images first.");
                return;
            }

            const doc = new PDFDocument();
            const pdfPath = path.join(tempDir, `combined_${chatId}_${Date.now()}.pdf`);
            const stream = fs.createWriteStream(pdfPath);
            doc.pipe(stream);

            for (let i = 0; i < state.images.length; i++) {
                const imagePath = state.images[i];
                const image = await Jimp.read(imagePath);
                doc.addPage({ size: [image.bitmap.width, image.bitmap.height] });
                doc.image(imagePath, 0, 0, {
                    width: image.bitmap.width,
                    height: image.bitmap.height
                });
            }
            doc.end();

            stream.on('finish', () => {
                bot.sendDocument(chatId, pdfPath).then(async () => {
                    // Clean up files
                    state.images.forEach(imagePath => fs.unlinkSync(imagePath));
                    fs.unlinkSync(pdfPath);
                    await userRef.delete(); // Reset state
                    bot.sendMessage(chatId, "Images combined into PDF successfully! Send /start to convert more.");
                }).catch(error => {
                    console.error("Error sending document:", error);
                    bot.sendMessage(chatId, "There was an error sending your PDF.");
                });
            });
        } else if (state.action === 'awaiting_url_for_screenshot') {
            const url = msg.text;
            await userRef.delete(); 
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            bot.sendMessage(chatId, "Taking screenshot... This might take a moment.");
        
            const puppeteer = require('puppeteer');
            (async () => {
                let browser;
                const screenshotPath = path.join(tempDir, `screenshot_${chatId}_${Date.now()}.png`);
                try {
                    browser = await puppeteer.launch({
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    const page = await browser.newPage();
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    await page.screenshot({ path: screenshotPath, fullPage: true });
        
                    await bot.sendPhoto(chatId, screenshotPath, { caption: `Screenshot of ${url}` });
                    bot.sendMessage(chatId, "Screenshot taken successfully! Send /start for more options.");
                } catch (error) {
                    console.error("Puppeteer error:", error);
                    bot.sendMessage(chatId, "Sorry, I couldn't take a screenshot of that page. Please make sure the URL is correct and the page is accessible.");
                } finally {
                    if (browser) {
                        await browser.close();
                    }
                    if (fs.existsSync(screenshotPath)) {
                        fs.unlinkSync(screenshotPath);
                    }
                }
            })();
        } else if (state.action === 'awaiting_url_for_dead_link_check') {
            const url = msg.text;
            await userRef.delete();
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            const checkingMsg = await bot.sendMessage(chatId, `Checking for dead links on ${url}... This might take a while.`);

            const deadLinks = await checkDeadLinks(url, (progress) => {
                bot.editMessageText(`Checking for dead links on ${url}...\nChecked ${progress.checked}/${progress.total} links. Found ${progress.dead} dead links.`, {
                    chat_id: chatId,
                    message_id: checkingMsg.message_id
                }).catch(e => {}); // Ignore errors if message is not modified
            });

            let report = `*Dead link report for ${url}:*\n\n`;
            if (deadLinks.length === 0) {
                report += 'No dead links found! 🎉';
            } else {
                // Check if the only "dead link" is an error from fetching the initial page
                if (deadLinks.length === 1 && deadLinks[0].error) {
                    report += `Could not check the page. Reason: ${deadLinks[0].error}`;
                } else {
                    report += `Found ${deadLinks.length} dead links:\n`;
                    deadLinks.forEach(link => {
                        report += `• \`${link.url}\` (Status: ${link.status})\n`;
                    });
                }
            }
            bot.editMessageText(report, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: 'Markdown', disable_web_page_preview: true });
        } else if (state.action === 'awaiting_url_for_security_check') {
            const url = msg.text;
            await userRef.delete();
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            const checkingMsg = await bot.sendMessage(chatId, `Performing basic security check on ${url}...`);

            const result = await checkWebsiteSecurity(url);

            let reportMessage = `*Basic Security Report for ${url}:*\n\n`;

            if (!result.success) {
                reportMessage = `Could not perform security check. Reason: ${result.error}`;
            } else {
                const report = result.report;
                reportMessage += report.isHTTPS 
                    ? '✅ Uses HTTPS\n' 
                    : '❌ Does not use HTTPS. Data sent to this site is not encrypted.\n';

                if (report.mixedContent.length > 0) {
                    reportMessage += `\n⚠️ Found ${report.mixedContent.length} instance(s) of mixed content (insecure resources on a secure page):\n`;
                    report.mixedContent.slice(0, 5).forEach(item => {
                        reportMessage += `• \`${item.substring(0, 100)}...\`\n`;
                    });
                    if (report.mixedContent.length > 5) {
                        reportMessage += `...and ${report.mixedContent.length - 5} more.\n`;
                    }
                } else {
                     if(report.isHTTPS) {
                        reportMessage += '✅ No mixed content found.\n';
                     }
                }

                if (report.missingHeaders.length > 0) {
                    reportMessage += `\n⚠️ Missing recommended security headers:\n`;
                    report.missingHeaders.forEach(header => {
                        reportMessage += `• \`${header}\`\n`;
                    });
                } else {
                    reportMessage += '\n✅ All recommended security headers are present.\n';
                }
            }

            bot.editMessageText(reportMessage, { 
                chat_id: chatId, 
                message_id: checkingMsg.message_id, 
                parse_mode: 'Markdown',
                disable_web_page_preview: true 
            });
        } else if (state.action === 'awaiting_url_for_pdf') {
            const url = msg.text;
            await userRef.delete(); 
        
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            bot.sendMessage(chatId, "Converting website to PDF... This might take a moment.");
        
            const puppeteer = require('puppeteer');
            (async () => {
                let browser;
                const pdfPath = path.join(tempDir, `website_${chatId}_${Date.now()}.pdf`);
                try {
                    browser = await puppeteer.launch({
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    const page = await browser.newPage();
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    
                    await page.pdf({
                        path: pdfPath,
                        format: 'A4',
                        printBackground: true
                    });
        
                    await bot.sendDocument(chatId, pdfPath, { caption: `PDF of ${url}` });
                    bot.sendMessage(chatId, "Website converted to PDF successfully!");

                } catch (error) {
                    console.error("Puppeteer error (Website to PDF):", error);
                    bot.sendMessage(chatId, "Sorry, I couldn't convert that page to PDF. Please make sure the URL is correct and the page is accessible.");
                } finally {
                    if (browser) {
                        await browser.close();
                    }
                    if (fs.existsSync(pdfPath)) {
                        fs.unlinkSync(pdfPath);
                    }
                }
            })();
        } else if (state.action === 'awaiting_url_for_metadata') {
            const url = msg.text;
            await userRef.delete(); 
        
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            bot.sendMessage(chatId, "Fetching website metadata... This might take a moment.");
        
            const puppeteer = require('puppeteer');
            (async () => {
                let browser;
                try {
                    browser = await puppeteer.launch({
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    const page = await browser.newPage();
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    
                    const metadata = await page.evaluate(() => {
                        const data = {};
                        data.title = document.title;
                        
                        const metas = document.getElementsByTagName('meta');
                        for (let i = 0; i < metas.length; i++) {
                            const property = metas[i].getAttribute('property') || metas[i].getAttribute('name');
                            const content = metas[i].getAttribute('content');
                            if (property && content) {
                                data[property] = content;
                            }
                        }
                        return data;
                    });
        
                    let message = `*Metadata for ${url}:*\n\n`;
                    message += `*Title:* ${metadata.title || 'N/A'}\n`;
                    if(metadata.description) message += `*Description:* ${metadata.description}\n`;
                    if(metadata['og:title']) message += `*OG Title:* ${metadata['og:title']}\n`;
                    if(metadata['og:description']) message += `*OG Description:* ${metadata['og:description']}\n`;
                    if(metadata['og:image']) message += `*OG Image:* [link](${metadata['og:image']})\n`;
        
                    if(Object.keys(metadata).length === 1 && metadata.title) { // only title found
                         message += "\nNo other common metadata tags (description, Open Graph) were found on this page."
                    }
                    
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
        
                } catch (error) {
                    console.error("Puppeteer error (Get Metadata):", error);
                    bot.sendMessage(chatId, "Sorry, I couldn't fetch metadata from that page. Please make sure the URL is correct and the page is accessible.");
                } finally {
                    if (browser) {
                        await browser.close();
                    }
                }
            })();
        } else if (state.action === 'awaiting_url_for_links') {
            const url = msg.text;
            await userRef.delete(); 
        
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            bot.sendMessage(chatId, "Extracting links... This might take a moment.");
        
            const puppeteer = require('puppeteer');
            (async () => {
                let browser;
                try {
                    browser = await puppeteer.launch({
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    const page = await browser.newPage();
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    
                    const links = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('a'))
                            .map(a => a.href)
                            .filter(href => href.startsWith('http')); // Only get absolute links
                    });
                    
                    const uniqueLinks = [...new Set(links)]; // Remove duplicates
        
                    let message = `*Found ${uniqueLinks.length} unique links on ${url}:*\n\n`;
                    if(uniqueLinks.length === 0){
                        message = `No unique, absolute links found on ${url}.`;
                    } else {
                        const linksToShow = uniqueLinks.slice(0, 50); 
                        message += linksToShow.join('\n');
                        if (uniqueLinks.length > 50) {
                            message += `\n\n...and ${uniqueLinks.length - 50} more.`;
                        }
                    }
                    
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
        
                } catch (error) {
                    console.error("Puppeteer error (Extract Links):", error);
                    bot.sendMessage(chatId, "Sorry, I couldn't extract links from that page. Please make sure the URL is correct and the page is accessible.");
                } finally {
                    if (browser) {
                        await browser.close();
                    }
                }
            })();
        } else if (state.action === 'awaiting_url_for_source') {
            const url = msg.text;
            await userRef.delete(); 
        
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            bot.sendMessage(chatId, "Fetching page source... This might take a moment.");
        
            const puppeteer = require('puppeteer');
            (async () => {
                let browser;
                try {
                    browser = await puppeteer.launch({
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    const page = await browser.newPage();
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    
                    const content = await page.content();
                    
                    const sourcePath = path.join(tempDir, `source_${chatId}_${Date.now()}.html`);
                    fs.writeFileSync(sourcePath, content);
        
                    bot.sendDocument(chatId, sourcePath, { caption: `HTML source code for ${url}` }).finally(() => {
                        fs.unlinkSync(sourcePath);
                    });
        
                } catch (error) {
                    console.error("Puppeteer error (View Source):", error);
                    bot.sendMessage(chatId, "Sorry, I couldn't get the source code from that page. Please make sure the URL is correct and the page is accessible.");
                } finally {
                    if (browser) {
                        await browser.close();
                    }
                }
            })();
        } else if (state.action === 'awaiting_url_for_download') {
            const url = msg.text;
            await userRef.delete(); 
            if (!url.startsWith('http')) {
                bot.sendMessage(chatId, "Please provide a valid URL starting with http:// or https://.");
                return;
            }
            bot.sendMessage(chatId, "Downloading file... This may take a moment.");

            (async () => {
                let filePath;
                try {
                    const fileBuffer = await downloadFile(url);
                    const fileName = path.basename(new URL(url).pathname) || 'downloaded_file';
                    filePath = path.join(tempDir, `download_${chatId}_${Date.now()}_${fileName}`);
                    fs.writeFileSync(filePath, fileBuffer);

                    await bot.sendDocument(chatId, filePath);
                    bot.sendMessage(chatId, "File downloaded successfully! Send /start for more options.");
                } catch (error) {
                    console.error("File download error:", error);
                    bot.sendMessage(chatId, "Sorry, I couldn't download the file from that URL. Please make sure the link is correct and public.");
                } finally {
                    if (filePath && fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            })();
        } else if (state.action === 'awaiting_text_for_qr') {
            const qrText = msg.text;
            await userRef.delete();
            bot.sendMessage(chatId, "Generating your QR code...");

            const qrPath = path.join(tempDir, `qr_${chatId}_${Date.now()}.png`);
            
            qrcode.toFile(qrPath, qrText, (err) => {
                if (err) {
                    console.error('Error generating QR code:', err);
                    bot.sendMessage(chatId, 'Sorry, there was an error generating your QR code.');
                    return;
                }

                bot.sendPhoto(chatId, qrPath).then(() => {
                    fs.unlinkSync(qrPath);
                    bot.sendMessage(chatId, 'QR code generated successfully! Send /start to do more.');
                }).catch(error => {
                    console.error("Error sending QR photo:", error);
                    bot.sendMessage(chatId, "There was an error sending your QR code.");
                });
            });
        } else if (state.action === 'awaiting_url_for_shortening') {
            const urlToShorten = msg.text;
            await userRef.delete();

            if (!urlToShorten.startsWith('http')) {
                bot.sendMessage(chatId, "Please send a valid URL (e.g., starting with http:// or https://).");
                return;
            }

            bot.sendMessage(chatId, "Shortening your URL...");

            const https = require('https');
            https.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlToShorten)}`, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        bot.sendMessage(chatId, `Shortened URL: ${data}`);
                    } else {
                        bot.sendMessage(chatId, `Sorry, there was an error shortening the URL. API returned: ${data}`);
                    }
                });
            }).on('error', (err) => {
                console.error('Error shortening URL:', err);
                bot.sendMessage(chatId, 'Sorry, there was an error connecting to the URL shortening service.');
            });
        } else if (state.action === 'awaiting_text_for_base64_encode') {
            await userRef.delete();
            const textToEncode = msg.text;
            const encodedText = Buffer.from(textToEncode).toString('base64');
            bot.sendMessage(chatId, `Encoded Text: \n\`\`\`\n${encodedText}\n\`\`\``, { parse_mode: 'Markdown' });
        } else if (state.action === 'awaiting_text_for_base64_decode') {
            await userRef.delete();
            const textToDecode = msg.text;
            try {
                const decodedText = Buffer.from(textToDecode, 'base64').toString('utf8');
                bot.sendMessage(chatId, `Decoded Text:\n${decodedText}`);
            } catch (error) {
                bot.sendMessage(chatId, "Invalid Base64 string. Please make sure you are sending a valid Base64-encoded text.");
            }
        } else if (state.action === 'awaiting_npm_search_query') {
            const query = msg.text;
            await userRef.delete();
            bot.sendMessage(chatId, `Searching for NPM package: "${query}"...`);

            const https = require('https');
            https.get(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        const results = JSON.parse(data);
                        if (results.objects.length === 0) {
                            bot.sendMessage(chatId, "No packages found for your query.");
                            return;
                        }
                        let message = `*Search results for "${query}":*\n\n`;
                        results.objects.forEach(result => {
                            const pkg = result.package;
                            message += `*${pkg.name}* (v${pkg.version})\n`;
                            message += `[NPM](https://www.npmjs.com/package/${pkg.name}) | [Homepage](${pkg.links.homepage || `https://www.npmjs.com/package/${pkg.name}`})\n`;
                            message += `${pkg.description || 'No description'}\n\n`;
                        });
                        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
                    } else {
                        bot.sendMessage(chatId, "Sorry, there was an error searching the NPM registry.");
                    }
                });
            }).on('error', (err) => {
                console.error('Error searching NPM:', err);
                bot.sendMessage(chatId, 'Sorry, there was an error connecting to the NPM registry.');
            });
        } else if (state.action === 'awaiting_json_for_formatting') {
            await userRef.delete();
            const jsonString = msg.text;
            try {
                const jsonObj = JSON.parse(jsonString);
                const formattedJson = JSON.stringify(jsonObj, null, 2);
                bot.sendMessage(chatId, 'Formatted JSON:\n```json\n' + formattedJson + '\n```', { parse_mode: 'Markdown' });
            } catch (error) {
                bot.sendMessage(chatId, `Invalid JSON: ${error.message}`);
            }
        } else if (state.action === 'awaiting_yaml_for_formatting') {
            await userRef.delete();
            const yamlString = msg.text;
            try {
                const yamlObj = yaml.load(yamlString);
                const formattedYaml = yaml.dump(yamlObj);
                bot.sendMessage(chatId, 'Formatted YAML:\n```yaml\n' + formattedYaml + '\n```', { parse_mode: 'Markdown' });
            } catch (error) {
                bot.sendMessage(chatId, `Invalid YAML: ${error.message}`);
            }
        } else if (state.action === 'awaiting_json_for_image') {
            const jsonString = msg.text;
            let jsonObj;
            try {
                jsonObj = JSON.parse(jsonString);
            } catch (error) {
                bot.sendMessage(chatId, `Invalid JSON: ${error.message}`);
                return;
            }
        
            bot.sendMessage(chatId, "Generating image from JSON... This might take a moment.");
        
            const prettyJson = JSON.stringify(jsonObj, null, 2);
            const htmlContent = jsonToHtml(prettyJson);
        
            const htmlPath = path.join(tempDir, `json_${chatId}_${Date.now()}.html`);
            const imagePath = path.join(tempDir, `json_image_${chatId}_${Date.now()}.png`);
        
            fs.writeFileSync(htmlPath, htmlContent);
        
            const puppeteer = require('puppeteer');
            (async () => {
                let browser;
                try {
                    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                    const page = await browser.newPage();
                    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
                    
                    const bodyHandle = await page.$('body');
                    const { width, height } = await bodyHandle.boundingBox();
                    await page.setViewport({ width: Math.ceil(width) + 20, height: Math.ceil(height) + 20 });
        
                    await page.screenshot({ path: imagePath });
        
                    await bot.sendPhoto(chatId, imagePath);
                    bot.sendMessage(chatId, "JSON converted to image successfully!");
        
                } catch (error) {
                    console.error("Puppeteer error (JSON to Image):", error);
                    bot.sendMessage(chatId, "Sorry, I couldn't generate an image from that JSON.");
                } finally {
                    if (browser) await browser.close();
                    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
                    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                    await userRef.delete();
                }
            })();
        } else if (state.action === 'awaiting_api_key_to_add') {
            const parts = msg.text.split(' ');
            if (parts.length < 2) {
                bot.sendMessage(chatId, "Invalid format. Please use `service_name your_api_key`.");
                return;
            }
            const serviceName = parts.shift();
            const apiKey = parts.join(' ');
            
            await userRef.update({
                [`api_keys.${serviceName}`]: apiKey,
                action: FieldValue.delete()
            });

            bot.deleteMessage(chatId, msg.message_id);
            bot.sendMessage(chatId, `API key for \`${serviceName}\` has been saved.`, { parse_mode: 'Markdown' });
                } else if (state.action === 'awaiting_api_key_to_delete') {
                    const serviceName = msg.text;
                    if (state.api_keys && state.api_keys[serviceName]) {
                        await userRef.update({
                            [`api_keys.${serviceName}`]: FieldValue.delete(),
                            action: FieldValue.delete()
                        });
                        bot.sendMessage(chatId, `API key for \`${serviceName}\` has been deleted.`, { parse_mode: 'Markdown' });
                    } else {
                        await userRef.update({ action: FieldValue.delete() });
                        bot.sendMessage(chatId, `No API key found for a service named \`${serviceName}\`.`, { parse_mode: 'Markdown' });
                    }
                } else if (state.action === 'awaiting_gemini_key_for_chat') {
            const apiKey = msg.text;
            await userRef.set({ 
                api_keys: { gemini: apiKey },
                action: 'ai_chat_active'
            }, { merge: true });

            bot.deleteMessage(chatId, msg.message_id);
            bot.sendMessage(chatId, "API key saved. You can now chat with the AI. Send '/endchat' to stop.");
        } else if (state.action === 'ai_chat_active') {
            const userInput = msg.text;
            const apiKey = state.api_keys ? state.api_keys.gemini : null;

            if (!apiKey) {
                bot.sendMessage(chatId, "Google AI Studio API key not found. Please set it again via the 'Chat with AI' button.");
                await userRef.update({ action: FieldValue.delete() });
                return;
            }

            const currentHistory = state.chat_history || [{ role: "system", content: "You are a helpful assistant." }];
            const newHistory = [...currentHistory, { role: "user", content: userInput }];

            bot.sendChatAction(chatId, 'typing');

            getGeminiChatResponse(apiKey, newHistory, async (statusCode, responseBody) => {
                 if (statusCode >= 200 && statusCode < 300) {
                    try {
                        const result = JSON.parse(responseBody);
                        if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0].text) {
                            const aiResponse = result.candidates[0].content.parts[0].text;
                            await userRef.update({
                                chat_history: FieldValue.arrayUnion({ role: "user", content: userInput }, { role: "assistant", content: aiResponse })
                            });
                            bot.sendMessage(chatId, aiResponse);
                        } else {
                            bot.sendMessage(chatId, "Sorry, the AI returned an empty or invalid response.");
                        }
                    } catch (e) {
                         bot.sendMessage(chatId, "Sorry, I had trouble understanding the AI's response.");
                         console.error("Error parsing Gemini response:", e);
                    }
                } else {
                    try {
                        const errorResponse = JSON.parse(responseBody);
                        console.error("Gemini API Error:", errorResponse);
                        // FOR TESTING: Display full error
                        const userMessage = `An error occurred with the AI service (Status: ${statusCode}).\n\n\`\`\`json\n${JSON.stringify(errorResponse, null, 2)}\n\`\`\``;
                        bot.sendMessage(chatId, userMessage, { parse_mode: 'Markdown' });

                        if (statusCode === 400 || statusCode === 403) {
                             bot.sendMessage(chatId, "Your Google AI Studio API key seems to be invalid. I've removed it. Please set it again.");
                             await userRef.update({
                                 'api_keys.gemini': FieldValue.delete(),
                                 action: FieldValue.delete(),
                                 chat_history: FieldValue.delete()
                             });
                        }
                    } catch(e) {
                        bot.sendMessage(chatId, `An unparsable error occurred with the AI service (Status: ${statusCode}).\n\nRaw body:\n${responseBody}`);
                    }
                }
            });
        } else if (state.action === 'awaiting_target_audio_format') {
            // ...
        } else if (state.action === 'awaiting_target_video_format') {
            // ...
        } else {
            bot.sendMessage(chatId, "Please use the buttons to select a conversion type or send /start to see options.");
        }
    });

    bot.on('photo', async (msg) => {
        const chatId = msg.chat.id;
        const userRef = db.collection('user_states').doc(String(chatId));
        const userDoc = await userRef.get();

        if (!userDoc.exists) return;
        const state = userDoc.data();

        if (state.action === 'awaiting_photo_for_profile_card') {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const fileLink = await bot.getFileLink(photoId);
            const imagePath = path.join(tempDir, `profile_${chatId}_${Date.now()}.jpg`);
            
            try {
                const imageBuffer = await downloadFile(fileLink);
                fs.writeFileSync(imagePath, imageBuffer);

                await userRef.update({
                    photoPath: imagePath,
                    action: 'awaiting_name_for_profile_card'
                });

                bot.sendMessage(chatId, "Photo received! Now, what name should I put on the card?");
            } catch (err) {
                console.error("Error saving profile card photo:", err);
                bot.sendMessage(chatId, "I'm sorry, I had trouble saving that photo. Please try again.");
                await userRef.delete();
            }
        } else if (state.action === 'awaiting_image_for_pdf') {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const fileLink = await bot.getFileLink(photoId);
            const imagePath = path.join(tempDir, `image_${chatId}_${Date.now()}.jpg`);

            try {
                bot.sendMessage(chatId, "Processing image for PDF...");
                const imageBuffer = await downloadFile(fileLink);
                fs.writeFileSync(imagePath, imageBuffer);

                const doc = new PDFDocument();
                const pdfPath = path.join(tempDir, `output_image_${chatId}_${Date.now()}.pdf`);
                const stream = fs.createWriteStream(pdfPath);
                doc.pipe(stream);

                const image = await Jimp.read(imagePath);
                doc.addPage({ size: [image.bitmap.width, image.bitmap.height] });
                doc.image(imagePath, 0, 0, {
                    width: image.bitmap.width,
                    height: image.bitmap.height
                });
                doc.end();

                stream.on('finish', () => {
                    bot.sendDocument(chatId, pdfPath).then(async () => {
                        fs.unlinkSync(imagePath);
                        fs.unlinkSync(pdfPath);
                        await userRef.delete(); // Reset state
                        bot.sendMessage(chatId, "Image converted to PDF successfully! Send /start to convert more.");
                    }).catch(error => {
                        console.error("Error sending image PDF document:", error);
                        bot.sendMessage(chatId, "There was an error sending your PDF.");
                    });
                });
            } catch (err) {
                console.error("Error processing single image for PDF:", err);
                bot.sendMessage(chatId, "I'm sorry, I had trouble processing that image for PDF conversion.");
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                await userRef.delete(); // Reset state on error
            }
        } else if (state.action === 'awaiting_images_for_pdf') {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const fileLink = await bot.getFileLink(photoId);
            const imagePath = path.join(tempDir, `image_${chatId}_${Date.now()}.jpg`);
            
            try {
                const imageBuffer = await downloadFile(fileLink);
                fs.writeFileSync(imagePath, imageBuffer);
                await userRef.update({ images: FieldValue.arrayUnion(imagePath) });
                const updatedDoc = await userRef.get();
                const imageCount = updatedDoc.data().images.length;
                bot.sendMessage(chatId, `Image received (${imageCount} total). Send more images or 'done' to finish.`);
            } catch (err) {
                console.error("Error processing image for PDF combination:", err);
                bot.sendMessage(chatId, "I'm sorry, I had trouble processing that image.");
            }
        } else if (state.action === 'awaiting_image_for_conversion') {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const fileLink = await bot.getFileLink(photoId);
            const imagePath = path.join(tempDir, `image_${chatId}_${Date.now()}.original`); // Use a generic original extension
            const outputPath = path.join(tempDir, `image_${chatId}_${Date.now()}.${state.format}`);

            try {
                bot.sendMessage(chatId, `Converting image to ${state.format.toUpperCase()}...`);
                const imageBuffer = await downloadFile(fileLink);
                fs.writeFileSync(imagePath, imageBuffer);

                if (state.format === 'bmp') {
                    const image = await Jimp.read(imagePath);
                    await image.writeAsync(outputPath);
                } else {
                    await sharp(imagePath)
                        .toFormat(state.format, { quality: 90 }) // Adjust quality as needed
                        .toFile(outputPath);
                }
                
                await bot.sendDocument(chatId, outputPath, { caption: `Image converted to ${state.format.toUpperCase()}!` });
                bot.sendMessage(chatId, "Image conversion complete! Send /start to convert more.");

            } catch (err) {
                console.error(`Error converting image to ${state.format}:`, err);
                bot.sendMessage(chatId, `Sorry, I had trouble converting your image to ${state.format.toUpperCase()}.`);
            } finally {
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                await userRef.delete(); // Reset state
            }
        } else if (state.action === 'awaiting_image_for_sticker') {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const fileLink = await bot.getFileLink(photoId);
            const imagePath = path.join(tempDir, `image_${chatId}_${Date.now()}.original`); // Use a generic original extension
            const outputPath = path.join(tempDir, `sticker_${chatId}_${Date.now()}.webp`);

            try {
                bot.sendMessage(chatId, "Converting image to sticker...");
                const imageBuffer = await downloadFile(fileLink);
                fs.writeFileSync(imagePath, imageBuffer);

                await sharp(imagePath)
                    .resize(512, 512, {
                        fit: sharp.fit.contain,
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .webp({ quality: 90 })
                    .toFile(outputPath);
                
                await bot.sendSticker(chatId, outputPath);
                bot.sendMessage(chatId, "Image converted to sticker successfully! Send /start to convert more.");

            } catch (err) {
                console.error("Error converting image to sticker:", err);
                bot.sendMessage(chatId, "Sorry, I had trouble converting your image to a sticker.");
            } finally {
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                await userRef.delete(); // Reset state
            }
        } else if (state.action === 'awaiting_image_for_ocr') {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const fileLink = await bot.getFileLink(photoId);
            const imagePath = path.join(tempDir, `ocr_image_${chatId}_${Date.now()}.jpg`);
            
            try {
                const processingMessage = await bot.sendMessage(chatId, "Processing image for OCR... This might take a moment.");

                const result = await Tesseract.recognize(
                    imagePath,
                    'eng', // English language. Could be extended to support other languages.
                    {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                const progress = Math.floor(m.progress * 100);
                                bot.editMessageText(
                                    `Recognizing text in image... ${progress}%`,
                                    { chat_id: chatId, message_id: processingMessage.message_id }
                                ).catch(() => {}); // Ignore errors if message is not modified
                            }
                        }
                    }
                );
                const extractedText = result.data.text.trim();

                if (extractedText) {
                    bot.editMessageText(`*Extracted Text:*\n\`\`\`\n${extractedText}\n\`\`\``, { chat_id: chatId, message_id: processingMessage.message_id, parse_mode: 'Markdown' });
                } else {
                    bot.editMessageText("No text found in the image or text is illegible.", { chat_id: chatId, message_id: processingMessage.message_id });
                }

            } catch (err) {
                console.error("Error during OCR:", err);
                bot.sendMessage(chatId, "Sorry, I encountered an error while processing the image for OCR.");
            } finally {
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                await userRef.delete(); // Reset state
            }
        }
    });

    bot.on('document', async (msg) => {
        const chatId = msg.chat.id;
        const userRef = db.collection('user_states').doc(String(chatId));
        const userDoc = await userRef.get();

        if (!userDoc.exists) return;
        const state = userDoc.data();

        if (state.action === 'awaiting_file_for_upload') {
            await userRef.set({
                file_id: msg.document.file_id,
                file_name: msg.document.file_name,
                action: 'awaiting_upload_details'
            }, { merge: true });
            bot.sendMessage(chatId, "File received. Now, please provide the destination repository, branch, and full path for the file in this exact format:\n`owner/repo branch path/to/your/file.ext`");
        } else if (state.action === 'awaiting_json_for_csv') {
            if (!msg.document.file_name.endsWith('.json')) {
                bot.sendMessage(chatId, "Please send a valid JSON file ending with `.json`.");
                return;
            }
            await userRef.delete();
            try {
                const fileLink = await bot.getFileLink(msg.document.file_id);
                const jsonBuffer = await downloadFile(fileLink);
                const jsonData = JSON.parse(jsonBuffer.toString());

                const parser = new Parser();
                const csvData = parser.parse(jsonData);

                const csvPath = path.join(tempDir, `${path.parse(msg.document.file_name).name}.csv`);
                fs.writeFileSync(csvPath, csvData);

                bot.sendDocument(chatId, csvPath).then(() => {
                    fs.unlinkSync(csvPath);
                    bot.sendMessage(chatId, "JSON converted to CSV successfully!");
                });
            } catch (error) {
                bot.sendMessage(chatId, "Sorry, I couldn't convert that JSON to CSV. Make sure it's a valid JSON file.");
                console.error("Error converting JSON to CSV:", error);
            }
        } else if (state.action === 'awaiting_csv_for_json') {
            if (!msg.document.file_name.endsWith('.csv')) {
                bot.sendMessage(chatId, "Please send a valid CSV file ending with `.csv`.");
                return;
            }
            await userRef.delete();
            try {
                const fileLink = await bot.getFileLink(msg.document.file_id);
                const csvPath = path.join(tempDir, `csv_${chatId}_${Date.now()}.csv`);
                const csvBuffer = await downloadFile(fileLink);
                fs.writeFileSync(csvPath, csvBuffer);

                const results = [];
                fs.createReadStream(csvPath)
                    .pipe(csv())
                    .on('data', (data) => results.push(data))
                    .on('end', () => {
                        const jsonPath = path.join(tempDir, `${path.parse(msg.document.file_name).name}.json`);
                        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

                        bot.sendDocument(chatId, jsonPath).then(() => {
                            fs.unlinkSync(csvPath);
                            fs.unlinkSync(jsonPath);
                            bot.sendMessage(chatId, "CSV converted to JSON successfully!");
                        });
                    });
            } catch (error) {
                bot.sendMessage(chatId, "Sorry, I couldn't convert that CSV to JSON. Make sure it's a valid CSV file.");
                console.error("Error converting CSV to JSON:", error);
            }
        } else if (state.action === 'awaiting_file_for_hashing') {
            await userRef.set({
                file_id: msg.document.file_id,
                action: 'awaiting_hash_algorithm_for_file'
            }, { merge: true });
            bot.sendMessage(chatId, "File received. Now, please send the hashing algorithm (e.g., `md5`, `sha1`, `sha256`, `sha512`).");
        } else if (state.action === 'awaiting_temp_file') {
            await userRef.delete();
            const fileId = msg.document.file_id;
            const fileName = msg.document.file_name;
            const expiryMinutes = 60; // Default expiry for files

            const tempId = Math.random().toString(36).substring(2, 10);
            const expiryTime = Date.now() + expiryMinutes * 60 * 1000;

            await db.collection('temp_storage').doc(tempId).set({
                type: 'file',
                fileId: fileId,
                fileName: fileName,
                expiry: expiryTime,
                chatId: chatId,
            });

            bot.sendMessage(chatId, `Your file has been stored temporarily! Use \`/gettemp ${tempId}\` to retrieve it. It will expire in ${expiryMinutes} minutes.`);
        } else {
            // If action is not awaiting_file_for_upload, delete the state if it's not a known action
            if (state.action) {
                bot.sendMessage(chatId, "I'm not sure what to do with this document. Please select an option from the /start menu.");
                await userRef.delete();
            }
        }
    });

    bot.on('audio', async (msg) => {
        const chatId = msg.chat.id;
        const userRef = db.collection('user_states').doc(String(chatId));
        const userDoc = await userRef.get();

        if (!userDoc.exists) return;
        const state = userDoc.data();

        if (state.action === 'awaiting_audio_for_conversion') {
            await userRef.set({
                file_id: msg.audio.file_id,
                file_name: msg.audio.file_name || `audio_${chatId}_${Date.now()}.ogg`,
                action: 'awaiting_target_audio_format'
            }, { merge: true });
            bot.sendMessage(chatId, "Audio file received. Now, please send me the target format (e.g., `mp3`, `wav`, `ogg`).");
        }
    });

    bot.on('video', async (msg) => {
        const chatId = msg.chat.id;
        const userRef = db.collection('user_states').doc(String(chatId));
        const userDoc = await userRef.get();

        if (!userDoc.exists) return;
        const state = userDoc.data();

        if (state.action === 'awaiting_video_for_images') {
            const frameCount = state.frameCount || 10; // Default to 10 if not set
            await userRef.delete(); // Reset state

            bot.sendMessage(chatId, "Downloading and processing video... This may take a moment.");

            const videoId = msg.video.file_id;
            const fileLink = await bot.getFileLink(videoId);

            const videoPath = path.join(tempDir, `video_${chatId}_${Date.now()}`);
            const outputDir = path.join(tempDir, `frames_${chatId}_${Date.now()}`);
            fs.mkdirSync(outputDir, { recursive: true });

            try {
                const videoBuffer = await downloadFile(fileLink);
                fs.writeFileSync(videoPath, videoBuffer);

                ffmpeg(videoPath)
                    .on('end', () => {
                        bot.sendMessage(chatId, "Processing complete. Compressing frames into a ZIP file...");
                        const zipPath = path.join(tempDir, `frames_${chatId}_${Date.now()}.zip`);
                        const output = fs.createWriteStream(zipPath);
                        const archive = archiver('zip', {
                            zlib: { level: 9 } // Sets the compression level.
                        });

                        output.on('close', () => {
                            bot.sendDocument(chatId, zipPath).then(() => {
                                // Clean up all temporary files
                                fs.unlinkSync(videoPath);
                                fs.readdirSync(outputDir).forEach(file => fs.unlinkSync(path.join(outputDir, file)));
                                fs.rmdirSync(outputDir);
                                fs.unlinkSync(zipPath);
                                bot.sendMessage(chatId, "Video conversion complete! Send /start to convert more.");
                            });
                        });

                        archive.on('error', (err) => {
                            throw err;
                        });

                        archive.pipe(output);
                        archive.directory(outputDir, false);
                        archive.finalize();
                    })
                    .on('error', (err) => {
                        console.error('Error during ffmpeg processing:', err);
                        bot.sendMessage(chatId, 'Sorry, there was an error processing your video.');
                        // Clean up
                        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                        if (fs.existsSync(outputDir)) fs.rmdirSync(outputDir, { recursive: true });
                    })
                    .screenshots({
                        count: frameCount,
                        folder: outputDir,
                        filename: 'frame-%s.png'
                    });

            } catch (err) {
                console.error("Error processing video:", err);
                bot.sendMessage(chatId, "I'm sorry, I had trouble processing that video.");
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                if (fs.existsSync(outputDir)) fs.rmdirSync(outputDir, { recursive: true });
            }
        } else if (state.action === 'awaiting_video_for_conversion') {
            await userRef.set({
                file_id: msg.video.file_id,
                file_name: msg.video.file_name || `video_${chatId}_${Date.now()}.mp4`, // Default to mp4
                action: 'awaiting_target_video_format'
            }, { merge: true });
            bot.sendMessage(chatId, "Video file received. Now, please send me the target format (e.g., `mp4`, `avi`, `mov`).");
        } else if (state.action === 'awaiting_video_for_audio_extraction') {
            await userRef.delete(); // Reset state
            bot.sendMessage(chatId, "Extracting audio from video... This may take a moment.");

            const videoId = msg.video.file_id;
            const fileLink = await bot.getFileLink(videoId);

            const videoPath = path.join(tempDir, `video_extract_audio_${chatId}_${Date.now()}.mp4`);
            const audioPath = path.join(tempDir, `extracted_audio_${chatId}_${Date.now()}.mp3`); // Default to mp3

            try {
                const videoBuffer = await downloadFile(fileLink);
                fs.writeFileSync(videoPath, videoBuffer);

                ffmpeg(videoPath)
                    .noVideo() // Extract only audio
                    .output(audioPath)
                    .on('end', () => {
                        bot.sendAudio(chatId, audioPath).then(() => {
                            fs.unlinkSync(videoPath);
                            fs.unlinkSync(audioPath);
                            bot.sendMessage(chatId, "Audio extracted successfully! Send /start to convert more.");
                        });
                    })
                    .on('error', (err) => {
                        console.error('Error during audio extraction:', err);
                        bot.sendMessage(chatId, 'Sorry, there was an error extracting audio from your video.');
                        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
                    })
                    .run();
            } catch (err) {
                console.error("Error processing video for audio extraction:", err);
                bot.sendMessage(chatId, "I'm sorry, I had trouble processing that video for audio extraction.");
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            }
        } else {
            // If action is not known, delete the state
            if (state.action) {
                bot.sendMessage(chatId, "I'm not sure what to do with this video. Please select an option from the /start menu.");
                await userRef.delete();
            }
        }
    });

    bot.on('text', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        const userRef = db.collection('user_states').doc(String(chatId));
        const userDoc = await userRef.get();

        if (text.startsWith('/')) return;
        
        const state = userDoc.exists ? userDoc.data() : {};

        if (state.action === 'awaiting_text_for_translation') {
            await userRef.delete();
            const parts = text.split('|');
            if (parts.length !== 2) {
                bot.sendMessage(chatId, "Invalid format. Please use `text | language_code` (e.g., `Hello | es`).");
                return;
            }
            const [textToTranslate, targetLang] = parts.map(p => p.trim());
            
            bot.sendMessage(chatId, `Translating to ${targetLang}...`);
            const translatedText = await translateText(textToTranslate, targetLang);

            if (translatedText) {
                bot.sendMessage(chatId, `*Translated Text:*\n${translatedText}`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "Sorry, I couldn't translate that text. Please check the language code and try again.");
            }
        } else if (state.action === 'awaiting_password_options') {
            await userRef.delete();
            bot.deleteMessage(chatId, msg.message_id);

            const args = text.split(' ');
            const length = parseInt(args[0], 10);
            const options = args[1] || 'ulns';

            if (isNaN(length) || length <= 0) {
                bot.sendMessage(chatId, "Invalid length. Please provide a positive number.");
                return;
            }
            
            if (length > 1024) {
                bot.sendMessage(chatId, "Password length cannot exceed 1024 characters.");
                return;
            }

            const password = generatePassword(length, options);

            if (!password) {
                bot.sendMessage(chatId, "Invalid options. Please select at least one character type: u, l, n, s.");
                return;
            }

            const warningMessage = "⚠️ Here is your generated password. This message will be deleted in 30 seconds for your security. Please copy it and store it in a safe place. The bot will not save it.";
            
            bot.sendMessage(chatId, warningMessage).then(() => {
                bot.sendMessage(chatId, `\`\`\`\n${password}\n\`\`\``, { parse_mode: 'Markdown' })
                    .then((sentMessage) => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sentMessage.message_id).catch(err => console.error("Error deleting password message:", err));
                        }, 30000);
                    });
            });
        } else if (state.action === 'awaiting_frame_count') {
            const frameCount = parseInt(text, 10);
            if (isNaN(frameCount) || frameCount <= 0) {
                bot.sendMessage(chatId, "Please provide a valid number greater than 0.");
                return;
            }
            await userRef.set({ 
                frameCount: frameCount,
                action: 'awaiting_video_for_images' 
            }, { merge: true });
            bot.sendMessage(chatId, `Okay, I will extract ${frameCount} frames. Please send me the video.`);
        } else if (state.action === 'awaiting_text_for_pdf') {
            await userRef.delete();
            const doc = new PDFDocument();
            const filePath = path.join(tempDir, `output_${chatId}_${Date.now()}.pdf`);
            const stream = fs.createWriteStream(filePath);

            doc.pipe(stream);
            doc.fontSize(12).text(text, { align: 'left' });
            doc.end();

            stream.on('finish', () => {
                bot.sendDocument(chatId, filePath).then(() => {
                    fs.unlinkSync(filePath);
                    bot.sendMessage(chatId, "Text converted to PDF successfully! Send /start to convert more.");
                }).catch(error => {
                    console.error("Error sending document:", error);
                    bot.sendMessage(chatId, "There was an error sending your PDF.");
                });
            });
        } else if (state.action === 'awaiting_text_for_csv') {
            await userRef.delete();
            try {
                const csvPath = path.join(tempDir, `text_${chatId}_${Date.now()}.csv`);
                fs.writeFileSync(csvPath, text);
                bot.sendDocument(chatId, csvPath).then(() => {
                    fs.unlinkSync(csvPath);
                    bot.sendMessage(chatId, "Text converted to CSV successfully!");
                });
            } catch (error) {
                bot.sendMessage(chatId, "Sorry, I couldn't convert that text to CSV.");
                console.error("Error converting text to CSV:", error);
            }
        } else if (state.action === 'awaiting_images_for_pdf' && text.toLowerCase() === 'done') {
            if (!state.images || state.images.length === 0) {
                bot.sendMessage(chatId, "You haven't sent any images yet. Please send some images first.");
                return;
            }

            const doc = new PDFDocument();
            const pdfPath = path.join(tempDir, `combined_${chatId}_${Date.now()}.pdf`);
            const stream = fs.createWriteStream(pdfPath);
            doc.pipe(stream);

            for (let i = 0; i < state.images.length; i++) {
                const imagePath = state.images[i];
                const image = await Jimp.read(imagePath);
                doc.addPage({ size: [image.bitmap.width, image.bitmap.height] });
                doc.image(imagePath, 0, 0, {
                    width: image.bitmap.width,
                    height: image.bitmap.height
                });
            }
            doc.end();

            stream.on('finish', () => {
                bot.sendDocument(chatId, pdfPath).then(async () => {
                    state.images.forEach(imagePath => fs.unlinkSync(imagePath));
                    fs.unlinkSync(pdfPath);
                    await userRef.delete();
                    bot.sendMessage(chatId, "Images combined into PDF successfully! Send /start to convert more.");
                }).catch(error => {
                    console.error("Error sending document:", error);
                    bot.sendMessage(chatId, "There was an error sending your PDF.");
                });
            });
        } else if (state.action === 'awaiting_url_for_screenshot') {
            // ... [rest of the screenshot code]
        }
    });
}

module.exports = {
    registerMessageHandlers,
};
