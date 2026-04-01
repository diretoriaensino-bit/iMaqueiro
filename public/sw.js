const CACHE_NAME = 'imaqueiro-cache-v1';

// Arquivos que o celular vai baixar e guardar na memória (Modo Offline)
const ASSETS = [
    '/',
    '/index.html',
    '/logo-hospital.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
    'https://unpkg.com/html5-qrcode'
];

// Instala o Service Worker e guarda os arquivos
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Arquivos em cache pro modo offline');
            return cache.addAll(ASSETS);
        })
    );
});

// Ativa e limpa caches antigos se tivermos atualizações
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
});

// Intercepta os pedidos. Se não tiver internet, puxa da memória do celular!
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});