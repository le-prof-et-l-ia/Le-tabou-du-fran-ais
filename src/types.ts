export type Level = 'A1' | 'A2' | 'B1' | 'B2';

export interface Team {
  id: string;
  name: string;
  score: number;
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

