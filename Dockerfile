# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install any needed packages
RUN npm install --production

# Pre-download Tesseract language data to speed up initialization at runtime.
COPY download-tessdata.js .
RUN node download-tessdata.js
RUN rm download-tessdata.js

# Bundle app source
COPY . .

# Your app binds to port 3000, so you need to expose it
EXPOSE 3000

# Define the command to run your app
CMD [ "npm", "start" ]
