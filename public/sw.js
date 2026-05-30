// Service worker minimale: rende la PWA installabile e gestisce il Web Share Target.
// NON fa precache dell'app (serve sempre la rete) per evitare versioni stantie.
const SHARE_CACHE = "afdsa-shared";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share") {
    event.respondWith(handleShare(event.request));
  }
  // tutto il resto: passthrough verso la rete (comportamento di default)
});

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("file").filter((f) => f && typeof f.arrayBuffer === "function");
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);
    let i = 0;
    for (const file of files) {
      const headers = new Headers();
      headers.set("content-type", file.type || "application/octet-stream");
      headers.set("x-filename", encodeURIComponent(file.name || `condiviso-${i}`));
      await cache.put(new Request(`/__shared/${i}`), new Response(file, { headers }));
      i++;
    }
  } catch {
    // ignora: la home gestirà l'assenza di file condivisi
  }
  return Response.redirect("/?shared=1", 303);
}
