import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, CheckCircle2, XCircle, SkipForward, Play, AlertTriangle } from 'lucide-react';
import { Level, Team, QuestionData, AudioAssets } from '../types';

interface GameScreenProps {
  level: Level;
  teams: Team[];
  initialWords: string[];
  audioAssets?: AudioAssets;
  apiKeys?: string[];
  onEnd: (teams: Team[]) => void;
}

const TURN_DURATION = 60; // seconds

const playBuzzer = (audioAssets?: AudioAssets) => {
  if (audioAssets?.fail) {
    new Audio(audioAssets.fail).play().catch(console.error);
  } else {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 1);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start();
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
      osc.stop(audioCtx.currentTime + 1);
    } catch (e) { console.error(e) }
  }
};

const playSuccess = (audioAssets?: AudioAssets) => {
  if (audioAssets?.success) {
    new Audio(audioAssets.success).play().catch(console.error);
  } else {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.setValueAtTime(800, audioCtx.currentTime + 0.1);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start();
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) { console.error(e) }
  }
};

const shuffleArray = <T,>(arr: T[]): T[] => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export default function GameScreen({ level, teams: initialTeams, initialWords, audioAssets, apiKeys, onEnd }: GameScreenProps) {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [currentTeamIndex, setCurrentTeamIndex] = useState(0);
  
  // Shuffle words once at start
  const [wordsQueue, setWordsQueue] = useState<string[]>(() => shuffleArray(initialWords));

  // Pool of all successfully generated cards for recycling
  const [cardPool, setCardPool] = useState<QuestionData[]>([]);
  const [prefetchedCards, setPrefetchedCards] = useState<QuestionData[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  
  const [isTurnActive, setIsTurnActive] = useState(false);
  const [isStealPhase, setIsStealPhase] = useState(false);
  const [isTurnOver, setIsTurnOver] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(TURN_DURATION);
  const [turnScore, setTurnScore] = useState(0);
  
  const [missedCards, setMissedCards] = useState<QuestionData[]>([]);

  const currentTeam = teams[currentTeamIndex];
  
  // prefetchedCards[0] is ALWAYS the card currently being played.
  const currentCard = prefetchedCards[0] || null;

  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const turnStateRef = useRef({ turnScore, missedCards });
  const prefetchedCardsRef = useRef(prefetchedCards);

  useEffect(() => {
    turnStateRef.current = { turnScore, missedCards };
  }, [turnScore, missedCards]);

  useEffect(() => {
    prefetchedCardsRef.current = prefetchedCards;
  }, [prefetchedCards]);

  // Audio BGM setup
  useEffect(() => {
    if (audioAssets?.bgm) {
      bgmRef.current = new Audio(audioAssets.bgm);
      bgmRef.current.loop = true;
      bgmRef.current.volume = 0.1;
    }
    return () => {
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current.src = '';
      }
    };
  }, [audioAssets?.bgm]);

  useEffect(() => {
    if (bgmRef.current) {
      if (isTurnActive) {
        bgmRef.current.play().catch(e => console.error("Audio play failed:", e));
      } else {
        bgmRef.current.pause();
      }
    }
  }, [isTurnActive]);

  // Fetching Logic
  const fetchBatch = useCallback(async () => {
    if (isFetching || wordsQueue.length === 0) return;
    
    setIsFetching(true);
    setApiError(null);
    
    // Fetch 20 words at a time
    const batchSize = Math.min(20, wordsQueue.length);
    const targetWords = wordsQueue.slice(0, batchSize);
    
    try {
      const res = await fetch('/api/generate-taboo-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWords,
          level,
          apiKeys,
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `Erreur API: ${res.status}`);
      }
      const data = await res.json();
      
      if (data.cards && Array.isArray(data.cards)) {
        const validCards = (data.cards as QuestionData[]).filter(
          c => c && c.targetWord && Array.isArray(c.tabooWords)
        );

        setCardPool(prev => {
          const existingWords = new Set(prev.map(c => c.targetWord.trim().toLowerCase()));
          const newCards = validCards.filter(
            c => !existingWords.has(c.targetWord.trim().toLowerCase())
          );
          return [...prev, ...newCards];
        });

        setPrefetchedCards(prev => {
          const existingWords = new Set(prev.map(c => c.targetWord.trim().toLowerCase()));
          const newUniqueCards = validCards.filter(
            c => !existingWords.has(c.targetWord.trim().toLowerCase())
          );
          return [...prev, ...newUniqueCards];
        });
        setWordsQueue(prev => prev.slice(batchSize));
      }
    } catch (error: any) {
      console.error(error);
      setApiError(error.message || "Erreur de connexion");
      // Wait 5 seconds before allowing another fetch attempt to prevent spamming
      await new Promise(r => setTimeout(r, 5000));
    } finally {
      setIsFetching(false);
    }
  }, [isFetching, wordsQueue, level, apiKeys]);

  // Auto-fetch or auto-recycle if prefetched list is low
  useEffect(() => {
    if (prefetchedCards.length < 3) {
      if (wordsQueue.length > 0 && !isFetching) {
        fetchBatch();
      } else if (wordsQueue.length === 0 && initialWords.length > 0) {
        // Words list is exhausted -> recycle previously generated cards or refill wordsQueue
        if (cardPool.length > 0) {
          setPrefetchedCards(prev => {
            const currentWords = new Set(prev.map(c => c.targetWord.trim().toLowerCase()));
            const availableToRecycle = cardPool.filter(c => !currentWords.has(c.targetWord.trim().toLowerCase()));
            
            if (availableToRecycle.length > 0) {
              return [...prev, ...shuffleArray(availableToRecycle)];
            } else {
              // All cards are currently in queue, append a fresh shuffled copy
              return [...prev, ...shuffleArray(cardPool)];
            }
          });
        } else if (!isFetching) {
          // If no cards in pool yet, refill queue with initial words
          setWordsQueue(shuffleArray(initialWords));
        }
      }
    }
  }, [prefetchedCards.length, wordsQueue.length, isFetching, fetchBatch, cardPool, initialWords]);

  // Timer logic
  useEffect(() => {
    let timer: number;
    const isWaitingForAPI = isTurnActive && !currentCard && (isFetching || wordsQueue.length > 0);
    
    if (isTurnActive && timeRemaining > 0 && !isWaitingForAPI) {
      timer = window.setInterval(() => {
        setTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (isTurnActive && timeRemaining === 0) {
      setIsTurnActive(false);
      playBuzzer(audioAssets);
      
      const { turnScore: finalScore, missedCards: finalMissed } = turnStateRef.current;
      
      setTeams(prevTeams => {
        const newTeams = [...prevTeams];
        newTeams[currentTeamIndex].score += finalScore;
        return newTeams;
      });

      let allMissed = [...finalMissed];
      if (prefetchedCardsRef.current.length > 0) {
        const cardOnScreen = prefetchedCardsRef.current[0];
        if (cardOnScreen) {
          allMissed.push(cardOnScreen);
        }
        // Remove it from queue
        setPrefetchedCards(prev => prev.slice(1));
      }
      
      // Deduplicate allMissed by targetWord
      const uniqueMissed: QuestionData[] = [];
      const seenWords = new Set<string>();
      for (const card of allMissed) {
        if (!card || !card.targetWord) continue;
        const normalized = card.targetWord.trim().toLowerCase();
        if (!seenWords.has(normalized)) {
          seenWords.add(normalized);
          uniqueMissed.push(card);
        }
      }

      setMissedCards(uniqueMissed);

      if (uniqueMissed.length > 0) {
        setIsStealPhase(true);
      } else {
        setIsTurnOver(true);
      }
    }
    return () => clearInterval(timer);
  }, [isTurnActive, timeRemaining, currentTeamIndex, audioAssets, currentCard, wordsQueue.length, isFetching]);

  const startTurn = () => {
    setTurnScore(0);
    setTimeRemaining(TURN_DURATION);
    setIsTurnOver(false);
    setIsStealPhase(false);
    setMissedCards([]);
    setIsTurnActive(true);
  };

  const handleAction = (points: number) => {
    const card = prefetchedCards[0];
    if (!card) return;

    if (points > 0) playSuccess(audioAssets);
    else if (points < 0) playBuzzer(audioAssets);
    
    if (points <= 0) {
      setMissedCards(m => {
        if (m.some(c => c.targetWord.trim().toLowerCase() === card.targetWord.trim().toLowerCase())) {
          return m;
        }
        return [...m, card];
      });
    }

    setPrefetchedCards(prev => prev.slice(1));
    setTurnScore(prev => prev + points);
  };

  const handleAdjustScore = (teamIndex: number, delta: number) => {
    if (delta > 0) playSuccess(audioAssets);
    else if (delta < 0) playBuzzer(audioAssets);
    
    setTeams(prev => {
      const newTeams = [...prev];
      newTeams[teamIndex].score += delta;
      return newTeams;
    });
  };

  const nextTeam = () => {
    setCurrentTeamIndex(prev => (prev + 1) % teams.length);
    setIsTurnOver(false);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 font-sans relative overflow-hidden">
      
      {/* Top Header */}
      <div className="flex justify-between items-center p-3 px-6 bg-slate-800/80 backdrop-blur-sm border-b border-white/10 z-10">
        <div className="flex items-center gap-4">
          <div className="text-xl font-bold text-blue-400">
            {currentTeam.name}
          </div>
          <div className="text-base text-slate-400">
            Score total: <span className="text-white font-mono font-bold">{currentTeam.score} pts</span>
          </div>
        </div>
        
        {/* End Game Manual Button */}
        <button 
          onClick={() => onEnd(teams)}
          className="px-3 py-1.5 bg-slate-700/50 text-slate-300 hover:text-white rounded-lg transition-colors text-sm"
        >
          Terminer la partie
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10">
        
        {!isTurnActive && !isTurnOver && !isStealPhase && (
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center bg-slate-800 p-12 rounded-3xl border border-blue-500/20 shadow-2xl max-w-lg w-full text-center"
          >
            <Users size={64} className="text-blue-500 mb-6" />
            <h2 className="text-3xl font-bold text-white mb-2">Au tour de : {currentTeam.name}</h2>
            <p className="text-slate-400 mb-8">Un joueur fait deviner à son équipe. Préparez-vous !</p>
            
            <button 
              onClick={startTurn}
              disabled={prefetchedCards.length === 0 && isFetching}
              className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xl rounded-2xl shadow-lg transition-transform active:scale-95 disabled:opacity-50"
            >
              {prefetchedCards.length === 0 && isFetching ? (
                <span className="animate-pulse">Chargement des cartes...</span>
              ) : (
                <>
                  <Play size={24} />
                  Démarrer le chrono
                </>
              )}
            </button>
            <div className="mt-6 text-sm text-slate-500">
              Cartes en réserve : {prefetchedCards.length}
            </div>
          </motion.div>
        )}

        {isTurnActive && (
          <div className="w-full max-w-4xl flex flex-col items-center h-full pt-4">
            {/* Timer and Live Score */}
            <div className="flex justify-between w-full mb-6 items-end px-4">
              <div className="flex flex-col">
                <span className="text-sm text-slate-400 uppercase tracking-widest mb-1">Score du tour</span>
                <span className="text-4xl font-mono font-bold text-emerald-400">{turnScore}</span>
              </div>
              
              <div className="flex flex-col items-center">
                <div className={`text-5xl font-mono font-bold ${timeRemaining <= 10 ? 'text-red-500 animate-pulse' : 'text-blue-400'}`}>
                  {formatTime(timeRemaining)}
                </div>
              </div>
              
              <div className="flex flex-col items-end">
                <span className="text-sm text-slate-400 uppercase tracking-widest mb-1">Équipe</span>
                <span className="text-2xl font-bold text-slate-200">{currentTeam.name}</span>
              </div>
            </div>

            <div className="flex w-full gap-6 items-stretch mb-4 min-h-[400px]">
              {/* The Taboo Card */}
              <div className="flex-1 relative">
                <AnimatePresence mode="wait">
                  {currentCard ? (
                    <motion.div 
                      key={currentCard.targetWord}
                      initial={{ x: 50, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: -50, opacity: 0 }}
                      className="bg-white rounded-3xl p-8 w-full shadow-2xl flex flex-col items-center absolute inset-0 overflow-hidden"
                    >
                      {/* Target Word */}
                      <div className="bg-blue-600 w-[120%] -mt-8 py-6 mb-8 flex justify-center shadow-md">
                        <h2 className="text-4xl font-extrabold text-white tracking-tight uppercase">
                          {currentCard.targetWord}
                        </h2>
                      </div>
                      
                      {/* Taboo Words */}
                      <div className="grid grid-cols-2 gap-4 w-full px-2 flex-1">
                        {currentCard.tabooWords.map((word, idx) => (
                          <div key={idx} className="bg-slate-100 rounded-xl p-3 text-center flex items-center justify-center">
                            <span className="text-xl font-bold text-slate-800">{word}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-400 text-xl w-full h-full absolute inset-0 border-2 border-dashed border-slate-700 rounded-3xl p-8 text-center">
                      {apiError ? (
                        <>
                          <span className="text-red-400 font-bold mb-2">Erreur de connexion avec l'IA.</span>
                          <span className="text-xs text-red-300 mb-4 max-h-32 overflow-y-auto w-full break-words text-left p-2 bg-red-950/30 rounded">{apiError}</span>
                          <span className="text-sm">Génération en pause. Veuillez attendre quelques instants avant de réessayer.</span>
                        </>
                      ) : isFetching ? (
                        <span>Génération des cartes en cours...</span>
                      ) : (
                        <span>Plus de mots disponibles...</span>
                      )}
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Controls */}
              <div className="w-48 flex flex-col gap-4 shrink-0">
                <button 
                  onClick={() => handleAction(1)}
                  className="flex-1 flex flex-col items-center justify-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/50 rounded-2xl p-4 transition-colors active:scale-95"
                >
                  <CheckCircle2 size={32} />
                  <span className="font-bold">Trouvé ! (+1)</span>
                </button>
                
                <button 
                  onClick={() => handleAction(-1)}
                  className="flex-1 flex flex-col items-center justify-center gap-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/50 rounded-2xl p-4 transition-colors active:scale-95"
                >
                  <AlertTriangle size={32} />
                  <span className="font-bold">Mot Tabou (-1)</span>
                </button>
                
                <button 
                  onClick={() => handleAction(0)}
                  className="flex-1 flex flex-col items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-2xl p-4 transition-colors active:scale-95"
                >
                  <SkipForward size={32} />
                  <span className="font-bold">Passer (0)</span>
                </button>
              </div>
            </div>
            
          </div>
        )}

        {isStealPhase && (
          <div className="w-full max-w-4xl flex flex-col items-center h-full pt-4">
            <h2 className="text-3xl font-bold text-white mb-2 text-center">Mots non trouvés</h2>
            <p className="text-slate-400 mb-8 text-center">L'animateur attribue les points aux équipes qui ont récupéré les mots.</p>
            
            <div className="bg-white rounded-3xl p-8 w-full max-w-3xl shadow-2xl flex flex-col items-center relative mb-8">
              <div className="flex flex-wrap justify-center gap-4 w-full">
                {missedCards
                  .filter((card, index, self) =>
                    index === self.findIndex(c => c.targetWord.trim().toLowerCase() === card.targetWord.trim().toLowerCase())
                  )
                  .map((card, idx) => (
                    <div key={card.targetWord + '-' + idx} className="bg-blue-100 text-blue-900 border border-blue-300 rounded-xl px-6 py-3 text-2xl font-bold uppercase shadow-sm">
                      {card.targetWord}
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex flex-col gap-4 w-full max-w-xl">
              {teams.map((team, idx) => {
                if (idx === currentTeamIndex) return null; // Active team cannot steal
                return (
                  <div key={team.id} className="flex items-center justify-between bg-slate-800 border border-slate-700 p-4 rounded-2xl">
                    <button 
                      onClick={() => handleAdjustScore(idx, -1)}
                      className="w-16 h-16 flex items-center justify-center bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl font-bold text-4xl active:scale-95 transition-transform"
                    >-</button>
                    <div className="flex flex-col items-center flex-1">
                      <span className="text-2xl font-bold text-white">{team.name}</span>
                      <span className="text-slate-400 font-mono text-xl">{team.score} pts</span>
                    </div>
                    <button 
                      onClick={() => handleAdjustScore(idx, 1)}
                      className="w-16 h-16 flex items-center justify-center bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-xl font-bold text-4xl active:scale-95 transition-transform"
                    >+</button>
                  </div>
                );
              })}
            </div>
            
            <button
              onClick={() => {
                setIsStealPhase(false);
                setIsTurnOver(true);
              }}
              className="mt-8 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xl rounded-2xl shadow-lg transition-transform active:scale-95"
            >
              Terminer la phase de récupération
            </button>
          </div>
        )}

        {isTurnOver && (
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center bg-slate-800 p-12 rounded-3xl border border-blue-500/20 shadow-2xl max-w-lg w-full text-center"
          >
            <h2 className="text-4xl font-extrabold text-white mb-2">Temps écoulé !</h2>
            <div className="text-6xl font-mono font-bold text-emerald-400 my-8">
              {turnScore > 0 ? '+' : ''}{turnScore} pt{Math.abs(turnScore) > 1 ? 's' : ''}
            </div>
            <p className="text-xl text-slate-300 mb-8">
              Nouveau score : <span className="font-bold text-white">{currentTeam.score}</span>
            </p>
            
            <button 
              onClick={nextTeam}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xl rounded-2xl shadow-lg transition-transform active:scale-95"
            >
              Tour suivant
            </button>
          </motion.div>
        )}

      </div>
    </div>
  );
}
