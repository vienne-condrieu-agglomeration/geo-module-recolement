# CLAUDE.md — geo-recolement

Module d'extension de la plateforme GEO (Business Geografic), en JavaScript avec Angular et OpenLayers fournis par GEO. Lire d'abord [GUIDE-DEV.md](GUIDE-DEV.md)
(métier, données, essais), [README.md](README.md) (fonctionnement) et [CONTRIBUTING.md](CONTRIBUTING.md). Si le skill `geo-api` est installé, le consulter avant de toucher à l'API GEO ;
en cas de contradiction, ce qui a été constaté dans un vrai GEO prime sur la documentation.

## Accompagner le contributeur

Le contributeur peut débuter avec git et connaît souvent mieux le métier que le code. Gérer git à sa place, expliquer en français et sans jargon ce qui va se passer, et lui faire
confirmer toute action visible par d'autres (push, PR). Il travaille souvent sous Windows : donner les commandes pour PowerShell, sans chemin ni commande propres à Linux.

Cycle d'un changement :

1. Partir de `main` à jour, sur une nouvelle branche (`fix/...`, `feat/...`) : un sujet par branche, de préférence petit.
2. Modifier, lancer `npm test`, puis `npm run package`.
3. **Attendre l'essai dans un vrai GEO et le résultat donné par le contributeur** avant de commiter.
4. Commiter avec signature (`git commit -s`), pousser la branche, ouvrir une PR indiquant ce qui est validé dans GEO et ce qui ne l'est pas.

## Interdits

- **Aucun plan réel ni donnée qui en provient** dans un fichier, un commit, une issue ou une PR : le dépôt est public (voir GUIDE-DEV.md). Avant chaque commit, relire `git status` et le diff dans cet esprit.
  Si une telle donnée est déjà poussée : s'arrêter et dire au contributeur de prévenir le mainteneur.
- Aucun push sur `main`, aucun force push sur `main`, aucun tag, aucune release : la fusion et la publication reviennent au mainteneur.
- Ne pas changer le numéro de version : le mainteneur le fixe à la publication. Décrire le changement sous `## [Non publié]` de `CHANGELOG.md`.
- Pas de jeton ni de secret dans le code, pas de lien `Claude-Session` dans un commit (la publication serait refusée).
- Ne pas commencer l'écriture en base patrimoniale sans décision du mainteneur.
- Ne pas modifier `src/js/changelog.js`, `scripts/check-version.js` ni `test/changelog.test.mjs`, qui viennent du gabarit commun : le signaler au mainteneur.

## Commits et langue

Conventional Commits : `<type>(geo-recolement): <description>` en français, à l'impératif, sans majuscule initiale ni point final, 72 caractères au plus (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`).
Pour un `fix`, le corps donne le symptôme, la cause, la correction, et ce qui est validé dans GEO ou non. Dans le code, commentaires en français et identifiants en anglais ; textes affichés en français ; classes CSS préfixées `geo-recolement-`.

## Architecture

Sans DOM et testés seuls : `dxf-blocks.js`, `trades.js`, `network.js`, `model.js`, `diagnostic.js`, `mapping.js`, `charte.js`. `extension.js` ne contient que la carte et le panneau.
Garder cette séparation : toute règle métier nouvelle va dans un module sans DOM, avec un test écrit sur des données fictives.

## Pièges GEO

- Notation tableau obligatoire pour toute injection Angular (`['$injector', function ($injector) {…}]`), sinon `Unknown provider: eProvider` après minification.
- `window.geo` n'est pas l'API GEO dans un module déployé. Carte principale : `$injector.get('acfMapService').getMapViewImmediate().getNativeMap()`.
- Lire la configuration et la carte dans `geoApplication.executeWhenInitialized`, enregistrer l'interface une seule fois.
- Ne déclarer que `bg.acf.base` en dépendance : `bg.common.geo.GeoApi` absent bloque toute l'application ; obtenir `geoApplication` par `$injector`.
- GEO échoue souvent en silence : `console.error` dans chaque branche de repli.
- À la fermeture : désabonner les observables, retirer listeners et éléments du DOM.
- Réglages `ENUMERATED` : le Générateur ignore `labels`, mettre le texte lisible dans `values`.
- Icônes : toujours `class="icon icon_xxx"`.
