/* Notifications removed. Self-unregister so old PWA installs drop push. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.registration.unregister());
});
