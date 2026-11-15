// KikUp offline support. Pages and code: network first (so updates arrive), cached copy when offline.
// Big files (tracking models, videos, libraries, icons): cached the first time they're used.
// Only KikUp's own files are handled; Firebase and other sites go straight to the network.
const CACHE = 'kikup-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './js/reps.js', './js/feedback.js', './js/camera.js', './js/social.js', './js/firebase-config.js', './icon.svg', './icon-192.png', './icon-512.png', './privacy.html'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const big = /\/(vendor|models|videos)\//.test(url.pathname) || /\.(png|svg|mp4|wasm|task|tflite)$/.test(url.pathname);
  if (big) {   // cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  // network first, falling back to the cached copy (and to the app page for navigation)
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
