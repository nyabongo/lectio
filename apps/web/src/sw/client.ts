/**
 * The page side of the PWA (L-061): registers the service worker, asks it to cache the next seven days from the
 * device date on every page open, in the reader's saved language (the worker cannot read `localStorage`, so the page
 * sends `language` from `lectio.settings` with the request), and shows the update-available toast when a new worker
 * is waiting. Its Reload button tells the waiting worker to take over and reloads once it has. `startPwa` is called
 * by the script in `components/pwa/PwaUpdate.astro`; the toast markup (strings from `src/i18n/<lang>/pwa.json`) is
 * rendered there, in production builds only, so `astro dev` never registers a worker.
 */
import { loadSettings } from '../lib/settings.ts';
import type { SettingsStorage } from '../lib/settings.ts';
import { deviceDate } from '../lib/sw-policy.ts';
import type { ClientMessage } from '../lib/sw-policy.ts';

/** The slice of `ServiceWorker` the page uses. */
export interface WorkerHandle {
  readonly state: string;
  postMessage(message: ClientMessage): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** The slice of `ServiceWorkerRegistration` the page uses. */
export interface RegistrationHandle {
  readonly installing: WorkerHandle | null;
  readonly waiting: WorkerHandle | null;
  readonly active: WorkerHandle | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

/** The slice of `ServiceWorkerContainer` (`navigator.serviceWorker`) the page uses. */
export interface WorkerContainer {
  readonly controller: unknown;
  readonly ready: Promise<RegistrationHandle>;
  register(url: string, options: { scope: string }): Promise<RegistrationHandle>;
  getRegistration(scope: string): Promise<RegistrationHandle | undefined>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface RegisterOptions {
  /** `navigator.serviceWorker`, or `undefined` when the browser has none. */
  readonly container: WorkerContainer | undefined;
  /** `navigator.onLine`: offline, the page only looks up the registration (no update check that would fail). */
  readonly online: boolean;
  readonly url: string;
  readonly scope: string;
  /** The device date, `YYYY-MM-DD`. */
  readonly today: string;
  /** The reader's saved language (`language` in `lectio.settings`), so the worker keeps the days in it. */
  readonly language?: string;
  /** Called when a new worker is waiting; `apply` activates it and the page then reloads. */
  readonly onUpdate: (apply: () => void) => void;
  readonly reload: () => void;
}

/** Registers the worker and wires the update flow. Resolves to the registration, or `null` if there is none. */
export async function registerServiceWorker(options: RegisterOptions): Promise<RegistrationHandle | null> {
  const { container } = options;
  if (container === undefined) return null;
  let registration: RegistrationHandle | undefined;
  try {
    registration = options.online
      ? await container.register(options.url, { scope: options.scope })
      : await container.getRegistration(options.scope);
  } catch {
    return null;
  }
  if (registration === undefined) return null;
  const found = registration;

  let applying = false;
  container.addEventListener('controllerchange', () => {
    if (applying) options.reload();
  });
  const offer = (worker: WorkerHandle): void => {
    // With no controller this is the first install, not an update.
    if (container.controller === null || container.controller === undefined) return;
    options.onUpdate(() => {
      applying = true;
      worker.postMessage({ type: 'skip-waiting' });
    });
  };
  if (found.waiting !== null) offer(found.waiting);
  found.addEventListener('updatefound', () => {
    const worker = found.installing;
    if (worker === null) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  });
  void container.ready.then((ready) => {
    const { today, language } = options;
    ready.active?.postMessage(
      language === undefined ? { type: 'prefetch', today } : { type: 'prefetch', today, language },
    );
  });
  return found;
}

/** The slice of an element the toast uses. */
export interface ToastElement {
  hidden: boolean;
  readonly dataset: Readonly<Record<string, string | undefined>>;
  querySelector(selector: string): { addEventListener(type: 'click', listener: () => void): void } | null;
}

/** What `startPwa` reads from the page. */
export interface PwaPage {
  querySelector(selector: string): ToastElement | null;
}

export interface PwaBrowser {
  readonly navigator: { readonly serviceWorker?: WorkerContainer; readonly onLine: boolean };
  readonly location: { reload(): void };
  readonly now: () => Date;
  /** Where the reader's settings are kept (`browserStorage()`), or `null` when the browser blocks it. */
  readonly storage: SettingsStorage | null;
}

/**
 * Starts the PWA on a page: finds the toast (absent in development builds, which then do nothing), registers the
 * worker from the toast's `data-sw-url` and `data-sw-scope`, and shows the toast when an update is waiting.
 */
export function startPwa(page: PwaPage, browser: PwaBrowser): Promise<RegistrationHandle | null> {
  const toast = page.querySelector('[data-pwa-toast]');
  const url = toast?.dataset.swUrl;
  const scope = toast?.dataset.swScope;
  if (toast === null || url === undefined || scope === undefined) return Promise.resolve(null);
  let apply = (): void => undefined;
  toast.querySelector('[data-pwa-reload]')?.addEventListener('click', () => {
    apply();
  });
  toast.querySelector('[data-pwa-dismiss]')?.addEventListener('click', () => {
    toast.hidden = true;
  });
  return registerServiceWorker({
    container: browser.navigator.serviceWorker,
    online: browser.navigator.onLine,
    url,
    scope,
    today: deviceDate(browser.now()),
    language: loadSettings(browser.storage).language,
    onUpdate: (next) => {
      apply = next;
      toast.hidden = false;
    },
    reload: () => {
      browser.location.reload();
    },
  });
}
