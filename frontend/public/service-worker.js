/* 只处理显式订阅的推送，不缓存 API、凭证或个人额度记录。 */
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* 无效载荷仍给出保底提示。 */ }
  event.waitUntil(self.registration.showNotification(String(payload.title || "Codex Reset Monitor"), { body: String(payload.body || ""), icon: "/assets/openai-app-icon-192.png?v=4", badge: "/assets/openai-badge-96.png?v=4", tag: String(payload.tag || "codex-reset"), data: { url: payload.url || "/" } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(url.href));
});
