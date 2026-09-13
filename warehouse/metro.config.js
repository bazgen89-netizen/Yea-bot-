// https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/#web-setup
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// В браузере SQLite работает как WebAssembly-модуль — Metro должен отдавать
// .wasm как ассет, иначе база не загрузится.
config.resolver.assetExts.push('wasm');

// SharedArrayBuffer, на котором держится SQLite в браузере, доступен только
// на странице с этими заголовками. Без них приложение откроется, но упадёт
// при первом обращении к базе.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    return middleware(req, res, next);
  };
};

module.exports = config;
