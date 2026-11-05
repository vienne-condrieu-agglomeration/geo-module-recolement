# geo-recolement : guide de développement

Ce qu'il faut savoir pour faire évoluer le module et que le code ne dit pas. Le fonctionnement et les règles de lecture du plan sont dans le
[README](README.md), la manière de proposer un changement dans [CONTRIBUTING.md](CONTRIBUTING.md).

Toute découverte durable (règle métier, piège, résultat d'essai) s'ajoute ici : c'est ce qui la rend disponible aux autres contributeurs.

## Objectif

Vérifier et comprendre un plan de récolement DXF conforme au CCTP du marché de topographie, en lui appliquant une analyse SIG structurée, sans rien écrire.
L'objectif final est d'alimenter la base patrimoniale eau et assainissement à partir de récolements conformes. Cette intégration en base est
**volontairement différée** : elle ne se commence pas sans décision du mainteneur.

## Ce que le plan de test a appris

Plan réel du marché, non versionné. Ces constats ne valent que pour lui : un autre plan peut les contredire.

- **Le plan dessine des amorces, pas le réseau.** Longueur médiane d'environ 2,6 m ; 249 canalisations d'eaux usées sur 255 ont un bout libre.
  La reconstitution des tronçons est donc le cœur du sujet.
- **La pente ne prouve pas un tronçon.** Sur le plan de test, 50 à 56 % des couples d'amorces pris sans condition d'alignement la respectent. Ne jamais présenter
  « cotes cohérentes » comme une confirmation : seule la géométrie (bâtiments traversés, croisements) permet d'écarter un tronçon, et même un tronçon
  probable reste une déduction à confirmer.
- **Tous les réseaux ne portent pas d'information.** Les attributs d'eau potable existent mais sont vides ; éclairage, voirie et réseaux tiers n'ont pas d'attribut.
  La charte (155 calques) prévoit pourtant des tracés pour tous les réseaux : le code reste générique, et ces cas ne sont essayés que sur des données synthétiques.

## Données : la règle à ne pas casser

Le dépôt est **public** et ce qui y est poussé y reste, même après suppression. Plans, CCTP et charte sont transmis hors de git.

- Ne jamais commiter un DXF, un DWG, ni ce qui vient d'un plan réel : numéro de regard, cote, adresse, coordonnées, nom de fichier ou numéro de dossier.
- Pour garder ces fichiers à portée de main, créer un dossier `tmp/` à la racine du dépôt : git l'ignore entièrement.
- Ne pas ajouter au dépôt le CCTP, la charte ni un autre document du marché. Leurs formats (`.doc`, `.docx`, `.pdf`) sont ignorés par git, comme les plans ; ne pas forcer leur ajout avec `git add -f`.
- Dans le code, les tests et les messages de commit, n'écrire que des comptages globaux ou des valeurs fictives.
- Les issues et les PR sont publiques elles aussi : pas de capture d'un plan réel.
- Si un plan réel a été poussé par erreur, **s'arrêter et prévenir aussitôt le mainteneur** : un nouveau commit qui supprime le fichier ne le retire pas de l'historique.

## Lancer les tests

```bash
npm install
npm test
```

Sans plan réel, les tests utilisent de petits jeux écrits dans le code et affichent `plan réel absent : test ignoré`. Pour les lancer aussi sur le plan du marché,
le déposer dans `tmp/` et donner son chemin :

```bash
GEO_RECOLEMENT_PLAN=tmp/plan.dxf npm test                  # bash (Git Bash, Linux)
```
```powershell
$env:GEO_RECOLEMENT_PLAN = "tmp\plan.dxf"; npm test        # PowerShell
```

Ce test compare des comptages exacts du plan de test : un autre plan le fera échouer sans que le code soit en cause.

## Essayer dans GEO

`npm test` ne remplace pas l'essai dans GEO : le rendu du panneau, le cadrage et la version d'OpenLayers ne se vérifient que là.

1. `npm run package` produit `geo-recolement_AAAAMMJJ-HHMM.zip`. Le nom est daté parce que GEO refuse un nom de ZIP déjà importé.
2. Dans le Générateur, sur une **application de test** : **ancienne interface**, Modules > + Module, puis déposer le ZIP.
3. Ouvrir l'application, déposer un plan et noter dans la PR ce qui a été **vu dans GEO** et ce qui ne l'a pas été.

## État de la validation

Depuis la 0.3.0, les tests Node passent sur le plan de test, et le module a été manipulé dans un banc navigateur simulant GEO.
La vignette a été vue dans le Générateur. **Non validés** dans le dernier état connu : rendu et largeur du panneau dans GEO, cadrage, tronçons sur le terrain, insertion en table,
réseaux hors assainissement sur des données réelles. Le regard du topographe sur les tronçons reconstitués est précisément ce qui manque.
