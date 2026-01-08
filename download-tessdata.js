const https = require('https');
const fs = require('fs');
const path = require('path');

const lang = 'eng';
const tessdataDir = 'tessdata';
const tessdataPath = path.join(__dirname, tessdataDir);
const outputPath = path.join(tessdataPath, `${lang}.traineddata`);

// This is the official source for Tesseract v5 data files used by tesseract.js v5+
const url = `https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata`;

console.log(`Ensuring directory exists at ${tessdataPath}...`);
if (!fs.existsSync(tessdataPath)) {
  fs.mkdirSync(tessdataPath, { recursive: true });
}

console.log(`Starting download of ${lang}.traineddata from ${url}`);

const file = fs.createWriteStream(outputPath);

const request = https.get(url, (response) => {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    console.error(`Failed to download language data. Status Code: ${response.statusCode}`);
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`Redirected to: ${response.headers.location}`);
    }
    request.destroy();
    fs.unlink(outputPath, () => process.exit(1)); // Clean up and exit on failure
    return;
  }

  response.pipe(file);

  file.on('finish', () => {
    file.close((err) => {
      if (err) {
        console.error('Error closing the file stream:', err.message);
        process.exit(1);
      } else {
        console.log(`Successfully downloaded and saved to ${outputPath}`);
        process.exit(0);
      }
    });
  });
}).on('error', (err) => {
  console.error(`Error downloading ${lang}.traineddata: ${err.message}`);
  fs.unlink(outputPath, () => process.exit(1)); // Clean up and exit on failure
});
