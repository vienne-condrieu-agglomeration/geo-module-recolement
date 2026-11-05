# Contribuer à geo-recolement

Merci de votre intérêt. Les contributions (corrections, améliorations, documentation) sont les bienvenues.

## Licence des contributions

En contribuant, vous acceptez que votre contribution soit publiée sous les licences du projet :

- le **code** sous [GPL-3.0-or-later](LICENSE) ;
- la **documentation** et les captures sous [CC-BY-4.0](LICENSE-DOCS).

## Certificat d'origine (DCO)

Chaque commit doit porter une ligne `Signed-off-by`, qui atteste que vous avez le droit de proposer cette
contribution sous la licence du projet ([Developer Certificate of Origin 1.1](https://developercertificate.org/)).
Git l'ajoute avec l'option `-s` :

```bash
git commit -s -m "fix: décrire la correction"
```

La ligne obtenue est de la forme `Signed-off-by: Prénom Nom <adresse@exemple.fr>`. Si un commit a été oublié, la
signature peut s'ajouter après coup avec `git rebase --signoff <base>`, puis un push avec `--force-with-lease`
sur **votre** branche.

## Proposer un changement

1. Ouvrez une *issue* pour une nouveauté, ou directement une demande de fusion pour une correction simple.
2. Suivez les [Conventional Commits](https://www.conventionalcommits.org/fr/v1.0.0/), en français, à l'impératif.
3. Décrivez votre changement sous `## [Non publié]` du `CHANGELOG.md` (en français, pour les utilisateurs). Ne touchez
   pas au numéro de version : les mainteneurs le fixent au moment de la publication, dans `package.json`,
   `src/plugin.geoext.json` et le premier `## [x.y.z]` du journal (`npm test` vérifie qu'ils concordent).
4. Les commentaires du code sont en français, le code en anglais.
5. Lancez `npm test`. Ne commitez aucun plan réel (DXF, DWG) ni aucune donnée issue d'un plan réel : ce dépôt est public et
   ce qui y est poussé y reste. Les tests utilisent de petits jeux écrits dans le code ; voir [GUIDE-DEV.md](GUIDE-DEV.md).

## Plugin de publication propriétaire

La commande `npm run publish` utilise `@bg/publish-js-extension`, un plugin de Business Geografic qui n'est **pas**
distribué avec ce dépôt. Il n'est pas nécessaire pour contribuer : `npm run build` et `npm run package` suffisent.
