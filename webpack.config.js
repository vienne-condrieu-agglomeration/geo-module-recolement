const path = require("path");
const webpack = require("webpack");

// Bannière conservée dans main.js : licence et sources du module (le code tiers garde ses propres mentions)
const banner = [
  "geo-recolement " + require("./package.json").version,
  "SPDX-License-Identifier: GPL-3.0-or-later",
  "Source : https://github.com/vienne-condrieu-agglomeration/geo-module-recolement"
].join("\n");

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
    extensions: [".js"]
  },
  optimization: {
    minimize: true
  },
  plugins: [
    new webpack.BannerPlugin({ banner: banner, entryOnly: true })
  ]
};
