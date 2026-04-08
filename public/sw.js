// Service Worker do iMaqueiro
const CACHE_NAME = 'imaqueiro-v1';

// Instala o trabalhador invisível
self.addEventListener('install', (event) => {
    console.log('[PWA] Instalado com sucesso.');
    self.skipWaiting();
});

// Ativa e limpa lixos antigos
self.addEventListener('activate', (event) => {
    console.log('[PWA] Ativado e rodando no fundo.');
});

// Intercepta as requisições para o app funcionar rápido
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});