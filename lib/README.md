# lib/

Ce dossier accueille, **en local uniquement**, le plugin webpack de publication
`bg-publish-js-extension-v2.5.1.tgz`, propriété de Business Geografic. Il n'est **pas** distribué
avec ce dépôt (licence propriétaire) et est ignoré par git.

Il n'est nécessaire que pour `npm run publish` (envoi direct du module vers le Générateur GEO).
`npm install`, `npm run build` et `npm run package` fonctionnent sans lui.

## Obtention

Téléchargement depuis la documentation Business Geografic, rubrique « Plugin de publication d'un
module » : <https://docgeoapi.business-geografic.com/fr/guide/4-Modules/download>

> Cette page n'est accessible qu'aux utilisateurs de GEO Générateur disposant du module
> GEO API JS v2.

## Installation

```bash
# placer l'archive téléchargée dans ce dossier, puis, à la racine du module :
npm install --no-save ./lib/bg-publish-js-extension-v2.5.1.tgz
```
