# Le tabou du français

Jeu de Tabou pour la classe de FLE, en ligne sur <https://leprofetlia.com/tabou/>.

L’application tourne entièrement dans le navigateur : il n’y a pas de serveur.

- **Cartes préparées ailleurs** : l’application fournit une consigne à coller dans ChatGPT, Claude, Le Chat, Copilot ou Gemini, puis lit la réponse (texte collé, fichier `.txt`, `.csv`, `.tsv` ou `.json`).
- **Cartes générées par Gemini** : avec la clé de l’enseignant, enregistrée dans son navigateur et envoyée seulement à Google.
- Les deux sources se combinent. Les jeux de cartes s’enregistrent dans le navigateur ou se téléchargent en `.txt`.

## Format des cartes

Une carte par ligne :

```
la boulangerie : pain, baguette, croissant, boulanger, magasin
l’arc-en-ciel : pluie, soleil, couleurs, arc, sept
```

Sont aussi acceptés : colonnes copiées d’un tableur (mot cible dans la première colonne), CSV, et JSON
(`[{"targetWord": "…", "tabooWords": ["…"]}]`, ou les clés françaises `mot` et `tabous`).

## Travailler en local

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint       # vérification TypeScript
npm run build      # version de production dans dist/
```

## Publier sur leprofetlia.com

```bash
npm run build
node scripts/publier-site.mjs "C:/Users/David/OneDrive/Documents/FLE/Sites Web/le-prof-et-ia"
```

Puis, dans le dossier du site : `python outils/seo.py`, commit sur `main`, `git push origin main`,
et `git subtree push --prefix dist origin publication` (Hostinger publie la branche `publication`).

## Raccourcis pendant le jeu

| Touche | Action |
| --- | --- |
| Espace ou Entrée | Démarrer le chrono / Trouvé (+1) |
| X | Mot tabou prononcé (−1) |
| P ou → | Passer (0) |
