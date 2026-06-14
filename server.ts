import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // AI Track Suggestion Engine
  app.post("/api/suggestions", async (req, res) => {
    const { currentTrack, history, crowdFeedback } = req.body;
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Given the currently playing track: "${currentTrack || 'Unknown'}", and recent history: "${history || 'None'}", suggest 5 next tracks. Crowd mood: "${crowdFeedback || 'Normal'}". Provide artist, title, estimated BPM, and a short mixing tip for each.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                artist: { type: Type.STRING },
                bpm: { type: Type.NUMBER },
                mixingTip: { type: Type.STRING }
              },
              required: ["title", "artist", "bpm", "mixingTip"]
            }
          }
        }
      });

      res.json(JSON.parse(response.text));
    } catch (error) {
      console.error("Gemini Error:", error);
      res.status(500).json({ error: "Failed to fetch suggestions" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BAD N3WS RIDDIM DJ server running on http://localhost:${PORT}`);
  });
}

startServer();
