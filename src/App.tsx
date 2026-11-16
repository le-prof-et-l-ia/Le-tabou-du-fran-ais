/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import SetupScreen from './components/SetupScreen';
import GameScreen from './components/GameScreen';
import ResultScreen from './components/ResultScreen';
import { GameConfig, GamePhase, QuestionData, Team } from './types';

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('setup');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [finalTeams, setFinalTeams] = useState<Team[]>([]);
  const [missed, setMissed] = useState<QuestionData[]>([]);
  const [played, setPlayed] = useState<QuestionData[]>([]);

  const handleStart = (c: GameConfig) => {
    setConfig(c);
    setPhase('playing');
    window.scrollTo(0, 0);
  };

  const handleEnd = (teams: Team[], missedCards: QuestionData[], playedCards: QuestionData[]) => {
    setFinalTeams(teams);
    setMissed(missedCards);
    setPlayed(playedCards);
    setPhase('results');
  };

  const handleRestart = () => {
    setPhase('setup');
    setFinalTeams([]);
    setMissed([]);
    setPlayed([]);
  };

  return (
    <div className="min-h-screen bg-paper text-ink font-sans selection:bg-accent/25">
      {phase === 'setup' && <SetupScreen onStart={handleStart} previous={config} />}
      {phase === 'playing' && config && <GameScreen config={config} onEnd={handleEnd} />}
      {phase === 'results' && (
        <ResultScreen teams={finalTeams} missed={missed} played={played} onRestart={handleRestart} />
      )}
    </div>
  );
}
