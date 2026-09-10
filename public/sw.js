self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Personalized study pages and API responses intentionally stay network-only.
// The worker exists to provide an installable app shell without caching private
// student questions, answers, account state, or payment information.
