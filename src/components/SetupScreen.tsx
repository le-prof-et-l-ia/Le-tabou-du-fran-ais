import { useMemo, useRef, useState, ReactNode } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ClipboardCopy, Download, ExternalLink, FileUp,
  KeyRound, Library, Play, Save, Sparkles, Trash2, X,
} from 'lucide-react';
import { AudioAssets, GameConfig, Level, QuestionData, SavedDeck, TEAM_COLORS } from '../types';
import {
  buildExternalPrompt, cardWarnings, cardsToText, downloadText, loadDecks, norm,
  parseCards, parseWords, safeGet, safeSet, saveDecks,
} from '../lib/cards';
import SiteHeader from './SiteHeader';

interface SetupScreenProps {
  onStart: (config: GameConfig) => void;
  previous: GameConfig | null;
}

type Source = 'ia' | 'gemini' | 'jeux';

const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1'];
const DURATIONS = [45, 60, 90, 120];
const MIN_CARDS = 8;

const AI_LINKS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Le Chat', url: 'https://chat.mistral.ai/chat' },
  { name: 'Copilot', url: 'https://copilot.microsoft.com/' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
];

const defaultTeamName = (i: number) => `Équipe ${String.fromCharCode(65 + i)}`;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function Section({ step, title, subtitle, children }: { step: number; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-cream p-5 shadow-[0_1px_0_rgba(25,40,44,0.04)] sm:p-7">
      <div className="mb-5 flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-deep font-serif text-base font-bold text-cream">{step}</span>
        <div>
          <h2 className="font-serif text-2xl font-bold leading-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

const chip = (active: boolean) =>
  `rounded-xl border-2 px-3 py-2.5 font-bold transition-colors ${
    active ? 'border-deep bg-deep text-cream' : 'border-line bg-white text-ink hover:border-muted'
  }`;

const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-40';
const btnLight = `${btn} border border-line bg-white text-ink hover:border-ink`;
const btnDark = `${btn} bg-deep text-cream hover:bg-deeper`;
const field = 'w-full rounded-xl border border-line bg-white p-3 text-ink placeholder:text-muted/70 focus:border-deep focus:outline-none focus:ring-2 focus:ring-deep/20';

export default function SetupScreen({ onStart, previous }: SetupScreenProps) {
  const [level, setLevel] = useState<Level>(previous?.level ?? 'A1');
  const [teamNames, setTeamNames] = useState<string[]>(
    previous?.teams.map((t) => t.name) ?? [defaultTeamName(0), defaultTeamName(1)],
  );
  const [source, setSource] = useState<Source>(previous?.words.length && !previous.cards.length ? 'gemini' : 'ia');

  // Cartes préparées ailleurs
  const [cardsText, setCardsText] = useState(previous ? cardsToText(previous.cards) : '');
  const [promptWords, setPromptWords] = useState('');
  const [theme, setTheme] = useState('');
  const [count, setCount] = useState(30);
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Génération Gemini
  const [genWords, setGenWords] = useState(previous?.words.join('\n') ?? '');
  const [apiKeysInput, setApiKeysInput] = useState(() => safeGet('taboo_api_keys'));

  // Jeux enregistrés
  const [decks, setDecks] = useState<SavedDeck[]>(() => loadDecks());
  const [deckName, setDeckName] = useState('');
  const [deckMsg, setDeckMsg] = useState('');

  // Options
  const [turnDuration, setTurnDuration] = useState(previous?.turnDuration ?? 60);
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [successFile, setSuccessFile] = useState<File | null>(null);
  const [failFile, setFailFile] = useState<File | null>(null);

  const [error, setError] = useState('');

  const parsed = useMemo(() => parseCards(cardsText), [cardsText]);
  const prompt = useMemo(
    () => buildExternalPrompt(level, parseWords(promptWords), theme, count),
    [level, promptWords, theme, count],
  );
  const apiKeys = useMemo(() => apiKeysInput.split(/[\r\n]+/).map((k) => k.trim()).filter(Boolean), [apiKeysInput]);
  const wordsToGenerate = useMemo(() => {
    const known = new Set(parsed.cards.map((c) => norm(c.targetWord)));
    return parseWords(genWords).filter((w) => !known.has(norm(w)));
  }, [genWords, parsed.cards]);

  const warningsCount = parsed.cards.filter((c) => cardWarnings(c).length > 0).length;
  const total = parsed.cards.length + (apiKeys.length ? wordsToGenerate.length : 0);

  const setTeamCount = (n: number) => {
    setTeamNames((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? defaultTeamName(i)));
  };

  const removeCard = (card: QuestionData) => {
    setCardsText(cardsToText(parsed.cards.filter((c) => c !== card)));
  };

  const handleCopyPrompt = async () => {
    const ok = await copyText(prompt);
    setCopied(ok);
    if (!ok) setShowPrompt(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    const text = await file.text();
    setCardsText((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
    setSource('ia');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSaveDeck = () => {
    if (!parsed.cards.length) return;
    const name = deckName.trim() || `Jeu ${level} du ${new Date().toLocaleDateString('fr-FR')}`;
    const next = [{ name, level, cards: parsed.cards, savedAt: new Date().toISOString() }, ...decks.filter((d) => d.name !== name)];
    if (saveDecks(next)) {
      setDecks(next);
      setDeckMsg(`« ${name} » est enregistré dans ce navigateur.`);
    } else {
      setDeckMsg('Ce navigateur refuse l’enregistrement : téléchargez plutôt le fichier.');
    }
    setTimeout(() => setDeckMsg(''), 4000);
  };

  const handleLoadDeck = (d: SavedDeck) => {
    setCardsText(cardsToText(d.cards));
    setLevel(d.level);
    setSource('ia');
  };

  const handleDeleteDeck = (d: SavedDeck) => {
    if (!window.confirm(`Supprimer le jeu « ${d.name} » de ce navigateur ?`)) return;
    const next = decks.filter((x) => x !== d);
    saveDecks(next);
    setDecks(next);
  };

  const handleStart = () => {
    if (wordsToGenerate.length > 0 && apiKeys.length === 0) {
      setError(`Ajoutez une clé Gemini pour générer les ${wordsToGenerate.length} mots, ou videz la liste « Générer avec Gemini ».`);
      setSource('gemini');
      return;
    }
    if (total < MIN_CARDS) {
      setError(`Il faut au moins ${MIN_CARDS} cartes pour jouer (vous en avez ${total}).`);
      return;
    }
    safeSet('taboo_api_keys', apiKeysInput);

    const audioAssets: AudioAssets = {};
    if (bgmFile) audioAssets.bgm = URL.createObjectURL(bgmFile);
    if (successFile) audioAssets.success = URL.createObjectURL(successFile);
    if (failFile) audioAssets.fail = URL.createObjectURL(failFile);

    onStart({
      level,
      teams: teamNames.map((n, i) => ({
        id: `team-${i}`,
        name: n.trim() || defaultTeamName(i),
        score: 0,
        color: TEAM_COLORS[i % TEAM_COLORS.length],
      })),
      cards: parsed.cards,
      words: wordsToGenerate,
      apiKeys,
      audioAssets,
      turnDuration,
    });
  };

  const tab = (id: Source, label: string, icon: ReactNode) => (
    <button
      role="tab"
      aria-selected={source === id}
      onClick={() => setSource(id)}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${
        source === id ? 'bg-cream text-ink shadow-sm' : 'text-muted hover:text-ink'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 pb-36 pt-8 sm:px-6 sm:pt-12">
        <div className="mb-8 sm:mb-10">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-accent">Jeu de vocabulaire · FLE</span>
          <h1 className="mt-2 font-serif text-4xl font-bold leading-[1.05] sm:text-6xl">Le tabou du français</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            Faites deviner un mot à votre équipe sans prononcer les cinq mots interdits. Préparez les cartes avec l’IA de
            votre choix, ou générez-les ici avec votre clé Gemini.
          </p>
        </div>

        <div className="space-y-6">
          {/* 1. Niveau et équipes */}
          <Section step={1} title="Niveau et équipes">
            <div className="space-y-6">
              <div>
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-muted">Niveau (CECRL)</span>
                <div className="grid grid-cols-5 gap-2">
                  {LEVELS.map((l) => (
                    <button key={l} onClick={() => setLevel(l)} className={chip(level === l)} aria-pressed={level === l}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-muted">Nombre d’équipes</span>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setTeamCount(n)} className={chip(teamNames.length === n)} aria-pressed={teamNames.length === n}>
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {teamNames.map((name, i) => (
                    <label key={i} className="flex items-center gap-2 rounded-xl border border-line bg-white px-3">
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: TEAM_COLORS[i] }} />
                      <input
                        value={name}
                        onChange={(e) => setTeamNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))}
                        className="w-full bg-transparent py-2.5 font-bold focus:outline-none"
                        aria-label={`Nom de l’équipe ${i + 1}`}
                        maxLength={24}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* 2. Les cartes */}
          <Section step={2} title="Les cartes" subtitle={`Au moins ${MIN_CARDS} cartes. Vous pouvez combiner des cartes importées et des mots à générer.`}>
            <div role="tablist" className="mb-6 flex gap-1 rounded-xl bg-paper p-1">
              {tab('ia', 'Préparer avec une IA', <Sparkles size={16} />)}
              {tab('gemini', 'Générer avec Gemini', <KeyRound size={16} />)}
              {tab('jeux', `Mes jeux${decks.length ? ` (${decks.length})` : ''}`, <Library size={16} />)}
            </div>

            {source === 'ia' && (
              <div className="space-y-6">
                {/* Étape a : consigne */}
                <div className="rounded-xl border border-line bg-paper/60 p-4 sm:p-5">
                  <h3 className="font-bold">a. Copiez la consigne et collez-la dans votre IA</h3>
                  <p className="mt-1 text-sm text-muted">
                    Donnez vos mots, ou laissez l’IA les choisir sur un thème. La consigne tient compte du niveau {level}.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr]">
                    <textarea
                      value={promptWords}
                      onChange={(e) => setPromptWords(e.target.value)}
                      rows={4}
                      className={`${field} resize-y text-sm`}
                      placeholder={'Vos mots (facultatif), un par ligne ou séparés par des virgules :\nla boulangerie, l’arc-en-ciel, voyager…'}
                      aria-label="Mots cibles pour la consigne"
                    />
                    <div className={`space-y-3 ${parseWords(promptWords).length ? 'opacity-40' : ''}`}>
                      <input
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                        className={`${field} text-sm`}
                        placeholder="…ou un thème : la ville, les émotions…"
                        aria-label="Thème"
                        disabled={parseWords(promptWords).length > 0}
                      />
                      <label className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted">Nombre de cartes</span>
                        <select
                          value={count}
                          onChange={(e) => setCount(Number(e.target.value))}
                          className="rounded-lg border border-line bg-white px-2 py-1.5 font-bold"
                          disabled={parseWords(promptWords).length > 0}
                        >
                          {[15, 20, 30, 40, 50].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button onClick={handleCopyPrompt} className={copied ? `${btn} bg-good text-white` : btnDark}>
                      {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
                      {copied ? 'Consigne copiée' : 'Copier la consigne'}
                    </button>
                    <button onClick={() => setShowPrompt((s) => !s)} className={btnLight}>
                      {showPrompt ? 'Masquer' : 'Voir la consigne'}
                    </button>
                    <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
                    <span className="text-sm text-muted">Ouvrir :</span>
                    {AI_LINKS.map((a) => (
                      <a key={a.name} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-deep underline decoration-line underline-offset-4 hover:decoration-deep">
                        {a.name}<ExternalLink size={12} />
                      </a>
                    ))}
                  </div>
                  {showPrompt && (
                    <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-white p-4 text-xs leading-relaxed text-ink">{prompt}</pre>
                  )}
                </div>

                {/* Étape b : réponse */}
                <div>
                  <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                    <h3 className="font-bold">b. Collez la réponse de l’IA, ou importez un fichier</h3>
                    <div className="flex gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0])}
                      />
                      <button onClick={() => fileRef.current?.click()} className={btnLight}>
                        <FileUp size={16} /> Importer un fichier
                      </button>
                      {cardsText && (
                        <button onClick={() => setCardsText('')} className={btnLight} title="Vider la liste">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={cardsText}
                    onChange={(e) => {
                      setCardsText(e.target.value);
                      setError('');
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFile(e.dataTransfer.files?.[0]);
                    }}
                    rows={7}
                    className={`${field} resize-y font-mono text-sm`}
                    placeholder={'la boulangerie : pain, baguette, croissant, boulanger, magasin\nl’hiver : froid, neige, saison, décembre, manteau\n…\n\nAcceptés aussi : colonnes copiées d’un tableur (Excel, Sheets), CSV ou JSON.'}
                    aria-label="Cartes préparées"
                  />
                  {parsed.ignored.length > 0 && (
                    <p className="mt-2 text-sm text-muted">
                      {parsed.ignored.length} ligne{parsed.ignored.length > 1 ? 's' : ''} non reconnue{parsed.ignored.length > 1 ? 's' : ''} (ignorée{parsed.ignored.length > 1 ? 's' : ''}) : « {parsed.ignored[0].slice(0, 60)} »{parsed.ignored.length > 1 ? '…' : ''}
                    </p>
                  )}
                </div>

                {/* Étape c : aperçu */}
                {parsed.cards.length > 0 && (
                  <div>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-bold">
                        c. Vérifiez les {parsed.cards.length} cartes
                        {warningsCount > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent-dark">
                            <AlertTriangle size={12} /> {warningsCount} à revoir
                          </span>
                        )}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={deckName}
                          onChange={(e) => setDeckName(e.target.value)}
                          placeholder="Nom du jeu"
                          className="w-40 rounded-xl border border-line bg-white px-3 py-2 text-sm focus:border-deep focus:outline-none"
                          aria-label="Nom du jeu à enregistrer"
                        />
                        <button onClick={handleSaveDeck} className={btnLight}>
                          <Save size={16} /> Enregistrer
                        </button>
                        <button
                          onClick={() => downloadText(`tabou-${level}-${(deckName || 'cartes').trim().replace(/\s+/g, '-')}.txt`, cardsToText(parsed.cards))}
                          className={btnLight}
                          title="Télécharger les cartes (.txt), réimportables plus tard"
                        >
                          <Download size={16} /> .txt
                        </button>
                      </div>
                    </div>
                    {deckMsg && <p className="mb-3 text-sm text-good">{deckMsg}</p>}
                    <ul className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {parsed.cards.map((c, i) => {
                        const warns = cardWarnings(c);
                        return (
                          <li key={c.targetWord + i} className={`group relative rounded-xl border bg-white p-3 ${warns.length ? 'border-accent/60' : 'border-line'}`}>
                            <button
                              onClick={() => removeCard(c)}
                              className="absolute right-2 top-2 rounded-md p-1 text-muted opacity-60 hover:bg-paper hover:text-bad group-hover:opacity-100"
                              aria-label={`Retirer la carte ${c.targetWord}`}
                            >
                              <X size={14} />
                            </button>
                            <div className="pr-6 font-serif text-lg font-bold leading-tight">{c.targetWord}</div>
                            <div className="mt-1 text-sm text-muted">{c.tabooWords.join(' · ')}</div>
                            {warns.length > 0 && <div className="mt-1.5 text-xs font-bold text-accent-dark">⚠ {warns.join(' ; ')}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {source === 'gemini' && (
              <div className="space-y-5">
                <div>
                  <label className="mb-2 block font-bold" htmlFor="gen-words">Mots à faire deviner</label>
                  <textarea
                    id="gen-words"
                    value={genWords}
                    onChange={(e) => {
                      setGenWords(e.target.value);
                      setError('');
                    }}
                    rows={6}
                    className={`${field} resize-y`}
                    placeholder={'Un mot par ligne, ou séparés par des virgules :\nla pomme, l’arc-en-ciel, voyager, grand-mère…'}
                  />
                  <p className="mt-1.5 text-sm text-muted">
                    {parseWords(genWords).length} mot{parseWords(genWords).length > 1 ? 's' : ''}. Les mots composés (arc-en-ciel, après-midi) restent entiers.
                    {parseWords(genWords).length > wordsToGenerate.length && ` ${parseWords(genWords).length - wordsToGenerate.length} déjà présent(s) dans vos cartes importées.`}
                  </p>
                </div>
                <div>
                  <label className="mb-2 flex flex-wrap items-baseline justify-between gap-2 font-bold" htmlFor="api-keys">
                    <span>Clé API Gemini</span>
                    <span className="text-xs font-normal text-muted">une par ligne ; la suivante prend le relais si le quota est épuisé</span>
                  </label>
                  <textarea
                    id="api-keys"
                    value={apiKeysInput}
                    onChange={(e) => {
                      setApiKeysInput(e.target.value);
                      safeSet('taboo_api_keys', e.target.value);
                    }}
                    rows={2}
                    className={`${field} resize-none font-mono text-xs`}
                    placeholder="AIzaSy…"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <p className="mt-1.5 text-xs text-muted">
                    La clé reste enregistrée dans ce navigateur et n’est envoyée qu’à Google. Une clé se crée dans Google AI Studio.
                  </p>
                </div>
              </div>
            )}

            {source === 'jeux' && (
              <div>
                {decks.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
                    Aucun jeu enregistré dans ce navigateur. Importez des cartes, puis cliquez sur « Enregistrer ».
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {decks.map((d) => (
                      <li key={d.name + d.savedAt} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-3">
                        <span className="rounded-md bg-mint px-2 py-0.5 text-xs font-bold text-deep">{d.level}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold">{d.name}</div>
                          <div className="text-xs text-muted">
                            {d.cards.length} cartes · {new Date(d.savedAt).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                        <button onClick={() => handleLoadDeck(d)} className={btnDark}>Charger</button>
                        <button onClick={() => downloadText(`tabou-${d.level}-${d.name.replace(/\s+/g, '-')}.txt`, cardsToText(d.cards))} className={btnLight} aria-label={`Télécharger ${d.name}`}>
                          <Download size={16} />
                        </button>
                        <button onClick={() => handleDeleteDeck(d)} className={`${btnLight} hover:text-bad`} aria-label={`Supprimer ${d.name}`}>
                          <Trash2 size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>

          {/* 3. Options */}
          <details className="group rounded-2xl border border-line bg-cream">
            <summary className="flex items-center justify-between gap-3 p-5 sm:px-7">
              <span className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-deep font-serif text-base font-bold text-cream">3</span>
                <span className="font-serif text-2xl font-bold">Options</span>
                <span className="text-sm text-muted">durée du tour : {turnDuration} s · sons</span>
              </span>
              <ChevronDown className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-6 border-t border-line p-5 sm:px-7">
              <div>
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-muted">Durée d’un tour</span>
                <div className="grid grid-cols-4 gap-2">
                  {DURATIONS.map((d) => (
                    <button key={d} onClick={() => setTurnDuration(d)} className={chip(turnDuration === d)} aria-pressed={turnDuration === d}>
                      {d} s
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <span className="block text-xs font-bold uppercase tracking-[0.12em] text-muted">Vos propres sons (facultatif)</span>
                {[
                  { label: 'Musique de fond', set: setBgmFile, file: bgmFile },
                  { label: 'Bonne réponse', set: setSuccessFile, file: successFile },
                  { label: 'Mot tabou / fin du tour', set: setFailFile, file: failFile },
                ].map((s) => (
                  <label key={s.label} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm">{s.label}</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => s.set(e.target.files?.[0] || null)}
                      className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-ink"
                    />
                  </label>
                ))}
              </div>
            </div>
          </details>
        </div>
      </main>

      {/* Barre de lancement */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-cream/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="text-sm">
            {error ? (
              <span className="font-bold text-bad">{error}</span>
            ) : (
              <>
                <span className="font-bold">{parsed.cards.length} carte{parsed.cards.length > 1 ? 's' : ''} prête{parsed.cards.length > 1 ? 's' : ''}</span>
                {wordsToGenerate.length > 0 && (
                  <span className="text-muted"> + {wordsToGenerate.length} mot{wordsToGenerate.length > 1 ? 's' : ''} à générer{!apiKeys.length && ' (clé manquante)'}</span>
                )}
                <span className="text-muted"> · {level} · {teamNames.length} équipe{teamNames.length > 1 ? 's' : ''}</span>
              </>
            )}
          </div>
          <button
            onClick={handleStart}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-lg font-bold text-white shadow-sm transition-colors hover:bg-accent-dark active:scale-[0.98]"
          >
            <Play size={20} fill="currentColor" /> Commencer
          </button>
        </div>
      </div>
    </>
  );
}
