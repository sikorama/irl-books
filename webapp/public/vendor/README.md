# Vendored libraries

- `zxing.min.js` — UMD build of [@zxing/library](https://github.com/zxing-js/library) v0.21.3,
  downloaded from `https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js`.
  Apache-2.0 license. Used for ISBN barcode scanning via the camera
  (see `public/app.js`, `startScanner`/`stopScanner` functions).

Vendored file (loaded as a plain `<script>`, no npm/build step) to stay
consistent with the rest of the site (see the project's root README.md).
