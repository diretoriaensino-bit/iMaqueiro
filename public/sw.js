const CACHE_NAME = 'imaqueiro-v1';

// Instalação do Service Worker
self.addEventListener('install', (event) => {
    console.log('✅ Service Worker do iMaqueiro Instalado!');
    self.skipWaiting();
});

// Como usamos tempo real (Socket.io), não vamos fazer cache de páginas
// para evitar que o maqueiro veja chamados antigos presos na tela.
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});