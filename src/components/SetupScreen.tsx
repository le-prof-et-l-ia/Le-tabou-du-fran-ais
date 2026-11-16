import { useState, useRef } from 'react';
import { Level, Team, AudioAssets } from '../types';

interface SetupScreenProps {
  onStart: (level: Level, teams: Team[], words: string[], assets: AudioAssets, apiKeys: string[]) => void;
}

export default function SetupScreen({ onStart }: SetupScreenProps) {
  const [level, setLevel] = useState<Level>('A1');
  const [teamCount, setTeamCount] = useState<number>(1);
  const [wordsInput, setWordsInput] = useState<string>('');
  const [apiKeysInput, setApiKeysInput] = useState<string>(() => {
    return localStorage.getItem('taboo_api_keys') || '';
  });
  const [error, setError] = useState<string>('');

  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [successFile, setSuccessFile] = useState<File | null>(null);
  const [failFile, setFailFile] = useState<File | null>(null);

  const handleStart = () => {
    // Process words (supports newlines, commas, slashes, semicolons, dots, dashes/hyphens)
    const parsedWords = wordsInput
      .split(/[\n\r,\/;\.–—\-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    if (parsedWords.length < 8) {
      setError('Veuillez entrer au moins 8 mots pour jouer.');
      return;
    }

    // Process API Keys
    const parsedApiKeys = apiKeysInput
      .split(/[\r\n]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    // Save API keys in local storage
    localStorage.setItem('taboo_api_keys', apiKeysInput);

    // Generate teams
    const newTeams: Team[] = Array.from({ length: teamCount }).map((_, i) => ({
      id: `team-${i}`,
      name: `Équipe ${String.fromCharCode(65 + i)}`,
      score: 0,
    }));

    const audioAssets: AudioAssets = {};
    if (bgmFile) audioAssets.bgm = URL.createObjectURL(bgmFile);
    if (successFile) audioAssets.success = URL.createObjectURL(successFile);
    if (failFile) audioAssets.fail = URL.createObjectURL(failFile);

    onStart(level, newTeams, parsedWords, audioAssets, parsedApiKeys);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-b from-blue-900 to-indigo-950">
      <div className="w-full max-w-2xl p-8 bg-slate-800/80 backdrop-blur-md rounded-2xl shadow-2xl border border-blue-500/30">
        <h1 className="text-4xl md:text-5xl font-extrabold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-8 drop-shadow-sm">
          Tabou du Français
        </h1>

        <div className="space-y-6">
          {/* Level Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300 uppercase tracking-wider">
              Niveau (CECRL)
            </label>
            <div className="grid grid-cols-4 gap-4">
              {(['A1', 'A2', 'B1', 'B2'] as Level[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`py-3 px-4 rounded-xl font-bold transition-all duration-200 ${
                    level === l
                      ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)] border-2 border-blue-400'
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600 border-2 border-transparent'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Teams Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300 uppercase tracking-wider">
              Nombre d'équipes
            </label>
            <div className="grid grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5].map((num) => (
                <button
                  key={num}
                  onClick={() => setTeamCount(num)}
                  className={`py-3 px-4 rounded-xl font-bold transition-all duration-200 ${
                    teamCount === num
                      ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)] border-2 border-blue-400'
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600 border-2 border-transparent'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Audio Inputs */}
          <div className="space-y-4 pt-4 border-t border-slate-700/50">
            <h2 className="text-lg font-bold text-slate-200">Sons (Optionnel)</h2>
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-sm text-slate-400 w-1/3">Musique de fond</label>
                <input 
                  type="file" 
                  accept="audio/mp3,audio/mpeg" 
                  onChange={(e) => setBgmFile(e.target.files?.[0] || null)}
                  className="w-2/3 text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-sm text-slate-400 w-1/3">Bonne réponse</label>
                <input 
                  type="file" 
                  accept="audio/mp3,audio/mpeg,audio/wav" 
                  onChange={(e) => setSuccessFile(e.target.files?.[0] || null)}
                  className="w-2/3 text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-700"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-sm text-slate-400 w-1/3">Mauvaise réponse</label>
                <input 
                  type="file" 
                  accept="audio/mp3,audio/mpeg,audio/wav" 
                  onChange={(e) => setFailFile(e.target.files?.[0] || null)}
                  className="w-2/3 text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700"
                />
              </div>
            </div>
          </div>

          {/* API Keys Input */}
          <div className="space-y-2 pt-4 border-t border-slate-700/50">
            <label className="block text-sm font-medium text-slate-300 uppercase tracking-wider flex flex-col sm:flex-row sm:justify-between gap-1">
              <span>Clés API Gemini (Optionnel)</span>
              <span className="text-slate-400 text-xs normal-case">Une clé par ligne (rotation si quota épuisé)</span>
            </label>
            <textarea
              value={apiKeysInput}
              onChange={(e) => {
                setApiKeysInput(e.target.value);
                localStorage.setItem('taboo_api_keys', e.target.value);
              }}
              rows={3}
              className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-xs"
              placeholder="AIzaSy...&#10;AIzaSy..."
            />
          </div>

          {/* Vocabulary Input */}
          <div className="space-y-2 pt-4 border-t border-slate-700/50">
            <label className="block text-sm font-medium text-slate-300 uppercase tracking-wider flex justify-between">
              <span>Mots à deviner</span>
              <span className="text-slate-500 text-xs normal-case">Séparés par des virgules, tirets (-), slashes (/) ou retours à la ligne</span>
            </label>
            <textarea
              value={wordsInput}
              onChange={(e) => {
                setWordsInput(e.target.value);
                setError('');
              }}
              rows={6}
              className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Ex: pomme - ordinateur, voyager / magnifique..."
            />
          </div>

          {error && <p className="text-red-400 text-sm font-medium text-center">{error}</p>}

          <button
            onClick={handleStart}
            className="w-full py-4 mt-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold text-xl rounded-xl shadow-lg transition-transform active:scale-[0.98]"
          >
            Commencer le jeu
          </button>
        </div>
      </div>
    </div>
  );
}
