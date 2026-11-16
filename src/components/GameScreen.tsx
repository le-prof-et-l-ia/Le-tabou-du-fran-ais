import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, CheckCircle2, Expand, Flag, Play, RotateCw, Shrink, SkipForward } from 'lucide-react';
import { AudioAssets, GameConfig, QuestionData, Team } from '../types';
import { norm, shuffleArray } from '../lib/cards';
import type { GenerationProgress } from '../lib/gemini';
import SiteHeader from './SiteHeader';

interface GameScreenProps {
  config: GameConfig;
  onEnd: (teams: Team[], missed: QuestionData[], played: QuestionData[]) => void;
}

type TurnPhase = 'ready' | 'playing' | 'review' | 'turnEnd';

/** Premier lot volontairement petit : la partie peut démarrer en quelques secondes. */
const FIRST_BATCH_SIZE = 5;
/** Lots suivants, préparés en arrière-plan pendant le jeu. */
const BATCH_SIZE = 10;
/** On relance la génération dès qu'il reste moins de cartes que ce seuil. */
const PREFETCH_THRESHOLD = 6;
const MAX_FAILURES = 3;

/* ---------- Sons ---------- */
let sharedCtx: AudioContext | null = null;
function tone(type: OscillatorType, from: number, to: number, duration: number, volume: number) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    sharedCtx = sharedCtx || new Ctx();
    const ctx = sharedCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    if (to !== from) osc.frequency.setValueAtTime(to, ctx.currentTime + duration / 3);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.error(e);
  }
}
const playBuzzer = (a?: AudioAssets) =>
  a?.fail ? new Audio(a.fail).play().catch(console.error) : tone('sawtooth', 150, 100, 0.8, 0.2);
const playSuccess = (a?: AudioAssets) =>
  a?.success ? new Audio(a.success).play().catch(console.error) : tone('sine', 600, 800, 0.3, 0.1);
const playTick = () => tone('square', 900, 900, 0.05, 0.03);

/* ---------- Chrono circulaire ---------- */
function TimerRing({ remaining, total }: { remaining: number; total: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, remaining / total);
  const color = remaining <= 10 ? 'var(--color-bad)' : remaining <= total / 3 ? 'var(--color-accent)' : 'var(--color-mint)';
  return (
    <div className={`relative h-24 w-24 sm:h-28 sm:w-28 ${remaining <= 10 && remaining > 0 ? 'animate-pulse' : ''}`} role="timer" aria-label={`${remaining} secondes restantes`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-3xl font-bold text-cream sm:text-4xl">{remaining}</span>
    </div>
  );
}

export default function GameScreen({ config, onEnd }: GameScreenProps) {
  const { audioAssets, apiKeys, level, turnDuration } = config;

  const [teams, setTeams] = useState<Team[]>(config.teams);
  const [currentTeamIndex, setCurrentTeamIndex] = useState(0);
  const currentTeam = teams[currentTeamIndex];

  // queue[0] est toujours la carte affichée
  const [queue, setQueue] = useState<QuestionData[]>(() => shuffleArray(config.cards));
  const [pool, setPool] = useState<QuestionData[]>(config.cards); // toutes les cartes, pour les recycler
  const [wordsQueue, setWordsQueue] = useState<string[]>(() => shuffleArray(config.words));
  const [isFetching, setIsFetching] = useState(false);
  const [failures, setFailures] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [fetchStartedAt, setFetchStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fetchingRef = useRef(false);

  const [phase, setPhase] = useState<TurnPhase>('ready');
  const [timeRemaining, setTimeRemaining] = useState(turnDuration);
  const [turnScore, setTurnScore] = useState(0);
  const [turnMissed, setTurnMissed] = useState<QuestionData[]>([]);
  const [gameMissed, setGameMissed] = useState<QuestionData[]>([]);
  const [played, setPlayed] = useState<QuestionData[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const currentCard = queue[0] || null;
  const generationStopped = failures >= MAX_FAILURES || apiKeys.length === 0;

  /* ---------- Musique de fond ---------- */
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!audioAssets.bgm) return;
    const audio = new Audio(audioAssets.bgm);
    audio.loop = true;
    audio.volume = 0.1;
    bgmRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioAssets.bgm]);
  useEffect(() => {
    if (!bgmRef.current) return;
    if (phase === 'playing') bgmRef.current.play().catch(() => {});
    else bgmRef.current.pause();
  }, [phase]);

  /* ---------- Génération par Gemini ---------- */
  const fetchBatch = useCallback(async () => {
    if (fetchingRef.current || wordsQueue.length === 0 || generationStopped) return;
    fetchingRef.current = true;
    setIsFetching(true);
    setProgress(null);
    setFetchStartedAt(Date.now());
    const targetWords = wordsQueue.slice(0, pool.length === 0 ? FIRST_BATCH_SIZE : BATCH_SIZE);
    try {
      // Le SDK Gemini n'est chargé que si l'on génère des cartes.
      const { generateTabooBatch } = await import('../lib/gemini');
      const cards = await generateTabooBatch(targetWords, level, apiKeys, setProgress);
      setPool((prev) => {
        const known = new Set(prev.map((c) => norm(c.targetWord)));
        return [...prev, ...cards.filter((c) => !known.has(norm(c.targetWord)))];
      });
      setQueue((prev) => {
        const known = new Set(prev.map((c) => norm(c.targetWord)));
        return [...prev, ...cards.filter((c) => !known.has(norm(c.targetWord)))];
      });
      setWordsQueue((prev) => prev.slice(targetWords.length));
      setFailures(0);
      setApiError(null);
    } catch (error: any) {
      console.error(error);
      setApiError(error?.message || 'Erreur de connexion');
      setFailures((f) => f + 1);
      await new Promise((r) => setTimeout(r, 4000));
    } finally {
      fetchingRef.current = false;
      setIsFetching(false);
      setProgress(null);
      setFetchStartedAt(null);
    }
  }, [wordsQueue, generationStopped, level, apiKeys, pool.length]);

  // Réapprovisionne la file : d'abord Gemini, sinon on recycle les cartes déjà jouées.
  // La génération est lancée à l'avance pour que la file ne se vide pas en plein tour.
  useEffect(() => {
    if (wordsQueue.length > 0 && !generationStopped) {
      if (queue.length < PREFETCH_THRESHOLD && !isFetching) fetchBatch();
      return;
    }
    if (queue.length >= 3) return;
    if (pool.length > 0) {
      setQueue((prev) => {
        if (prev.length >= 3) return prev;
        const inQueue = new Set(prev.map((c) => norm(c.targetWord)));
        const available = pool.filter((c) => !inQueue.has(norm(c.targetWord)));
        return [...prev, ...shuffleArray(available.length ? available : pool)];
      });
    }
  }, [queue.length, wordsQueue.length, generationStopped, isFetching, fetchBatch, pool]);

  /* ---------- État de la génération, affiché pendant l'attente ---------- */
  const waitingForGeneration = !currentCard && !generationStopped && wordsQueue.length > 0;
  useEffect(() => {
    if (!waitingForGeneration || !isFetching) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitingForGeneration, isFetching]);
  const elapsed = fetchStartedAt ? Math.max(0, Math.round((now - fetchStartedAt) / 1000)) : 0;
  let generationStatus = 'Gemini prépare les cartes…';
  if (isFetching && failures > 0) {
    generationStatus = `Nouvel essai (${failures + 1} sur ${MAX_FAILURES}) après : ${apiError ?? 'erreur inconnue'}`;
  } else if (isFetching && progress && progress.attempt > 1) {
    generationStatus = `Gemini tarde à répondre : essai d’un autre modèle (n° ${progress.attempt})…`;
  } else if (isFetching && elapsed >= 15) {
    generationStatus = 'Gemini est lent aujourd’hui, patientez encore un peu…';
  } else if (!isFetching && failures > 0) {
    generationStatus = `Échec de la tentative ${failures} sur ${MAX_FAILURES} : ${apiError ?? 'erreur inconnue'} Nouvel essai dans quelques secondes…`;
  }
  if (isFetching && elapsed > 0) generationStatus += ` (${elapsed} s)`;

  /* ---------- Chrono ---------- */
  const waitingForCards = phase === 'playing' && !currentCard;
  useEffect(() => {
    if (phase !== 'playing' || waitingForCards || timeRemaining <= 0) return;
    const t = window.setTimeout(() => {
      setTimeRemaining((s) => s - 1);
      if (timeRemaining <= 6 && timeRemaining > 1) playTick();
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, waitingForCards, timeRemaining]);

  const endTurn = useCallback(() => {
    playBuzzer(audioAssets);
    const onScreen = queue[0];
    const missed = [...turnMissed];
    if (onScreen && !missed.some((c) => norm(c.targetWord) === norm(onScreen.targetWord))) missed.push(onScreen);
    if (onScreen) setQueue((prev) => prev.slice(1));
    setTurnMissed(missed);
    setTeams((prev) => prev.map((t, i) => (i === currentTeamIndex ? { ...t, score: t.score + turnScore } : t)));
    setGameMissed((prev) => {
      const known = new Set(prev.map((c) => norm(c.targetWord)));
      return [...prev, ...missed.filter((c) => !known.has(norm(c.targetWord)))];
    });
    if (onScreen) setPlayed((p) => [...p, onScreen]);
    setPhase(missed.length > 0 ? 'review' : 'turnEnd');
  }, [audioAssets, queue, turnMissed, currentTeamIndex, turnScore]);

  useEffect(() => {
    if (phase === 'playing' && timeRemaining <= 0) endTurn();
  }, [phase, timeRemaining, endTurn]);

  /* ---------- Actions ---------- */
  const startTurn = () => {
    setTurnScore(0);
    setTurnMissed([]);
    setTimeRemaining(turnDuration);
    setPhase('playing');
  };

  const handleAction = useCallback(
    (points: number) => {
      const card = queue[0];
      if (phase !== 'playing' || !card) return;
      if (points > 0) playSuccess(audioAssets);
      else if (points < 0) playBuzzer(audioAssets);
      if (points <= 0) {
        setTurnMissed((m) => (m.some((c) => norm(c.targetWord) === norm(card.targetWord)) ? m : [...m, card]));
      }
      setPlayed((p) => [...p, card]);
      setQueue((prev) => prev.slice(1));
      setTurnScore((s) => s + points);
    },
    [queue, phase, audioAssets],
  );

  const adjustScore = (teamIndex: number, delta: number) => {
    if (delta > 0) playSuccess(audioAssets);
    else playBuzzer(audioAssets);
    setTeams((prev) => prev.map((t, i) => (i === teamIndex ? { ...t, score: t.score + delta } : t)));
  };

  const nextTeam = () => {
    setCurrentTeamIndex((i) => (i + 1) % teams.length);
    setPhase('ready');
  };

  const finishGame = () => {
    if (phase === 'playing' && !window.confirm('Le tour est en cours. Terminer la partie maintenant ?')) return;
    onEnd(teams, gameMissed, played);
  };

  const retryGeneration = () => {
    setFailures(0);
    setApiError(null);
  };

  /* ---------- Clavier : Espace = trouvé, X = tabou, P = passer ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (phase === 'playing') {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); handleAction(1); }
        else if (e.key.toLowerCase() === 'x') { e.preventDefault(); handleAction(-1); }
        else if (e.key.toLowerCase() === 'p' || e.key === 'ArrowRight') { e.preventDefault(); handleAction(0); }
      } else if (phase === 'ready' && (e.code === 'Space' || e.key === 'Enter') && currentCard) {
        e.preventDefault();
        startTurn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------- Plein écran ---------- */
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  /* ---------- Rendu ---------- */
  const scoreboard = (
    <div className="flex flex-wrap justify-center gap-2">
      {teams.map((t, i) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
            i === currentTeamIndex ? 'border-cream/60 bg-cream/15 text-cream' : 'border-cream/15 text-cream/70'
          }`}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
          <span className="font-bold">{t.name}</span>
          <span className="font-mono">{t.score}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-deep text-cream">
      {!isFullscreen && (
        <SiteHeader>
          <button onClick={toggleFullscreen} className="hidden items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold text-ink hover:border-ink sm:inline-flex">
            <Expand size={16} /> Plein écran
          </button>
          <button onClick={finishGame} className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold text-ink hover:border-ink">
            <Flag size={16} /> Terminer
          </button>
        </SiteHeader>
      )}
      {isFullscreen && (
        <button onClick={toggleFullscreen} className="fixed right-4 top-4 z-40 rounded-xl bg-cream/10 p-2 text-cream hover:bg-cream/20" aria-label="Quitter le plein écran">
          <Shrink size={20} />
        </button>
      )}

      <div className="border-b border-cream/10 bg-deeper/60 px-4 py-3">{scoreboard}</div>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-6">
        {/* Avant le tour */}
        {phase === 'ready' && (
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-3xl bg-cream p-8 text-center text-ink shadow-2xl sm:p-12">
            <span className="mx-auto mb-5 block h-4 w-4 rounded-full" style={{ background: currentTeam.color }} />
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-muted">Au tour de</p>
            <h2 className="mt-1 font-serif text-4xl font-bold sm:text-5xl">{currentTeam.name}</h2>
            <p className="mt-4 text-muted">Un joueur fait deviner les mots à son équipe sans dire les mots interdits. Vous avez {turnDuration} secondes.</p>
            <button
              onClick={startTurn}
              disabled={!currentCard}
              className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-accent px-8 py-4 text-xl font-bold text-white shadow-lg transition-colors hover:bg-accent-dark active:scale-95 disabled:opacity-50"
            >
              {currentCard ? (
                <><Play size={22} fill="currentColor" /> Démarrer le chrono</>
              ) : generationStopped ? (
                'Aucune carte disponible'
              ) : (
                <span className="animate-pulse">Préparation des cartes…</span>
              )}
            </button>
            <p className="mt-4 text-xs text-muted">
              <kbd>Espace</kbd> pour démarrer · {queue.length} carte{queue.length > 1 ? 's' : ''} prête{queue.length > 1 ? 's' : ''}
              {wordsQueue.length > 0 && !generationStopped && ` · ${wordsQueue.length} en préparation`}
            </p>
            {waitingForGeneration && (
              <p className="mt-2 text-sm text-cream/80" aria-live="polite">{generationStatus}</p>
            )}
            {apiError && generationStopped && wordsQueue.length > 0 && (
              <div className="mt-4 rounded-xl bg-bad/10 p-3 text-left text-sm text-bad">
                <strong>Gemini n’a pas pu préparer les cartes.</strong> {apiError}{' '}
                {queue.length > 0 ? 'La partie continue avec les cartes déjà prêtes.' : 'Aucune carte n’est prête : corrigez la clé ou importez des cartes.'}
                <button onClick={retryGeneration} className="ml-2 inline-flex items-center gap-1 font-bold underline"><RotateCw size={14} /> Réessayer</button>
              </div>
            )}
          </motion.div>
        )}

        {/* Pendant le tour */}
        {phase === 'playing' && (
          <div className="flex w-full max-w-5xl flex-col items-center gap-5">
            <div className="flex w-full items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-cream/60">Score du tour</div>
                <div className={`font-mono text-4xl font-bold sm:text-5xl ${turnScore < 0 ? 'text-[#f5a779]' : 'text-mint'}`}>
                  {turnScore > 0 ? '+' : ''}{turnScore}
                </div>
              </div>
              <TimerRing remaining={timeRemaining} total={turnDuration} />
              <div className="hidden text-right sm:block">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-cream/60">Équipe</div>
                <div className="flex items-center justify-end gap-2 font-serif text-xl font-bold sm:text-2xl">
                  <span className="h-3 w-3 rounded-full" style={{ background: currentTeam.color }} />
                  {currentTeam.name}
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col gap-4 md:flex-row md:items-stretch">
              {/* La carte */}
              <div className="relative flex min-h-[360px] flex-1 [perspective:1200px] sm:min-h-[420px]">
                <AnimatePresence mode="wait">
                  {currentCard ? (
                    <motion.article
                      key={currentCard.targetWord + played.length}
                      initial={{ rotateY: -70, opacity: 0 }}
                      animate={{ rotateY: 0, opacity: 1 }}
                      exit={{ rotateY: 70, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="flex w-full flex-col overflow-hidden rounded-3xl border-[6px] border-accent bg-cream text-ink shadow-2xl"
                    >
                      <div className="bg-deep px-6 py-5 text-center sm:py-7">
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-mint/80">Faites deviner</div>
                        <h2 className="mt-2 break-words font-serif text-4xl font-bold leading-tight text-cream sm:text-5xl lg:text-6xl">
                          {currentCard.targetWord}
                        </h2>
                      </div>
                      <div className="flex items-center justify-center gap-2 border-b border-line py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-bad">
                        <Ban size={14} /> Mots interdits
                      </div>
                      <ul className="flex flex-1 flex-col justify-evenly px-6 py-3">
                        {currentCard.tabooWords.map((w, i) => (
                          <li key={i} className="border-b border-dashed border-line py-1.5 text-center text-2xl font-bold last:border-0 sm:text-3xl">
                            {w}
                          </li>
                        ))}
                      </ul>
                    </motion.article>
                  ) : (
                    <div className="flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-cream/25 p-8 text-center">
                      {apiError ? (
                        <>
                          <span className="font-bold text-[#f5a779]">La génération des cartes a échoué.</span>
                          <span className="mt-2 max-h-32 w-full overflow-y-auto break-words rounded bg-black/20 p-2 text-left text-xs text-cream/80">{apiError}</span>
                          {generationStopped ? (
                            <button onClick={retryGeneration} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cream px-4 py-2 font-bold text-ink"><RotateCw size={16} /> Réessayer</button>
                          ) : (
                            <span className="mt-3 text-sm text-cream/70">Nouvel essai dans quelques secondes… Le chrono est en pause.</span>
                          )}
                        </>
                      ) : (
                        <span className="text-cream/80" aria-live="polite">
                          <span className="animate-pulse">Préparation des cartes… Le chrono est en pause.</span>
                          {waitingForGeneration && <span className="mt-2 block text-sm text-cream/70">{generationStatus}</span>}
                        </span>
                      )}
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Boutons : sous la carte sur téléphone, à côté sur grand écran */}
              <div className="grid grid-cols-3 gap-3 md:w-52 md:grid-cols-1">
                <button onClick={() => handleAction(1)} disabled={!currentCard} className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-good px-2 py-4 font-bold text-white shadow-lg transition-transform hover:brightness-110 active:scale-95 disabled:opacity-40 md:flex-1">
                  <CheckCircle2 size={30} />
                  <span>Trouvé ! +1</span>
                  <kbd className="hidden md:inline">Espace</kbd>
                </button>
                <button onClick={() => handleAction(-1)} disabled={!currentCard} className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-bad px-2 py-4 font-bold text-white shadow-lg transition-transform hover:brightness-110 active:scale-95 disabled:opacity-40 md:flex-1">
                  <Ban size={30} />
                  <span>Tabou ! −1</span>
                  <kbd className="hidden md:inline">X</kbd>
                </button>
                <button onClick={() => handleAction(0)} disabled={!currentCard} className="flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-cream/10 px-2 py-4 font-bold text-cream transition-transform hover:bg-cream/20 active:scale-95 disabled:opacity-40 md:flex-1">
                  <SkipForward size={30} />
                  <span>Passer 0</span>
                  <kbd className="hidden md:inline">P</kbd>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mots non trouvés : récupération par les autres équipes */}
        {phase === 'review' && (
          <div className="flex w-full max-w-3xl flex-col items-center">
            <h2 className="text-center font-serif text-3xl font-bold sm:text-4xl">Temps écoulé !</h2>
            <p className="mt-2 text-center text-cream/75">
              {currentTeam.name} marque <strong className="text-cream">{turnScore > 0 ? '+' : ''}{turnScore} pt{Math.abs(turnScore) > 1 ? 's' : ''}</strong>.
              {teams.length > 1 ? ' Les autres équipes peuvent récupérer les mots non trouvés.' : ' Voici les mots non trouvés.'}
            </p>
            <div className="mt-6 flex w-full flex-wrap justify-center gap-2 rounded-3xl bg-cream p-5 text-ink sm:p-7">
              {turnMissed.map((c) => (
                <span key={c.targetWord} className="rounded-xl border border-line bg-white px-4 py-2 font-serif text-xl font-bold sm:text-2xl">
                  {c.targetWord}
                </span>
              ))}
            </div>
            {teams.length > 1 && (
              <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
                {teams.map((team, idx) =>
                  idx === currentTeamIndex ? null : (
                    <div key={team.id} className="flex items-center justify-between gap-2 rounded-2xl bg-cream/10 p-3">
                      <button onClick={() => adjustScore(idx, -1)} className="grid h-12 w-12 place-items-center rounded-xl bg-bad/80 text-2xl font-bold text-white active:scale-95" aria-label={`Retirer un point à ${team.name}`}>−</button>
                      <div className="flex flex-col items-center">
                        <span className="flex items-center gap-2 font-bold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: team.color }} />{team.name}</span>
                        <span className="font-mono text-lg">{team.score} pts</span>
                      </div>
                      <button onClick={() => adjustScore(idx, 1)} className="grid h-12 w-12 place-items-center rounded-xl bg-good text-2xl font-bold text-white active:scale-95" aria-label={`Ajouter un point à ${team.name}`}>+</button>
                    </div>
                  ),
                )}
              </div>
            )}
            <button onClick={() => setPhase('turnEnd')} className="mt-8 rounded-2xl bg-accent px-8 py-4 text-lg font-bold text-white shadow-lg hover:bg-accent-dark active:scale-95">
              Continuer
            </button>
          </div>
        )}

        {/* Fin du tour */}
        {phase === 'turnEnd' && (
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-3xl bg-cream p-8 text-center text-ink shadow-2xl sm:p-12">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-muted">Fin du tour · {currentTeam.name}</p>
            <div className={`my-6 font-mono text-6xl font-bold ${turnScore < 0 ? 'text-bad' : 'text-good'}`}>
              {turnScore > 0 ? '+' : ''}{turnScore} pt{Math.abs(turnScore) > 1 ? 's' : ''}
            </div>
            <p className="text-lg text-muted">
              Total : <strong className="text-ink">{currentTeam.score} pt{Math.abs(currentTeam.score) > 1 ? 's' : ''}</strong>
            </p>
            <button onClick={nextTeam} className="mt-8 w-full rounded-2xl bg-deep py-4 text-xl font-bold text-cream hover:bg-deeper active:scale-95">
              {teams.length > 1 ? `Au tour de ${teams[(currentTeamIndex + 1) % teams.length].name}` : 'Tour suivant'}
            </button>
          </motion.div>
        )}
      </main>
    </div>
  );
}
