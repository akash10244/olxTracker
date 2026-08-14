import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const schema = {
  type: Type.OBJECT,
  properties: {
    extracted_specs: {
      type: Type.OBJECT,
      properties: {
        gpu: { type: Type.OBJECT, properties: { value: { type: Type.STRING, nullable: true }, evidence: { type: Type.STRING, nullable: true } } },
        cpu: { type: Type.OBJECT, properties: { value: { type: Type.STRING, nullable: true }, evidence: { type: Type.STRING, nullable: true } } },
        ram: { type: Type.OBJECT, properties: { value: { type: Type.STRING, nullable: true }, evidence: { type: Type.STRING, nullable: true } } },
        storage: { type: Type.OBJECT, properties: { value: { type: Type.STRING, nullable: true }, evidence: { type: Type.STRING, nullable: true } } },
        condition: { type: Type.OBJECT, properties: { value: { type: Type.STRING, nullable: true }, evidence: { type: Type.STRING, nullable: true } } },
        age_months: { type: Type.OBJECT, properties: { value: { type: Type.INTEGER, nullable: true }, evidence: { type: Type.STRING, nullable: true } } },
        warranty: { type: Type.OBJECT, properties: { value: { type: Type.STRING, nullable: true }, evidence: { type: Type.STRING, nullable: true } } }
      }
    },
    specs_confidence: { type: Type.NUMBER, description: "0-1" },
    description_quality: { type: Type.STRING, enum: ["detailed", "moderate", "lazy"] },
    deal_tier: { type: Type.STRING, enum: ["steal", "good", "okay", "bad"] },
    deal_confidence: { type: Type.NUMBER, description: "0-1" },
    deal_reason: { type: Type.STRING, description: "short plain-language justification (1-2 sentences)" },
    scam_risk: { type: Type.STRING, enum: ["low", "medium", "high"] },
    scam_reasons: { type: Type.ARRAY, items: { type: Type.STRING }, description: "array of short strings, empty if low" },
    short_summary: { type: Type.STRING, description: "A punchy 1-2 line summary of your thoughts on this product and deal." },
    detailed_summary: { type: Type.STRING, description: "A larger detailed paragraph explaining your exact thought process, pricing analysis, and component breakdown." }
  },
  required: ["extracted_specs", "specs_confidence", "description_quality", "deal_tier", "deal_confidence", "deal_reason", "scam_risk", "scam_reasons", "short_summary", "detailed_summary"]
};

export async function evaluateListing(listing, fullDescription, activeListingsContext, constraints) {
  if (!process.env.GEMINI_API_KEY) {
    console.error("[AI] GEMINI_API_KEY is missing. Skipping AI evaluation.");
    return null;
  }

  const systemInstruction = `You are a strict, literal information-extraction and classification
assistant for secondhand gaming PC listings from OLX India. You are
NOT permitted to guess, infer, or assume any specification that is
not explicitly written in the listing text provided to you. This
matters: real purchase decisions get made from your output, and an
invented spec is worse than no spec at all.

Rules:
1. Extract only what is explicitly stated. If a spec (GPU, CPU, RAM,
   storage, PSU, case, monitor included, warranty, age/usage) is not
   explicitly mentioned in the title or description, its value must
   be null. Never substitute a "typical" or "likely" value.
2. For every non-null spec you extract, include the exact short
   phrase from the listing text that supports it, in that field's
   "evidence" property. If you cannot point to specific supporting
   text, output null instead of a guess.
3. Judge fair value ONLY against the comparable listings explicitly
   provided in this prompt's context. Do not draw on general
   knowledge of GPU/CPU market prices — you do not reliably know
   current secondhand pricing in this specific city and currency,
   and prices move quickly.
4. If the description is short, generic, or lacks concrete detail,
   set description_quality to "lazy" and lower specs_confidence and
   deal_confidence accordingly. Do not compensate for a thin
   description by filling in assumed details.
5. If uncertain between two classifications, prefer the more
   conservative one (lower deal tier, lower confidence) rather than
   an optimistic guess. A missed good deal costs nothing; a false
   "steal" alert wastes the user's trust and time.
6. Output ONLY the JSON object matching the provided schema. No
   preamble, no markdown, no explanation outside the schema fields.

${constraints ? `7. USER CONSTRAINTS (CRITICAL): The user has specified the following minimum requirements for a PC to be considered a deal: "${constraints}". If the listing does NOT clearly meet these requirements (or if a crucial component like a dedicated GPU is entirely missing), you MUST strictly classify the deal_tier as "bad".` : ''}`;

  const contextStr = activeListingsContext.length > 0 
    ? activeListingsContext.map(l => `- Title: ${l.title} | Price: ${l.price} | Specs: ${JSON.stringify(l.extracted_specs || {})}`).join('\n')
    : "No active comparable listings available yet.";

  const prompt = `Evaluate the following listing.
  
Title: ${listing.title}
Price: ${listing.price} INR
Location: ${listing.location || 'Unknown'}

Full Description:
${fullDescription || "None provided"}

---
Context (Other active local listings for comparison):
${contextStr}

Reminder: null is the correct answer for anything not explicitly stated — do not guess.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: schema,
      }
    });

    const outputText = response.text;
    const json = JSON.parse(outputText);

    // Apply PRD cap: if confidence is low, cap at 'good'
    if (json.deal_tier === 'steal' && (json.deal_confidence < 0.7 || json.specs_confidence < 0.7 || json.description_quality === 'lazy')) {
      json.deal_tier = 'good';
      json.deal_reason += ' (Downgraded from steal due to low confidence or lazy description)';
    }

    return json;
  } catch (err) {
    console.error(`[AI] Error evaluating ad ${listing.ad_id}:`, err);
    return null;
  }
}
