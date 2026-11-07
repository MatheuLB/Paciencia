// Guarda o jogo no aparelho para abrir mesmo sem internet.
// Ao publicar mudanças, aumente VERSAO para os celulares baixarem a nova.
const VERSAO = "paciencia-v1";
const ARQUIVOS = ["./", "index.html", "estilo.css", "jogo.js", "manifest.webmanifest", "icones/apple-touch-icon.png", "icones/icone-192.png", "icones/icone-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((cache) => cache.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
