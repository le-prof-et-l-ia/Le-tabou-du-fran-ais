import { ReactNode } from 'react';

/** Bandeau repris du site leprofetlia.com, pour que l'appli s'y intègre. */
export default function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-cream text-ink">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="https://leprofetlia.com/" className="flex items-center gap-3 no-underline" aria-label="Le Prof et l’IA, accueil du site">
          <img
            src="https://leprofetlia.com/assets/channel-avatar.jpg"
            alt=""
            width={37}
            height={37}
            className="h-[37px] w-[37px] rounded-full border border-line object-cover"
          />
          <span className="flex flex-col leading-tight">
            <span className="font-serif text-lg font-bold">
              Le Prof <em className="font-normal">et</em> l’IA
            </span>
            <span className="hidden text-[11px] uppercase tracking-[0.12em] text-muted sm:block">Outil pour la classe</span>
          </span>
        </a>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  );
}
