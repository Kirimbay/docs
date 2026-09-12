/* Сарафан service worker: Web Push + Home Screen badge support. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function showPushNotification(data) {
  const title = data.title || "Сарафан";
  const options = {
    body: data.body || "",
    tag: data.tag || "sarafan",
    renotify: true,
    data: { id: data.id || null, url: data.url || "/" },
  };
  await self.registration.showNotification(title, options);
  try {
    if (typeof self.registration.setAppBadge === "function") {
      const n = Number(data.badge);
      if (Number.isFinite(n) && n > 0) await self.registration.setAppBadge(n);
      else await self.registration.setAppBadge(1);
    }
  } catch {
    /* ignore */
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      data = { body: event.data?.text?.() || "" };
    } catch {
      data = {};
    }
  }
  event.waitUntil(
    showPushNotification({
      title: data.title || "Сарафан",
      body: data.body || "Новое сообщение",
      tag: data.tag || "sarafan-push",
      id: data.id || null,
      url: data.url || "/",
      badge: data.badge,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetId = event.notification.data?.id;
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      try {
        if (typeof self.registration.clearAppBadge === "function") {
          await self.registration.clearAppBadge();
        }
      } catch {
        /* ignore */
      }
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "open-from-notify", id: targetId });
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetId ? `${url}#msg-${targetId}` : url);
      }
    })()
  );
});
