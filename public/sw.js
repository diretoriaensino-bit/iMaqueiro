const CACHE_NAME = 'imaqueiro-cache-v4'; // Versão nova para forçar a troca
const ASSETS = ['/', '/index.html', '/logo-hospital.png'];

// Instala e expulsa o cache antigo imediatamente!
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// Assume o controle do navegador na hora
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
        })))
    );
});

// ESTRATÉGIA NOVA: NETWORK FIRST!
// Sempre tenta pegar o visual mais novo da internet. Se a conexão cair, ele puxa do cache (Modo Elevador)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});

// --- MÁGICA DA NOTIFICAÇÃO PUSH ---
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : { titulo: "Novo Transporte", corpo: "Você tem um novo chamado no iMaqueiro." };
    const options = {
        body: data.corpo,
        icon: '/logo-hospital.png',
        badge: '/logo-hospital.png',
        vibrate: [500, 250, 500, 250, 500, 250, 500],
        requireInteraction: true,
        data: { url: '/' }
    };
    event.waitUntil(self.registration.showNotification(data.titulo, options));
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                let client = windowClients[i];
                if (client.url === '/' && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});