export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

export interface Team {
  id: string;
  name: string;
  score: number;
  color: string;
}

export interface QuestionData {
  targetWord: string;
  tabooWords: string[];
}

export type GamePhase = 'setup' | 'playing' | 'results';

export interface AudioAssets {
  bgm?: string;
  success?: string;
  fail?: string;
}

export interface GameConfig {
  level: Level;
  teams: Team[];
  cards: QuestionData[]; // cartes prêtes (importées)
  words: string[]; // mots à faire générer par Gemini
  apiKeys: string[];
  audioAssets: AudioAssets;
  turnDuration: number; // secondes
}

export interface SavedDeck {
  name: string;
  level: Level;
  cards: QuestionData[];
  savedAt: string;
}

export const TEAM_COLORS = ['#db663d', '#1f6f6b', '#7a4a8c', '#c8962e', '#3d6fb4'];
