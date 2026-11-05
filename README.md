# geo-recolement — Lecture et analyse des plans de récolement

Module GEO qui lit un **plan de récolement DXF** conforme au CCTP du marché de topographie, range son contenu par métier, déduit le réseau de
la géométrie et contrôle le plan. Le plan est lu dans le navigateur : rien n'est envoyé ni écrit. L'intégration à la base patrimoniale viendra ensuite ;
l'insertion d'un ouvrage (transaction GEO) n'est proposée que si des tables cibles sont configurées.

> Module en cours de mise au point. Les tests automatisés (Node) couvrent la lecture du DXF, le modèle, le réseau et le diagnostic.

## Utilisation

L'onglet « Récolement » de la barre latérale droite ouvre le panneau. On y dépose un DXF (le DWG n'est pas lu : l'enregistrer en DXF 2018) :

| Onglet | Contenu |
|---|---|
| **Couches** | Métier > réseau > calque > type d'ouvrage, à cocher, avec le nombre de points, lignes, surfaces et textes. Le fond de plan est décoché au départ. |
| **Contrôles** | Anomalies par gravité. Un clic les surligne sur la carte, un second mène à l'objet. |
| **Patrimoine** | Regards et linéaire par réseau, matériau et diamètre ; bilan de ce qui a été lu ou non. |
| **Objet** | Fiche de l'objet cliqué : attributs, annotations proches, rattachements, avec des liens d'un objet à l'autre. |
| **Insertion** | Seulement si des tables cibles sont configurées : correspondance *attribut du plan → champ de la table*. |

## Configuration (Générateur GEO)

| Réglage | Rôle |
|---|---|
| Largeur du panneau | 25 à 60 % de la fenêtre, 35 % par défaut. |
| Tables cibles | Facultatif. Fiches info **éditables** des tables StaR Eau (6 au plus). Sans table, rien ne peut être écrit. |
| Projection des DXF | CC45 (EPSG:3945) par défaut, conforme au CCTP. Comparée à celle du cartouche par les contrôles. |
| Correspondance attributs → champs | `ATTRIBUT=champ;…`, point de départ de la correspondance. |

## Architecture

Sans DOM et testés seuls : `dxf-blocks.js` (lecture), `trades.js` (métiers, libellés de la charte), `network.js` (rattachements, tronçons),
`model.js` (classement de chaque entité), `diagnostic.js` (contrôles et patrimoine), `mapping.js` (correspondance), `charte.js` (calques de la charte).
`extension.js` ne contient que la carte et le panneau.

## Plan du marché de topographie

Les regards sont des blocs `ASS01_COT1` / `ASS01_COT2` (Covadis) sur les calques `TOPO_Eaux-usées_Symboles`, `TOPO_Eaux-pluviales_Symboles` et
`TOPO_Eau-unitaire_Symboles`, avec les attributs `REGARD` (n°), `TAMPON` (cote du tampon), `RADIER` (cote radier), `PROFOND` (profondeur).
Plan de test : un plan réel du marché, non versionné (116 regards d'eaux usées, 8 640 blocs à attributs, lus en moins d'une seconde).

## Métiers

Les calques de la charte s'appellent `TOPO_<Réseau>_<Thème>` ; le réseau donne le métier (`src/js/trades.js`) :

| Métier | Réseaux (calques) | Ce que portent les blocs du plan de test |
|---|---|---|
| Assainissement | `Eaux-usées`, `Eaux-pluviales`, `Eau-unitaire` | regards (`REGARD`, `TAMPON`, `RADIER`, `PROFOND`), canalisations (`MAT`, `DIAM`, `ALTI_AMONT/AVAL`), symboles sans attribut (avaloir, grille…) |
| Eau potable | `Eau-potable` | bouches à clé `EAU01_BAC` (`NUMBAC`, `ALTI`, `PROF`, `DIAM`) et poteaux incendie `EAU04` (`NUMPI`, `MARQ`, `TYPPI`, `PRES`) : attributs présents mais **vides** dans le plan de test |
| Éclairage public | `Eclairage` | blocs `ECL01…` **sans attribut** : type, position et réseau seulement |
| Voirie et mobilier | `Voirie`, `Mobiliers-urbains` | blocs `MOB…`, `SIH…` **sans attribut** |
| Réseaux tiers | `Electricité`, `Téléphone`, `Fibre-optique`, `Gaz`, `Pipeline`, `Chauffage-urbain`, `Feux`, `Transport`, `Voies-ferrées`, `Réseaux-NI` | blocs `EDF…`, `PTT…`, `GAZ…`, `AFF…` **sans attribut** (241 sur le plan de test : électricité, téléphone, gaz, non identifiés). Quelques blocs absents de la charte (`AFF03`, `PTT04`, `GAZ01`…) s'affichent sous leur nom brut |

Les blocs techniques (flèche d'écoulement, lettre ou texte d'appartenance, numéros 96 à 99 de la charte) ne sont pas affichés comme ouvrages.
Un symbole posé sur un regard (type de tampon) devient une propriété du regard. Un symbole sans attribut raccordé à une canalisation
(avaloir, tabouret) est un nœud du réseau : il liste ses canalisations, comme un regard.

## Tronçons reconstitués

Le plan dessine des **amorces** de quelques mètres autour de chaque regard (249 canalisations d'eaux usées sur 255 ont un bout libre), pas le
réseau continu. Deux amorces sont reliées si chacune est le meilleur choix de l'autre : à moins de 200 m, alignées à 15° près, sens
d'écoulement compatibles, diamètre identique en priorité. Ce lien reste une **déduction**, jugée par deux contrôles indépendants :

- **Cotes** : le fil d'eau doit descendre de l'amont vers l'aval. Le contrôle est utile mais faible : sur le plan de test, 50 à 56 % des couples
  d'amorces pris sans condition d'alignement passent aussi. Une cote cohérente ne prouve donc pas le tronçon.
- **Géométrie** : un tracé qui traverse un bâtiment (`TOPO_Bâtiments_Contours`, `_Constructions`) ou croise un tronçon plus court du même réseau est
  **douteux** : masqué au départ, non compté dans le linéaire, listé dans les contrôles.

Le tracé réel entre deux regards n'est pas forcément droit : même un tronçon probable est à confirmer.

## Rattachements déduits de la géométrie

Le plan ne porte aucun identifiant de lien. Pour un réseau (préfixe de calque, ex. `TOPO_Eaux-usées`) :

| Objet | Calque / bloc | Lien |
|---|---|---|
| Regard | `…_Symboles`, bloc à attribut `REGARD` | |
| Symbole du regard | `…_Infrastructures` (`E_U01` tampon mixte, `E_U02` plaque, `E_U03` tampon circulaire plein…) | à moins de 0,5 m du regard |
| Canalisation | polyligne de `…_Tracés-souterrains` | extrémités à moins de 0,5 m d'un regard |
| Caractéristiques | `…_Symboles`, bloc à attribut `ALTI_AMONT` / `ALTI_AVAL` (`MAT`, `DIAM`) | posé sur la polyligne (≤ 5 cm), même orientation |
| Sens d'écoulement | `…_Infra-sous-sol`, flèche `E_U98` / `E_P98` | à moins de 1 m de la polyligne ; sa rotation donne le sens |

Le bloc de caractéristiques ne donne le fil d'eau qu'à **un seul bout** (l'autre est « NR ») : c'est le sens d'écoulement qui dit s'il
s'agit de l'amont ou de l'aval, donc à quel regard il appartient. Sur le plan de test, pour une canalisation qui part d'un regard, le fil
d'eau ainsi attribué est égal au radier du regard dans 84 cas sur 87 ; pour une canalisation qui y arrive, il est au-dessus du radier.
Sans flèche, le sens est inconnu : l'arbre affiche alors les deux valeurs du bloc sans les attribuer à un regard.

## Limites

- L'arbre ne lit que les polylignes (`LWPOLYLINE`), les arcs sont lus comme des cordes.

- Un point à la fois, sans détection de doublon avec un ouvrage déjà présent dans la table (le point inséré est seulement marqué en vert pendant la séance).
- Ni mise à jour d'un ouvrage existant, ni insertion des canalisations (seulement leur arbre, en lecture).
- Tous les calques `…_Tracés-souterrains` et `…_Tracés-aériens` sont traités comme des réseaux, mais le plan de test n'en a que pour l'assainissement : les autres réseaux ne sont essayés que sur des données synthétiques.
- Les blocs s'affichent en points de couleur, pas avec leur symbole de la charte. SPLINE et ELLIPSE ne sont pas lus (ils sont comptés dans le bilan).
- L'insertion en base ne vaut aujourd'hui que pour les ouvrages à attributs ; une table cible par métier reste à prévoir.
- La géométrie est envoyée en WGS84 (EPSG:4326, système par défaut des transactions GEO) et reprojetée par le serveur.
- Les champs de la table viennent du modèle de la fiche info (`getFeatureSkeleton`) : seuls les champs **modifiables** sont proposés.

## Développement

```bash
npm install
npm test          # versions concordantes + lecture DXF + correspondance + journal
npm run package   # build + geo-recolement_AAAAMMJJ-HHMM.zip à importer dans le Générateur GEO
```

Savoir métier, méthode d'essai et pièges : [GUIDE-DEV.md](GUIDE-DEV.md).

## Licence

- **Code** : [GPL-3.0-or-later](LICENSE) — © 2026 Vienne Condrieu Agglomération.
- **Documentation** (ce README, `CHANGELOG.md`, captures) : [CC-BY-4.0](LICENSE-DOCS).
- **Composants tiers** embarqués dans le bundle (proj4 et ses dépendances) : voir [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
- **Marques** : « GEO » et « Business Geografic » sont des marques de leurs titulaires ; ce module est indépendant et
  n'est ni édité ni approuvé par Business Geografic.
- **Plugin propriétaire non inclus** : `npm run publish` utilise `@bg/publish-js-extension` (Business Geografic), qui n'est
  pas distribué avec ce dépôt. Il n'est pas nécessaire pour `npm run build` ni `npm run package`.

Les contributions se font sous la même licence, avec signature DCO : voir [CONTRIBUTING.md](CONTRIBUTING.md).
