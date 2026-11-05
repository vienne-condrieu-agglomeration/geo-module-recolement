# Journal des nouveautés

Toutes les évolutions notables du module « Récolement ». Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnement
[SemVer](https://semver.org/lang/fr/).

Ce fichier est affiché dans GEO, dans la fenêtre « Nouveautés » du panneau : il s'écrit pour les
**utilisateurs**, en français, pas pour les développeurs (la liste des commits est dans git). La version
la plus récente publiée doit être celle de `package.json` et de `src/plugin.geoext.json`
(`npm test` le vérifie).

## [Non publié]

## [0.3.1] — 2026-11-04

### Corrigé

- Générateur : le module a maintenant sa propre icône dans la liste des modules, à la place de l'icône par défaut

## [0.3.0] — 2026-11-02

Le module lit désormais tout le plan et raisonne dessus : il range son contenu par métier, reconstitue le réseau et contrôle le plan, sans rien écrire.

### Ajouté

- **Tout le plan s'affiche** : points, lignes, surfaces et textes, rangés par métier (assainissement, eau potable, éclairage
  public, voirie et mobilier, réseaux tiers, fond de plan), puis par réseau et par calque de la charte, chacun avec sa couleur
- **Panneau plus large et en onglets** : Couches, Contrôles, Patrimoine, Objet. La largeur se règle dans le Générateur
- **Du regard à la canalisation et retour** : un clic sur une canalisation donne ses deux extrémités, son sens et ses fils d'eau ; un
  clic sur un regard ou sur un symbole raccordé (avaloir, tabouret…) donne ses canalisations. Chaque extrémité est un lien vers son ouvrage
- **Tronçons reconstitués** : le plan dessine surtout des amorces de quelques mètres. Deux amorces qui se font face sont reliées
  par un tireté, toujours présenté comme une déduction à confirmer. Un tracé qui traverse un bâtiment ou en croise un plus court est
  classé « douteux » : masqué au départ et non compté dans le linéaire
- **Contrôles** : numéros de regard en double, radier au-dessus du tampon, profondeur incohérente, contre-pente, caractéristiques ou sens
  manquants, attributs vides, calques hors charte, projection différente du cartouche… Un clic les surligne sur la carte
- **Patrimoine** : regards et linéaire par réseau, par matériau et par diamètre, et bilan de ce que le module a lu ou non
- Les annotations du plan (« regard plein », « départ non visible »…) s'affichent sur l'ouvrage le plus proche

### Modifié

- Les tables cibles deviennent facultatives : sans table, le module lit et analyse le plan sans rien écrire
- Le réglage « Calque proposé par défaut » disparaît : tous les métiers s'affichent à l'ouverture du plan

### Corrigé

- Une canalisation dont l'autre extrémité n'a pas de regard perdait son sens d'écoulement dans l'arbre d'un regard ; il est maintenant indiqué

## [0.2.1] — 2026-10-23

### Modifié

- Licence : le module est désormais publié sous GPL-3.0-or-later (code) et CC-BY-4.0 (documentation), à la place
  de l'AGPL-3.0. L'utilisation dans GEO ne change pas

## [0.2.0] — 2026-10-23

Un regard s'accompagne désormais de tout ce qui lui est rattaché dans le plan.

### Ajouté

- **Arbre des rattachements** : en cliquant un regard, le panneau liste son symbole (type de tampon) et ses canalisations,
  avec pour chacune le regard à l'autre bout, le sens d'écoulement, le matériau, le diamètre, la longueur et les fils d'eau
- Le fil d'eau est donné au regard concerné, avec son écart au radier ; l'autre bout est indiqué en regard
- Les canalisations du regard se surlignent en bleu sur la carte ; un clic sur l'une d'elles dans l'arbre la met en rouge
- Les liens se déduisent de la géométrie du plan (le plan ne porte aucun identifiant) : extrémités à moins de 50 cm d'un
  regard, bloc de caractéristiques posé sur la canalisation, flèche d'écoulement à proximité ; la lecture est en lecture seule,
  rien n'est écrit dans la base

## [0.1.0] — 2026-10-23

Premier jet : reprendre un regard d'un plan de récolement du marché de topographie et l'ajouter à la table du réseau.

### Ajouté

- Dépôt d'un plan **DXF** de récolement : le module lit les blocs à attributs (regards, avaloirs…) et les classe par calque
- Choix du calque et du bloc à afficher (par exemple les regards d'eaux usées) ; les points s'affichent sur la carte
- Clic sur un point : ses attributs (n° de regard, cote tampon, cote radier, profondeur) sont proposés dans un formulaire modifiable
- Correspondance entre les attributs du plan et les champs de la table, proposée automatiquement, modifiable et mémorisée
- Bouton « Insérer dans la table » : le regard est créé dans la table du réseau configurée dans le Générateur (transaction GEO)
- Les regards déjà insérés pendant la séance passent en vert pour éviter les doublons
