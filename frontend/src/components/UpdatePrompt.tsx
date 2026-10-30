import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_EVERY_MS = 60 * 60 * 1000;

/** Registers the service worker and offers a reload when a new version has been downloaded. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, CHECK_EVERY_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="card fixed inset-x-2 bottom-16 z-40 flex items-center gap-3 p-3 shadow-lg md:right-4 md:bottom-4 md:left-auto md:w-96"
    >
      <p className="flex-1 text-sm">
        <strong className="block">A new version of Siteward is ready.</strong>
        <span className="text-muted">Your saved work is kept.</span>
      </p>
      <button type="button" className="btn-secondary" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
      <button type="button" className="btn-primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  );
}
