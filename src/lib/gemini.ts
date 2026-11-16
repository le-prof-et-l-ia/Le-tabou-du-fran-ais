import { GoogleGenAI, Type } from '@google/genai';
import { Level, QuestionData } from '../types';

// Cascade de modèles : on ne passe au suivant qu'en cas de surcharge ou de délai dépassé.
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

const TIMEOUT_MS = 20000;

function isOverloadOrSaturationError(error: any): boolean {
  if (!error) return false;
  const status = error?.status ?? error?.code ?? error?.error?.code ?? error?.response?.status;
  const statusStr = String(error?.status || '').toUpperCase();
  if (
    status === 503 || status === 429 || status === 529 ||
    statusStr === 'UNAVAILABLE' || statusStr === 'RESOURCE_EXHAUSTED'
  ) {
    return true;
  }
  const message = (error?.message || error?.error?.message || String(error)).toLowerCase();
  return [
    'high demand', 'overload', 'unavailable', 'resource_exhausted', 'quota',
    'rate limit', 'rate-limit', 'try again later', 'too many requests', 'server is busy',
  ].some((k) => message.includes(k));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(`Pas de réponse du serveur depuis plus de ${timeoutMs / 1000} secondes.`);
      err.isTimeout = true;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

/**
 * Génère des cartes directement depuis le navigateur avec la ou les clés de l'enseignant.
 * Les clés ne quittent le navigateur que pour être envoyées à Google.
 */
export async function generateTabooBatch(
  targetWords: string[],
  level: Level,
  apiKeys: string[],
): Promise<QuestionData[]> {
  const keys = [...new Set(apiKeys.map((k) => k.trim()).filter(Boolean))];
  if (keys.length === 0) {
    throw new Error('Aucune clé API Gemini renseignée.');
  }

  const systemInstruction = `Tu es un professeur de français langue étrangère (FLE).
Ta tâche est de créer des cartes pour le jeu « Tabou ».
Le niveau visé des apprenants est : ${level}.`;

  const prompt = `Pour chaque mot cible fourni, génère exactement 5 mots ou courtes expressions « tabous » (les mots les plus évidents associés) que le joueur n'a PAS le droit de prononcer pour le faire deviner.
Les mots tabous ne doivent pas contenir le mot cible ni un mot de sa famille.
Mots cibles : ${targetWords.join(', ')}

Assure-toi que les mots tabous sont adaptés au niveau ${level}.`;

  let lastError: any = null;

  for (const apiKey of keys) {
    const ai = new GoogleGenAI({ apiKey });
    for (const model of MODEL_FALLBACK_CHAIN) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
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
                          description: 'Exactement 5 mots tabous',
                        },
                      },
                      required: ['targetWord', 'tabooWords'],
                    },
                  },
                },
                required: ['cards'],
              },
            },
          }),
        );
        if (!response.text) throw new Error('Réponse vide de Gemini.');
        const data = JSON.parse(response.text.trim());
        const cards = (Array.isArray(data?.cards) ? data.cards : []) as QuestionData[];
        return cards.filter((c) => c && c.targetWord && Array.isArray(c.tabooWords));
      } catch (error: any) {
        lastError = error;
        if (error?.isTimeout || isOverloadOrSaturationError(error)) {
          continue; // modèle suivant
        }
        break; // clé invalide, requête refusée… : on passe à la clé suivante
      }
    }
  }

  throw new Error(friendlyError(lastError));
}

/** Traduit les erreurs de l'API en phrases compréhensibles. */
function friendlyError(error: any): string {
  const raw = String(error?.message || error || '');
  const low = raw.toLowerCase();
  if (low.includes('api_key_invalid') || low.includes('api key not valid')) {
    return 'La clé API n’est pas valide. Vérifiez-la dans Google AI Studio.';
  }
  if (error?.isTimeout) return 'Gemini n’a pas répondu à temps (plus de 20 secondes).';
  if (isOverloadOrSaturationError(error)) return 'Quota épuisé ou serveurs de Gemini surchargés. Réessayez dans un moment.';
  if (low.includes('permission') || low.includes('403')) return 'Cette clé n’a pas accès au modèle demandé.';
  if (low.includes('failed to fetch') || low.includes('network')) return 'Pas de connexion à Internet, ou Gemini est injoignable.';
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw || 'Échec de la génération.';
}
