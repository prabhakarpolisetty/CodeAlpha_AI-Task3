import { GoogleGenAI, Type } from "@google/genai";
import { MusicStyle, Note } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateComposition(style: MusicStyle, prompt?: string): Promise<{ notes: Note[], tempo: number }> {
  const systemInstruction = `You are a professional music composer and MIDI orchestrator. 
  Your task is to generate a sequence of musical notes in a JSON format that can be played by Tone.js.
  
  Styles:
  - Classical: Orchestral, structured, uses counterpoint and complex harmonies.
  - Jazz: Swing feel (represented by 8n. + 16n pairs), blue notes, 7th chords.
  - Cyberpunk: Dark, aggressive synthesis, minor keys, syncopated rhythms.
  - Lo-Fi: Relaxed, slightly out of tune feel. Use the 'detune' field to add subtle pitch instability (e.g., -20 to 20 cents).

  Note Format:
  - pitch: Scientific pitch notation (e.g., "C4", "G#3").
  - duration: Tone.js durations like "4n", "8n", "2n", "16n".
  - time: The point in the transport when the note starts. Use bar:beat:subbeat format (e.g., "0:0:0", "0:1:2").
  - velocity: 0.1 to 1.0.
  - detune: -100 to 100 (in cents). Use for flavor, especially in Lo-Fi.

  Generate about 24-48 notes for a short sequence (4-8 bars).
  Return ONLY valid JSON.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a ${style} composition sequence. ${prompt ? `Context: ${prompt}` : ""}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tempo: { type: Type.NUMBER, description: "Recommended tempo in BPM" },
            notes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pitch: { type: Type.STRING },
                  duration: { type: Type.STRING },
                  time: { type: Type.STRING },
                  velocity: { type: Type.NUMBER },
                  detune: { type: Type.NUMBER, description: "Cents to shift pitch (-100 to 100)" }
                },
                required: ["pitch", "duration", "time", "velocity"]
              }
            }
          },
          required: ["tempo", "notes"]
        }
      }
    });

    const result = JSON.parse(response.text);
    return result;
  } catch (error) {
    console.error("Gemini Music Gen Error:", error);
    throw error;
  }
}
