const express = require('express');
const multer = require('multer');
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
};

// Store chat sessions
const chatSessions = new Map();

app.get('/gemini', async (req, res) => {
  try {
    const { prompt, uid } = req.query;
    
    if (!prompt || !uid) {
      return res.status(400).json({ error: 'Missing prompt or uid' });
    }

    // Get or create chat session for this user
    let chatSession = chatSessions.get(uid);
    if (!chatSession) {
      chatSession = model.startChat({ generationConfig });
      chatSessions.set(uid, chatSession);
    }

    const result = await chatSession.sendMessage(prompt);
    res.json({ response: result.response.text() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/gemini', upload.single('img_pdf'), async (req, res) => {
  try {
    const { prompt, uid } = req.query;
    const file = req.file;

    if (!prompt || !uid || !file) {
      return res.status(400).json({ error: 'Missing prompt, uid, or file' });
    }

    // Determine mime type
    const mimeType = file.mimetype;
    
    // Upload file to Gemini
    const uploadedFile = await uploadToGemini(file.path, mimeType);
    await waitForFilesActive([uploadedFile]);

    // Get or create chat session
    let chatSession = chatSessions.get(uid);
    if (!chatSession) {
      chatSession = model.startChat({ generationConfig });
      chatSessions.set(uid, chatSession);
    }

    // Send message with file
    const result = await chatSession.sendMessage([
      {
        fileData: {
          mimeType: uploadedFile.mimeType,
          fileUri: uploadedFile.uri,
        },
      },
      { text: prompt },
    ]);

    res.json({ response: result.response.text() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions for file handling
async function uploadToGemini(path, mimeType) {
  const uploadResult = await fileManager.uploadFile(path, {
    mimeType,
    displayName: path,
  });
  return uploadResult.file;
}

async function waitForFilesActive(files) {
  for (const name of files.map((file) => file.name)) {
    let file = await fileManager.getFile(name);
    while (file.state === "PROCESSING") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await fileManager.getFile(name);
    }
    if (file.state !== "ACTIVE") {
      throw Error(`File ${file.name} failed to process`);
    }
  }
}

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
