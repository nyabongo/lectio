import { describe, expect, it, vi } from 'vitest';

import type { ClientMessage } from '../lib/sw-policy.ts';
import { registerServiceWorker, startPwa } from './client.ts';
import type {
  PwaBrowser,
  RegisterOptions,
  RegistrationHandle,
  ToastElement,
  WorkerContainer,
  WorkerHandle,
} from './client.ts';

class FakeWorker implements WorkerHandle {
  readonly messages: ClientMessage[] = [];
  private listener: (() => void) | undefined;

  state: string;

  constructor(state: string) {
    this.state = state;
  }

  postMessage(message: ClientMessage): void {
    this.messages.push(message);
  }

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listener = listener;
  }

  become(state: string): void {
    this.state = state;
    this.listener?.();
  }
}

class FakeRegistration implements RegistrationHandle {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  private listener: (() => void) | undefined;

  active: FakeWorker | null;

  constructor(active: FakeWorker | null = new FakeWorker('activated')) {
    this.active = active;
  }

  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.listener = listener;
  }

  found(worker: FakeWorker | null): void {
    this.installing = worker;
    this.listener?.();
  }
}

class FakeContainer implements WorkerContainer {
  readonly registered: [string, { scope: string }][] = [];
  private listener: (() => void) | undefined;
  readonly ready: Promise<RegistrationHandle>;

  readonly registration: FakeRegistration | null;
  controller: unknown;
  readonly fail: boolean;

  constructor(registration: FakeRegistration | null = new FakeRegistration(), controller: unknown = {}, fail = false) {
    this.registration = registration;
    this.controller = controller;
    this.fail = fail;
    this.ready = Promise.resolve(registration ?? new FakeRegistration(null));
  }

  register(url: string, options: { scope: string }): Promise<RegistrationHandle> {
    this.registered.push([url, options]);
    if (this.fail || this.registration === null) return Promise.reject(new TypeError('no'));
    return Promise.resolve(this.registration);
  }

  getRegistration(): Promise<RegistrationHandle | undefined> {
    return this.fail ? Promise.reject(new Error('no')) : Promise.resolve(this.registration ?? undefined);
  }

  addEventListener(_type: 'controllerchange', listener: () => void): void {
    this.listener = listener;
  }

  controllerChanged(): void {
    this.listener?.();
  }
}

function options(container: WorkerContainer | undefined, extra: Partial<RegisterOptions> = {}): RegisterOptions {
  return {
    container,
    online: true,
    url: '/lectio/sw.js',
    scope: '/lectio/',
    today: '2026-09-20',
    onUpdate: vi.fn(),
    reload: vi.fn(),
    ...extra,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('registerServiceWorker', () => {
  it('does nothing without service worker support', async () => {
    expect(await registerServiceWorker(options(undefined))).toBeNull();
  });

  it('registers at the scope and asks the active worker to cache the next seven days', async () => {
    const container = new FakeContainer();
    const registration = await registerServiceWorker(options(container));
    expect(registration).toBe(container.registration);
    expect(container.registered).toEqual([['/lectio/sw.js', { scope: '/lectio/' }]]);
    await flush();
    expect(container.registration?.active?.messages).toEqual([{ type: 'prefetch', today: '2026-09-20' }]);
  });

  it('only looks up the registration when offline', async () => {
    const container = new FakeContainer();
    expect(await registerServiceWorker(options(container, { online: false }))).toBe(container.registration);
    expect(container.registered).toEqual([]);
    expect(await registerServiceWorker(options(new FakeContainer(null), { online: false }))).toBeNull();
  });

  it('sends nothing when the ready registration has no active worker', async () => {
    const container = new FakeContainer(new FakeRegistration(null));
    expect(await registerServiceWorker(options(container))).toBe(container.registration);
    await flush();
    expect(container.registration?.active).toBeNull();
  });

  it('returns null when registration fails', async () => {
    expect(await registerServiceWorker(options(new FakeContainer(new FakeRegistration(), {}, true)))).toBeNull();
  });

  it('offers a waiting update and reloads once the new worker has taken over', async () => {
    const registration = new FakeRegistration();
    const waiting = new FakeWorker('installed');
    registration.waiting = waiting;
    const container = new FakeContainer(registration);
    let apply: (() => void) | undefined;
    const opts = options(container, {
      onUpdate: (next) => {
        apply = next;
      },
    });
    await registerServiceWorker(opts);
    // A controller change the reader did not ask for (another tab) does not reload.
    container.controllerChanged();
    expect(opts.reload).not.toHaveBeenCalled();
    apply?.();
    expect(waiting.messages).toEqual([{ type: 'skip-waiting' }]);
    container.controllerChanged();
    expect(opts.reload).toHaveBeenCalledOnce();
  });

  it('offers an update found while the page is open, once it has installed', async () => {
    const registration = new FakeRegistration();
    const opts = options(new FakeContainer(registration));
    await registerServiceWorker(opts);
    registration.found(null);
    const next = new FakeWorker('installing');
    registration.found(next);
    next.become('installing');
    expect(opts.onUpdate).not.toHaveBeenCalled();
    next.become('installed');
    expect(opts.onUpdate).toHaveBeenCalledOnce();
  });

  it('does not offer the first install as an update', async () => {
    const registration = new FakeRegistration();
    const opts = options(new FakeContainer(registration, null));
    await registerServiceWorker(opts);
    const first = new FakeWorker('installing');
    registration.found(first);
    first.become('installed');
    expect(opts.onUpdate).not.toHaveBeenCalled();
    const noController = new FakeContainer(registration);
    noController.controller = undefined;
    const undefinedController = options(noController);
    registration.waiting = first;
    await registerServiceWorker(undefinedController);
    expect(undefinedController.onUpdate).not.toHaveBeenCalled();
  });
});

class FakeButton {
  private listener: (() => void) | undefined;

  addEventListener(_type: 'click', listener: () => void): void {
    this.listener = listener;
  }

  click(): void {
    this.listener?.();
  }
}

class FakeToast implements ToastElement {
  hidden = true;
  readonly reload = new FakeButton();
  readonly dismiss = new FakeButton();

  readonly dataset: Record<string, string | undefined>;
  private readonly buttons: boolean;

  constructor(
    dataset: Record<string, string | undefined> = { swUrl: '/lectio/sw.js', swScope: '/lectio/' },
    buttons = true,
  ) {
    this.dataset = dataset;
    this.buttons = buttons;
  }

  querySelector(selector: string): FakeButton | null {
    if (!this.buttons) return null;
    return selector === '[data-pwa-reload]' ? this.reload : this.dismiss;
  }
}

function browser(container: WorkerContainer | undefined, reload = vi.fn()): PwaBrowser {
  return {
    navigator: { serviceWorker: container, onLine: true },
    location: { reload },
    now: () => new Date(2026, 8, 21, 7),
  };
}

describe('startPwa', () => {
  it('does nothing on a page without the toast (development builds)', async () => {
    const container = new FakeContainer();
    expect(await startPwa({ querySelector: () => null }, browser(container))).toBeNull();
    expect(await startPwa({ querySelector: () => new FakeToast({ swUrl: '/sw.js' }) }, browser(container))).toBeNull();
    expect(container.registered).toEqual([]);
  });

  it('registers from the toast data and sends the device date', async () => {
    const container = new FakeContainer();
    await startPwa({ querySelector: () => new FakeToast() }, browser(container));
    expect(container.registered).toEqual([['/lectio/sw.js', { scope: '/lectio/' }]]);
    await flush();
    expect(container.registration?.active?.messages).toEqual([{ type: 'prefetch', today: '2026-09-21' }]);
  });

  it('shows the toast for an update; Reload applies it, Not now hides it', async () => {
    const registration = new FakeRegistration();
    const waiting = new FakeWorker('installed');
    registration.waiting = waiting;
    const container = new FakeContainer(registration);
    const toast = new FakeToast();
    const reload = vi.fn();
    // Reload before an update is offered does nothing.
    toast.reload.click();
    await startPwa({ querySelector: () => toast }, browser(container, reload));
    expect(toast.hidden).toBe(false);
    toast.reload.click();
    expect(waiting.messages).toEqual([{ type: 'skip-waiting' }]);
    container.controllerChanged();
    expect(reload).toHaveBeenCalledOnce();
    toast.dismiss.click();
    expect(toast.hidden).toBe(true);
  });

  it('tolerates a toast without buttons', async () => {
    const container = new FakeContainer();
    const page = { querySelector: () => new FakeToast(undefined, false) };
    expect(await startPwa(page, browser(container))).toBe(container.registration);
  });

  it('calls Reload safely before any update', async () => {
    const container = new FakeContainer();
    const toast = new FakeToast();
    await startPwa({ querySelector: () => toast }, browser(container));
    toast.reload.click();
    expect(container.registration?.active?.messages).not.toContainEqual({ type: 'skip-waiting' });
  });
});
