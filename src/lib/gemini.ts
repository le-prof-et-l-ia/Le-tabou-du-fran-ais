import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { Level, QuestionData } from '../types';

// Cascade de modèles : on ne passe au suivant qu'en cas de surcharge ou de délai dépassé.
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

/** Délai maximal accordé à un modèle pour répondre. */
const TIMEOUT_MS = 45000;
/** Temps total maximal pour un lot, tous modèles et toutes clés confondus. */
const BATCH_DEADLINE_MS = 100000;
/** En dessous de ce temps restant, inutile de lancer un nouvel essai. */
const MIN_ATTEMPT_MS = 8000;

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

/** Modèle inconnu ou retiré pour cette clé : on essaie le suivant. */
function isModelNotFoundError(error: any): boolean {
  const status = error?.status ?? error?.code ?? error?.error?.code;
  const message = String(error?.message || error || '').toLowerCase();
  return status === 404 || message.includes('not_found') || message.includes('is not found') || message.includes('not supported for generatecontent');
}

/** Le modèle refuse le réglage de réflexion demandé : on réessaie sans. */
function isThinkingConfigError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('thinking');
}

/**
 * Lance la requête avec un délai maximal. Si le délai est dépassé,
 * la requête est réellement annulée (elle ne consomme plus de quota).
 */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(`Pas de réponse du serveur depuis plus de ${Math.round(timeoutMs / 1000)} secondes.`);
      err.isTimeout = true;
      controller.abort();
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Informations transmises à l'écran pendant la génération. */
export interface GenerationProgress {
  attempt: number; // 1 pour le premier essai, puis 2, 3…
  reason?: string; // pourquoi on change de modèle ou de clé
}

/**
 * Génère des cartes directement depuis le navigateur avec la ou les clés de l'enseignant.
 * Les clés ne quittent le navigateur que pour être envoyées à Google.
 */
export async function generateTabooBatch(
  targetWords: string[],
  level: Level,
  apiKeys: string[],
  onProgress?: (progress: GenerationProgress) => void,
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
  let attempt = 0;
  const deadline = Date.now() + BATCH_DEADLINE_MS;

  keyLoop: for (const apiKey of keys) {
    const ai = new GoogleGenAI({ apiKey });
    modelLoop: for (const model of MODEL_FALLBACK_CHAIN) {
      let withThinkingConfig = true;
      // Deux passages au plus par modèle : le second seulement si le réglage de réflexion est refusé.
      for (let pass = 0; pass < 2; pass++) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) break keyLoop;
        attempt++;
        onProgress?.({ attempt, reason: lastError ? friendlyError(lastError) : undefined });
        try {
          const response = await withTimeout(
            (abortSignal) =>
              ai.models.generateContent({
                model,
                contents: prompt,
                config: {
                  abortSignal,
                  systemInstruction,
                  // Tâche simple : réflexion minimale, réponse beaucoup plus rapide.
                  ...(withThinkingConfig ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
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
            Math.min(TIMEOUT_MS, remaining),
          );
          if (!response.text) throw new Error('Réponse vide de Gemini.');
          const data = JSON.parse(response.text.trim());
          const cards = (Array.isArray(data?.cards) ? data.cards : []) as QuestionData[];
          return cards.filter((c) => c && c.targetWord && Array.isArray(c.tabooWords));
        } catch (error: any) {
          lastError = error;
          if (withThinkingConfig && !error?.isTimeout && isThinkingConfigError(error)) {
            withThinkingConfig = false;
            continue; // même modèle, sans réglage de réflexion
          }
          if (error?.isTimeout || isOverloadOrSaturationError(error) || isModelNotFoundError(error)) {
            continue modelLoop; // modèle suivant
          }
          continue keyLoop; // clé invalide, requête refusée… : on passe à la clé suivante
        }
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
  if (error?.isTimeout) return 'Gemini met trop de temps à répondre.';
  if (isOverloadOrSaturationError(error)) return 'Quota épuisé ou serveurs de Gemini surchargés. Réessayez dans un moment.';
  if (low.includes('permission') || low.includes('403')) return 'Cette clé n’a pas accès au modèle demandé.';
  if (low.includes('failed to fetch') || low.includes('network')) return 'Pas de connexion à Internet, ou Gemini est injoignable.';
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw || 'Échec de la génération.';
}
