import { Team } from '../types';

interface ResultScreenProps {
  teams: Team[];
  onRestart: () => void;
}

export default function ResultScreen({ teams, onRestart }: ResultScreenProps) {
  // Sort teams by score descending
  const sortedTeams = [...teams].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-b from-indigo-950 to-slate-900">
      <div className="w-full max-w-3xl p-8 bg-slate-800/80 backdrop-blur-md rounded-2xl shadow-2xl border border-yellow-500/30">
        <h1 className="text-4xl md:text-5xl font-extrabold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-12 drop-shadow-sm">
          Fin de la Partie !
        </h1>

        <div className="space-y-4 mb-12">
          {sortedTeams.map((team, index) => (
            <div 
              key={team.id}
              className={`flex items-center justify-between p-6 rounded-xl ${
                index === 0 
                  ? 'bg-gradient-to-r from-yellow-500/20 to-amber-600/20 border-2 border-yellow-500/50' 
                  : 'bg-slate-700/50 border border-slate-600'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 flex items-center justify-center rounded-full font-bold text-2xl ${
                  index === 0 ? 'bg-yellow-500 text-slate-900' : 'bg-slate-600 text-slate-300'
                }`}>
                  {index + 1}
                </div>
                <h2 className="text-2xl font-bold text-slate-100">{team.name}</h2>
              </div>
              <div className="text-3xl font-mono text-amber-400 font-bold">
                {team.score} pt{team.score > 1 || team.score < -1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onRestart}
          className="w-full py-4 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xl rounded-xl transition-colors"
        >
          Nouvelle Partie
        </button>
      </div>
    </div>
  );
}
