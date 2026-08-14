import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
ai.models.list().then(async (response) => {
  for await (const model of response) {
    console.log(model.name);
  }
}).catch(console.error);
