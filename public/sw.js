const CACHE_NAME = 'imaqueiro-cache-v3';
const ASSETS = ['/', '/index.html', '/logo-hospital.png', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css', 'https://unpkg.com/html5-qrcode'];

self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => { if (key !== CACHE_NAME) return caches.delete(key); })))); });
self.addEventListener('fetch', (event) => { event.respondWith(caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request))); });

// --- MÁGICA DA NOTIFICAÇÃO PUSH ---
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : { titulo: "Novo Transporte", corpo: "Você tem um novo chamado no iMaqueiro." };
    
    const options = {
        body: data.corpo,
        icon: '/logo-hospital.png',
        badge: '/logo-hospital.png',
        vibrate: [500, 250, 500, 250, 500, 250, 500], // Vibração de Emergência
        requireInteraction: true, // A notificação não some sozinha
        data: { url: '/' }
    };

    event.waitUntil(self.registration.showNotification(data.titulo, options));
});

// O QUE ACONTECE QUANDO ELE CLICA NA NOTIFICAÇÃO NO TOPO DA TELA
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