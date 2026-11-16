// Copie la version construite (dist/) dans le site Le Prof et l'IA, sous dist/tabou/.
// Usage : npm run build && node scripts/publier-site.mjs "<dossier du site>"
// Puis, dans le dossier du site : python outils/seo.py, commit, push et publication.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const site = process.argv[2];
if (!site) {
  console.error('Indiquez le dossier du site : node scripts/publier-site.mjs "<dossier du site>"');
  process.exit(1);
}
const source = resolve('dist');
const cible = join(resolve(site), 'dist', 'tabou');
if (!existsSync(join(source, 'index.html'))) {
  console.error('dist/index.html introuvable : lancez d’abord npm run build.');
  process.exit(1);
}
if (!existsSync(join(resolve(site), 'outils', 'seo.py'))) {
  console.error(`${site} ne ressemble pas au dossier du site (outils/seo.py introuvable).`);
  process.exit(1);
}

// On vide l'ancienne version : les noms des fichiers JS/CSS changent à chaque construction.
rmSync(cible, { recursive: true, force: true });
mkdirSync(cible, { recursive: true });
cpSync(source, cible, { recursive: true });
console.log(`Application copiée dans ${cible}`);
