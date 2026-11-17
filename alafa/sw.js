var V = "alafa-v1";
var CORE = ["./", "index.html", "admin.html", "style.css", "data.js", "logo.jpg", "icon-192.png", "manifest.webmanifest"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(V).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener("activate", function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x.indexOf("alafa-") === 0 && x !== V; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) { if (r.ok) { var c = r.clone(); caches.open(V).then(function (x) { x.put(e.request, c); }); } return r; })
    .catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match("index.html"); }); }));
});
