import { load, save, clientId } from "./storage.js";
import { toast } from "./ui.js";

const PREF_KEY = "notifyOn";
const CH_PUBLIC = "notifyPublic";
const CH_ROOMS = "notifyRooms";

export function notifyEnabled() {
  return load(PREF_KEY) === "1";
}

export function setNotifyEnabled(on) {
  save(PREF_KEY, on ? "1" : "0");
}

function channels() {
  return {
    public: load(CH_PUBLIC, "1") !== "0",
    rooms: load(CH_ROOMS, "1") !== "0",
  };
}

async function ensureSW() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function syncPush(name) {
  if (!notifyEnabled() || !name) return false;
  if (!("Notification" in window) || !("PushManager" in window)) {
    toast("Пуши не поддерживаются");
    return false;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setNotifyEnabled(false);
    toast("Нет разрешения на уведомления");
    return false;
  }
  await ensureSW();
  const reg = await navigator.serviceWorker.ready;
  const keyRes = await fetch("/api/vapid-public-key").then((r) => r.json());
  if (!keyRes?.publicKey) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
    });
  }
  await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      name,
      clientId: clientId(),
      channels: channels(),
    }),
  });
  return true;
}

export async function toggleNotify(name) {
  if (notifyEnabled()) {
    setNotifyEnabled(false);
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await fetch("/api/push-unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } catch {
      /* ignore */
    }
    toast("Уведомления выключены");
    return false;
  }
  setNotifyEnabled(true);
  const ok = await syncPush(name);
  if (ok) toast("Уведомления включены");
  return ok;
}

export function syncNotifyBtn(btn) {
  if (!btn) return;
  const on = notifyEnabled();
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.classList.toggle("active", on);
  btn.title = on ? "Уведомления включены" : "Включить уведомления";
}
