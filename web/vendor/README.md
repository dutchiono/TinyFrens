Bundled QR dependencies (no third-party QR service receives connection codes):

- `qrcode.js`: qrcode-generator 1.4.4, npm distribution; Kazuhiko Arase, MIT. Source: https://github.com/kazuhikoarase/qrcode-generator
- `jsQR.js`: jsqr 1.4.0, npm distribution; Cozmo, Apache-2.0. Source: https://github.com/cozmo/jsQR

License files are included alongside the scripts. `node scripts/test-connections.cjs` verifies that generated device and wallet QR codes round-trip through the bundled decoder.
