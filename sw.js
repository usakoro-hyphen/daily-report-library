const CACHE_NAME = 'nippo-library-20260331175748';

const PRECACHE_URLS = [
    './',
    './index.html',
    './styles.css',
    './script.js',
    './favicon.ico',
    './favicon-16x16.png',
    './favicon-32x32.png',
    './apple-touch-icon.png',
    './android-chrome-192x192.png',
    './android-chrome-512x512.png',
    './site.webmanifest',
    'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js'
];

// Firestoreやその他外部APIのリクエストはSWで介入しない
const PASSTHROUGH_PATTERNS = [
    'firestore.googleapis.com',
    'generativelanguage.googleapis.com',
    'www.google.com',
    'apis.google.com'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Firestore・Gemini APIはスルー
    if (PASSTHROUGH_PATTERNS.some((pattern) => url.includes(pattern))) {
        return;
    }

    // Cache First → Network Fallback
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // 成功したレスポンスをキャッシュに追加（GETのみ）
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                // オフライン時: キャッシュにもネットワークにもない場合
                return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
            });
        })
    );
});
