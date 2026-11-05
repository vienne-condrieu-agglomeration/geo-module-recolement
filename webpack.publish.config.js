/**
 * Configuration webpack pour publication directe sur le serveur GEO.
 *
 * Prérequis : générer un accessToken depuis
 *   https://[votre_serveur]/account > "Crédits et licences" > "Token d'accès"
 *   Cocher "geo:aas" puis "Générer un token avec ces scopes".
 *
 * Usage :
 *   GEO_ACCESS_TOKEN=xxx npm run publish          → build + publie une fois
 *   GEO_ACCESS_TOKEN=xxx npm run publish:watch     → build + publie à chaque modification (dev)
 */

const path = require("path");
const webpack = require("webpack");
const GeoExtensionPublish = require("@bg/publish-js-extension");

// Bannière conservée dans main.js : licence et sources du module (le code tiers garde ses propres mentions)
const banner = [
  "geo-recolement " + require("./package.json").version,
  "SPDX-License-Identifier: GPL-3.0-or-later",
  "Source : https://github.com/vienne-condrieu-agglomeration/geo-module-recolement"
].join("\n");

// Le jeton ne doit jamais être écrit dans le code : on le lit uniquement dans l'environnement.
const accessToken = process.env.GEO_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error(
    "GEO_ACCESS_TOKEN manquant. Générez un jeton (scope geo:aas) sur " +
    "https://[votre_serveur]/account > \"Crédits et licences\" > \"Tokens GEO API\", " +
    "puis lancez : GEO_ACCESS_TOKEN=... npm run publish"
  );
}

module.exports = {

  entry: { main: path.join(__dirname, "/src/js/extension.js") },
  mode: "production",
  output: {
    path: path.join(__dirname, "/dist"),
    filename: "[name].js"
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"]
      },
      {
        // CHANGELOG.md embarqué en texte brut (journal des nouveautés, voir src/js/changelog.js)
        test: /\.md$/,
        use: "raw-loader"
      }
    ]
  },
  externals: {
    angular: "angular"
  },
  resolve: {
    extensions: [".js"],
    mainFields: ["browser", "main"]
  },
  optimization: {
    minimize: true
  },
  plugins: [
    new webpack.BannerPlugin({ banner: banner, entryOnly: true }),
    new GeoExtensionPublish({
      server:        process.env.GEO_SERVER || "https://geoservices.business-geografic.com",
      insecureServer: false,
      publish:       true,
      definition:    "src/plugin.geoext.json",
      accessToken:   accessToken
      // Alternative : authentification OAuth client credentials
      // clientId: process.env.GEO_CLIENT_ID,
      // secret:   process.env.GEO_SECRET
    })
  ]
};
