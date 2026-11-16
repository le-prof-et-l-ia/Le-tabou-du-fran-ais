import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Model fallback cascade: 3.8 Flash -> 3.7 Flash -> 3.6 Flash -> 3.5 Flash
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

/**
 * Checks if the error returned by the server is a connection refusal specifically
 * due to server overload/saturation or quota/rate limit exhaustion.
 */
function isOverloadOrSaturationError(error: any): boolean {
  if (!error) return false;

  const status = error?.status ?? error?.code ?? error?.error?.code ?? error?.response?.status;
  const statusStr = String(error?.status || '').toUpperCase();
  const errorJson = typeof error === 'object' ? JSON.stringify(error).toLowerCase() : '';
  const message = (error?.message || error?.error?.message || String(error)).toLowerCase();

  // Status codes 503 (Unavailable), 429 (Too Many Requests / Quota), 529 (Site Overloaded)
  if (
    status === 503 ||
    status === 429 ||
    status === 529 ||
    statusStr === 'UNAVAILABLE' ||
    statusStr === 'RESOURCE_EXHAUSTED'
  ) {
    return true;
  }

  // Keywords indicating overload, saturation or high demand refusal
  const overloadKeywords = [
    'high demand',
    'experiencing high demand',
    'spikes in demand',
    'overload',
    'overloaded',
    'surcharge',
    'saturation',
    'saturé',
    'unavailable',
    'resource_exhausted',
    'quota',
    'rate limit',
    'rate-limit',
    'temporarily unavailable',
    'server is busy',
    'try again later',
    'too many requests',
  ];

  return overloadKeywords.some(keyword => message.includes(keyword) || errorJson.includes(keyword));
}

/**
 * Wraps a promise with a maximum timeout (default 20 seconds).
 * Rejects with a custom timeout flag if the server does not respond within the timeframe.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs = 20000): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(`Absence de réaction du serveur de plus de ${timeoutMs / 1000} secondes.`);
      err.isTimeout = true;
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
}

// Initialize Gemini
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

app.post('/api/generate-taboo-batch', async (req, res) => {
  const { targetWords, level, apiKeys } = req.body;

  if (!targetWords || !Array.isArray(targetWords) || !level) {
    return res.status(400).json({ error: "Missing targetWords array or level." });
  }

  // Build key candidates list from request + fallback environment variable
  const candidateKeys: string[] = [];
  if (Array.isArray(apiKeys)) {
    for (const k of apiKeys) {
      if (typeof k === 'string' && k.trim().length > 0 && !candidateKeys.includes(k.trim())) {
        candidateKeys.push(k.trim());
      }
    }
  }
  if (process.env.GEMINI_API_KEY && !candidateKeys.includes(process.env.GEMINI_API_KEY)) {
    candidateKeys.push(process.env.GEMINI_API_KEY);
  }

  if (candidateKeys.length === 0) {
    return res.status(500).json({ error: "Aucune clé API Gemini fournie ni configurée sur le serveur." });
  }

  const systemInstruction = `Tu es un professeur de français langue étrangère (FLE). 
Ta tâche est de créer des cartes pour le jeu "Taboo".
Le niveau visé des apprenants est : ${level}.`;

  const prompt = `Pour chaque mot cible fourni, génère exactement 5 mots ou courtes expressions "tabous" (les mots les plus évidents associés) que le joueur n'a PAS le droit de prononcer pour le faire deviner.
Mots cibles : ${targetWords.join(', ')}

Assure-toi que les mots tabous sont adaptés au niveau ${level}.`;

  let lastError: any = null;

  for (let i = 0; i < candidateKeys.length; i++) {
    const apiKey = candidateKeys[i];
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    // Cascade models: 3.8 Flash -> 3.7 Flash -> 3.6 Flash -> 3.5 Flash
    // Only fall back if the server refuses for overload/saturation or times out > 20s.
    for (let m = 0; m < MODEL_FALLBACK_CHAIN.length; m++) {
      const currentModel = MODEL_FALLBACK_CHAIN[m];
      try {
        console.log(`[Gemini API] Tentative avec ${currentModel} (clé #${i + 1}/${candidateKeys.length})...`);

        const response = await withTimeout(
          ai.models.generateContent({
            model: currentModel,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  cards: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        targetWord: { type: Type.STRING },
                        tabooWords: { 
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                          description: "Exactement 5 mots tabous"
                        }
                      },
                      required: ["targetWord", "tabooWords"]
                    }
                  }
                },
                required: ["cards"]
              }
            }
          }),
          20000 // 20 seconds timeout constraint
        );

        if (response.text) {
          const data = JSON.parse(response.text.trim());
          console.log(`[Gemini API] Succès obtenu avec le modèle ${currentModel} (clé #${i + 1}).`);
          return res.json({ ...data, usedModel: currentModel });
        } else {
          throw new Error("Réponse vide de Gemini.");
        }
      } catch (error: any) {
        lastError = error;
        const isTimeout = !!error?.isTimeout;
        const isOverload = isOverloadOrSaturationError(error);
        const errorMsg = error?.message || String(error);

        if (isTimeout || isOverload) {
          const reason = isTimeout
            ? "absence de réaction du serveur (> 20 secondes)"
            : "refus du serveur pour cause de surcharge/saturation";

          console.warn(`[Gemini API] ${currentModel} indisponible (${reason}): ${errorMsg}`);

          if (m < MODEL_FALLBACK_CHAIN.length - 1) {
            const nextModel = MODEL_FALLBACK_CHAIN[m + 1];
            console.log(`[Gemini API] Bascule automatique vers ${nextModel}...`);
            continue; // Try next model in the fallback chain
          } else {
            console.warn(`[Gemini API] Tous les modèles de secours (3.8 -> 3.7 -> 3.6 -> 3.5) ont rencontré une surcharge ou un délai dépassé pour la clé #${i + 1}.`);
            break;
          }
        } else {
          // Non-overload and non-timeout error (e.g. invalid API key or bad request)
          // Do not fall back to other models for this key.
          console.warn(`[Gemini API] Erreur non liée à la surcharge ou au délai sur ${currentModel} (clé #${i + 1}): ${errorMsg}`);
          break;
        }
      }
    }

    if (i < candidateKeys.length - 1) {
      console.log(`[Gemini API] Rotation automatique vers la clé candidate suivante #${i + 2}...`);
    }
  }

  console.error("Gemini API Error (Toutes les tentatives et modèles ont échoué):", lastError);
  return res.status(500).json({
    error: "Échec de génération avec les modèles et clés API.",
    details: lastError?.message || String(lastError)
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
