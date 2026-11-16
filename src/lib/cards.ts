import { Level, QuestionData, SavedDeck } from '../types';

export const norm = (s: string) =>
  s.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Découpe une liste de mots à faire générer.
 * On ne coupe PAS sur les tirets ni les points : « arc-en-ciel », « grand-mère »,
 * « après-midi » doivent rester entiers. Un tiret entouré d'espaces sépare encore.
 */
export function parseWords(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\n\r,;\/–—]+|\s-\s|\.\s+/)
    .map((w) => w.trim().replace(/^[-•*]\s*/, '').replace(/\.$/, '').trim())
    .filter((w) => {
      if (!w) return false;
      const k = norm(w);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

const cleanCell = (s: string) =>
  s
    .replace(/\*\*|__|`/g, '')
    .replace(/^["'«\s]+|["'»\s]+$/g, '')
    .replace(/[.。]$/, '')
    .trim();

const splitTaboos = (s: string) =>
  s
    .split(/\s*[,;|]\s*/)
    .map(cleanCell)
    .filter(Boolean);

function fromJson(text: string): QuestionData[] | null {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(data) ? data : data?.cards || data?.cartes || data?.items;
  if (!Array.isArray(list)) return null;
  return list
    .map((c: any) => {
      const target = c?.targetWord ?? c?.target ?? c?.mot ?? c?.cible ?? c?.motCible ?? c?.word;
      const taboos = c?.tabooWords ?? c?.taboos ?? c?.tabous ?? c?.interdits ?? c?.motsTabous ?? c?.forbidden;
      if (typeof target !== 'string') return null;
      const arr = Array.isArray(taboos) ? taboos.map(String) : typeof taboos === 'string' ? splitTaboos(taboos) : [];
      return { targetWord: cleanCell(target), tabooWords: arr.map(cleanCell).filter(Boolean) };
    })
    .filter(Boolean) as QuestionData[];
}

function fromLine(raw: string): QuestionData | null {
  let line = raw.replace(/^\s*(?:[-*•]|\d+\s*[.)])\s+/, '').trim();
  if (!line || line.startsWith('```')) return null;
  line = line.replace(/\*\*|__/g, '');

  let target = '';
  let rest: string[] = [];

  if (line.includes('\t')) {
    // Copié depuis un tableur : première colonne = mot cible
    const cells = line.split('\t').map(cleanCell).filter(Boolean);
    target = cells[0] || '';
    rest = cells.length === 2 ? splitTaboos(cells[1]) : cells.slice(1);
  } else if (/[:：]/.test(line)) {
    const i = line.search(/[:：]/);
    target = cleanCell(line.slice(0, i));
    rest = splitTaboos(line.slice(i + 1));
  } else if (line.includes(';')) {
    const cells = line.split(';').map(cleanCell).filter(Boolean);
    target = cells[0] || '';
    rest = cells.slice(1);
  } else if (line.split(',').length >= 3) {
    const cells = line.split(',').map(cleanCell).filter(Boolean);
    target = cells[0] || '';
    rest = cells.slice(1);
  } else {
    return null;
  }

  if (!target || /^(mot[s]? cible[s]?|target|mot)$/i.test(target)) return null;
  return { targetWord: target, tabooWords: rest };
}

export interface ParseResult {
  cards: QuestionData[];
  ignored: string[]; // lignes non reconnues
}

/** Lit des cartes préparées par n'importe quelle IA (ou à la main) : texte, tableur ou JSON. */
export function parseCards(text: string): ParseResult {
  const trimmed = text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  if (!trimmed) return { cards: [], ignored: [] };

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const json = fromJson(trimmed);
    if (json) return { cards: dedupe(json), ignored: [] };
  }

  const cards: QuestionData[] = [];
  const ignored: string[] = [];
  for (const raw of trimmed.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('```')) continue;
    const card = fromLine(raw);
    if (card && card.tabooWords.length > 0) cards.push(card);
    else ignored.push(raw.trim());
  }
  return { cards: dedupe(cards), ignored };
}

function dedupe(cards: QuestionData[]): QuestionData[] {
  const seen = new Set<string>();
  const out: QuestionData[] = [];
  for (const c of cards) {
    const k = norm(c.targetWord);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const taboos: string[] = [];
    const seenT = new Set<string>();
    for (const t of c.tabooWords) {
      const kt = norm(t);
      if (kt && !seenT.has(kt)) {
        seenT.add(kt);
        taboos.push(t);
      }
    }
    out.push({ targetWord: c.targetWord, tabooWords: taboos });
  }
  return out;
}

/** Remarques à signaler à l'enseignant avant la partie. */
export function cardWarnings(card: QuestionData): string[] {
  const w: string[] = [];
  if (card.tabooWords.length !== 5) w.push(`${card.tabooWords.length} mot${card.tabooWords.length > 1 ? 's' : ''} tabou${card.tabooWords.length > 1 ? 's' : ''} au lieu de 5`);
  const targetTokens = norm(card.targetWord)
    .split(/[\s'’-]+/)
    .filter((t) => t.length > 3 && !['les', 'des', 'une', 'pour', 'avec', 'dans'].includes(t));
  const hit = card.tabooWords.find((t) => targetTokens.some((tt) => norm(t).includes(tt)));
  if (hit) w.push(`« ${hit} » reprend le mot cible`);
  return w;
}

export function cardsToText(cards: QuestionData[]): string {
  return cards.map((c) => `${c.targetWord} : ${c.tabooWords.join(', ')}`).join('\n');
}

export function buildExternalPrompt(level: Level, words: string[], theme: string, count: number): string {
  const consigneMots = words.length
    ? `Mots cibles (${words.length}) :\n${words.join('\n')}`
    : `Choisis toi-même ${count} mots cibles utiles et variés pour des apprenants de niveau ${level}${theme.trim() ? `, sur le thème : ${theme.trim()}` : ''}. Pour les noms, ajoute l'article (le, la, l', un, une).`;

  return `Tu es professeur de français langue étrangère (FLE). Prépare des cartes pour le jeu Tabou, destinées à des apprenants de niveau ${level} du CECRL.

Pour chaque mot cible, donne exactement 5 mots ou courtes expressions « tabous » : les mots les plus évidents qu'on utiliserait pour le faire deviner. Ces mots tabous doivent :
- être adaptés au niveau ${level} ;
- ne pas contenir le mot cible ni un mot de la même famille ;
- être différents les uns des autres.

${consigneMots}

Réponds uniquement avec la liste, dans un bloc de code, une carte par ligne, sans numérotation ni commentaire, au format exact :
mot cible : tabou 1, tabou 2, tabou 3, tabou 4, tabou 5

Exemple :
la boulangerie : pain, baguette, croissant, boulanger, magasin`;
}

/* ---------- Jeux de cartes enregistrés dans ce navigateur ---------- */

const DECKS_KEY = 'tabou_jeux';

export function loadDecks(): SavedDeck[] {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveDecks(decks: SavedDeck[]): boolean {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* navigation privée : on ignore */
  }
}

export const shuffleArray = <T,>(arr: T[]): T[] => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
