/* Сарафан service worker: Web Push + local reply notifications. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function showReplyNotification(data) {
  const title = data.title || "Сарафан";
  const options = {
    body: data.body || "",
    tag: data.tag || "sarafan",
    renotify: true,
    data: { id: data.id || null, url: data.url || "/" },
  };
  await self.registration.showNotification(title, options);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "reply-notify") return;
  event.waitUntil(showReplyNotification(data));
});

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
    showReplyNotification({
      title: data.title || "Сарафан",
      body: data.body || "Новое уведомление",
      tag: data.tag || "sarafan-push",
      id: data.id || null,
      url: data.url || "/",
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
