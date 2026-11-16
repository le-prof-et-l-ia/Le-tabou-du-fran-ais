import { useState } from 'react';
import { Check, ClipboardCopy, Download, RotateCcw, Trophy } from 'lucide-react';
import { QuestionData, Team } from '../types';
import { cardsToText, downloadText } from '../lib/cards';
import SiteHeader from './SiteHeader';

interface ResultScreenProps {
  teams: Team[];
  missed: QuestionData[];
  played: QuestionData[];
  onRestart: () => void;
}

const pts = (n: number) => `${n} pt${Math.abs(n) > 1 ? 's' : ''}`;

export default function ResultScreen({ teams, missed, played, onRestart }: ResultScreenProps) {
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  const best = sorted[0]?.score;
  const winners = sorted.filter((t) => t.score === best);
  const [copied, setCopied] = useState(false);

  const copyMissed = async () => {
    try {
      await navigator.clipboard.writeText(missed.map((c) => c.targetWord).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* presse-papiers refusé */
    }
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="text-center">
          <Trophy className="mx-auto text-accent" size={48} />
          <h1 className="mt-3 font-serif text-4xl font-bold sm:text-5xl">Fin de la partie</h1>
          {teams.length > 1 && (
            <p className="mt-3 text-lg text-muted">
              {winners.length > 1 ? 'Égalité entre ' + winners.map((w) => w.name).join(' et ') : `Victoire de ${winners[0]?.name}`} avec {pts(best ?? 0)}.
            </p>
          )}
        </div>

        <ol className="mt-10 space-y-3">
          {sorted.map((team, i) => {
            const first = team.score === best;
            return (
              <li
                key={team.id}
                className={`flex items-center justify-between gap-4 rounded-2xl border p-4 sm:p-5 ${first ? 'border-accent bg-cream shadow-sm' : 'border-line bg-cream/60'}`}
              >
                <div className="flex items-center gap-4">
                  <span className={`grid h-11 w-11 place-items-center rounded-full font-serif text-xl font-bold ${first ? 'bg-accent text-white' : 'bg-line text-ink'}`}>
                    {sorted.findIndex((t) => t.score === team.score) + 1}
                  </span>
                  <span className="flex items-center gap-2 font-serif text-2xl font-bold">
                    <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />
                    {team.name}
                  </span>
                </div>
                <span className="font-mono text-2xl font-bold">{pts(team.score)}</span>
              </li>
            );
          })}
        </ol>

        {missed.length > 0 && (
          <section className="mt-10 rounded-2xl border border-line bg-cream p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-2xl font-bold">À revoir</h2>
                <p className="text-sm text-muted">
                  {missed.length} mot{missed.length > 1 ? 's' : ''} non trouvé{missed.length > 1 ? 's' : ''} sur {played.length} carte{played.length > 1 ? 's' : ''} jouée{played.length > 1 ? 's' : ''}.
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={copyMissed} className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold hover:border-ink">
                  {copied ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied ? 'Copié' : 'Copier'}
                </button>
                <button
                  onClick={() => downloadText('tabou-mots-a-revoir.txt', cardsToText(missed))}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold hover:border-ink"
                  title="Les cartes, réimportables pour une prochaine partie"
                >
                  <Download size={16} /> Cartes .txt
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {missed.map((c) => (
                <span key={c.targetWord} className="rounded-lg border border-line bg-white px-3 py-1.5 font-serif text-lg font-bold">
                  {c.targetWord}
                </span>
              ))}
            </div>
          </section>
        )}

        <button onClick={onRestart} className="mt-10 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-deep py-4 text-xl font-bold text-cream hover:bg-deeper">
          <RotateCcw size={20} /> Nouvelle partie
        </button>
      </main>
    </>
  );
}
