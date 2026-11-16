/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import SetupScreen from './components/SetupScreen';
import GameScreen from './components/GameScreen';
import ResultScreen from './components/ResultScreen';
import { GamePhase, Level, Team, AudioAssets } from './types';

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('setup');
  const [level, setLevel] = useState<Level>('A1');
  const [teams, setTeams] = useState<Team[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [audioAssets, setAudioAssets] = useState<AudioAssets>({});
  const [apiKeys, setApiKeys] = useState<string[]>([]);

  const handleStartGame = (
    selectedLevel: Level,
    newTeams: Team[],
    importedWords: string[],
    assets: AudioAssets,
    customApiKeys: string[]
  ) => {
    setLevel(selectedLevel);
    setTeams(newTeams);
    setWords(importedWords);
    setAudioAssets(assets);
    setApiKeys(customApiKeys);
    setPhase('playing');
  };

  const handleEndGame = (finalTeams: Team[]) => {
    setTeams(finalTeams);
    setPhase('results');
  };

  const handleRestart = () => {
    setPhase('setup');
    setTeams([]);
    setWords([]);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans selection:bg-blue-500/30">
      {phase === 'setup' && (
        <SetupScreen onStart={handleStartGame} />
      )}
      {phase === 'playing' && (
        <GameScreen 
          level={level} 
          teams={teams} 
          initialWords={words} 
          audioAssets={audioAssets}
          apiKeys={apiKeys}
          onEnd={handleEndGame} 
        />
      )}
      {phase === 'results' && (
        <ResultScreen teams={teams} onRestart={handleRestart} />
      )}
    </div>
  );
}
