# Oladizz Bot (Telegram)

This is a versatile Telegram bot that provides a variety of file conversion and utility tools.

## Features

The bot currently supports the following features:

### File Conversions
- **Text to PDF**: Converts any text message into a PDF document.
- **Image to PDF**: Converts a single image into a PDF document.
- **Combine Images to PDF**: Combines multiple images into a single PDF document.
- **Convert Image Format**: Converts images between JPG, PNG, and BMP formats.
- **Convert to Sticker**: Converts an image to a Telegram sticker-compatible format (WEBP).
- **Convert Video to Images**: Extracts a specified number of frames from a video and sends them as a ZIP archive.
- **Convert Audio Format**: Converts audio files to different formats like MP3, WAV, or OGG.
- **Convert Video Format**: Converts videos to different formats like MP4, AVI, or MOV.
- **Extract Audio from Video**: Extracts the audio track from a video file and sends it as an MP3 file.

### Utilities
- **Generate QR Code**: Creates a QR code from a given text or URL.
- **URL Shortener**: Shortens a given URL.
- **/cancel command**: Cancels any ongoing operation with the bot.

### GitHub Integration
- **Set GitHub Token**: Securely saves your GitHub Personal Access Token for the session.
- **Get Repo Info**: Fetches and displays information about a public or private repository.
- **Create Repository**: Creates a new repository on your GitHub account.
- **Upload File**: Uploads a file to a specified repository.
- **List Branches**: Lists all branches for a given repository.
- **List Commits**: Lists the most recent commits on a specific branch.
- **Create Issue**: Creates a new issue in a repository.
- **Search Repositories**: Searches for repositories on GitHub.

## Setup and Running Locally

### Prerequisites
- Node.js (v14 or higher recommended)
- npm

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd Oladizz-bot-telegram
   ```
2. Enable the Cloud Firestore API for your Google Cloud project:
   [https://console.developers.google.com/apis/api/firestore.googleapis.com/overview](https://console.developers.google.com/apis/api/firestore.googleapis.com/overview)
   (Ensure you select the correct project if prompted).

3. Install the dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root of the project and add your Telegram Bot Token:
   ```
   TELEGRAM_BOT_TOKEN=<your_telegram_bot_token>
   ```
4. Make sure you have `ffmpeg` installed on your system for video and audio processing features.

### Running the Bot
To start the bot, run the following command:
```bash
npm start
```

## Environment Variables

- `TELEGRAM_BOT_TOKEN`: The token for your Telegram bot from BotFather.
- `GITHUB_PAT`: (Optional) Your GitHub Personal Access Token, which can also be set via the bot's interface.

---
Built by Oladizz.
