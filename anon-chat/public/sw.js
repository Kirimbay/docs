/* Komnata service worker: show reply notifications on iOS/Android PWAs. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "reply-notify") return;
  event.waitUntil(
    self.registration.showNotification(data.title || "Ответ в Комнате", {
      body: data.body || "",
      tag: data.tag || "komnata-reply",
      renotify: true,
      data: { id: data.id || null, url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetId = event.notification.data?.id;
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "open-reply", id: targetId });
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetId ? `${url}#msg-${targetId}` : url);
      }
    })()
  );
});
