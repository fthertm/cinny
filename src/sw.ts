/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

const clientToResolve = new Map<string, (value: SessionInfo | undefined) => void>();
const clientToSessionPromise = new Map<string, Promise<SessionInfo | undefined>>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
      clientToResolve.delete(id);
      clientToSessionPromise.delete(id);
    }
  });
}

function setSession(clientId: string, accessToken: any, baseUrl: any) {
  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(clientId, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const resolveSession = clientToResolve.get(clientId);
  if (resolveSession) {
    resolveSession(sessions.get(clientId));
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }
}

function requestSession(client: Client): Promise<SessionInfo | undefined> {
  const promise =
    clientToSessionPromise.get(client.id) ??
    new Promise((resolve) => {
      clientToResolve.set(client.id, resolve);
      client.postMessage({ type: 'requestSession' });
    });

  if (!clientToSessionPromise.has(client.id)) {
    clientToSessionPromise.set(client.id, promise);
  }

  return promise;
}

async function requestSessionWithTimeout(
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  const sessionPromise = requestSession(client);

  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs);
  });

  return Promise.race([sessionPromise, timeout]);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await cleanupDeadClients();
    })()
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(client.id, accessToken, baseUrl);
    cleanupDeadClients();
  }
});

const MEDIA_PATHS = ['/_matrix/client/v1/media/download', '/_matrix/client/v1/media/thumbnail'];

function mediaPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return MEDIA_PATHS.some((p) => pathname.startsWith(p));
  } catch {
    return false;
  }
}

function validMediaRequest(url: string, baseUrl: string): boolean {
  return MEDIA_PATHS.some((p) => {
    const validUrl = new URL(p, baseUrl);
    return url.startsWith(validUrl.href);
  });
}

function fetchConfig(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'default',
  };
}

/**
 * Remote media (e.g. sticker packs from other servers) is fetched by our homeserver over
 * federation. Bursts of requests to one remote server often end in 502/503/504, so requests to
 * remote servers are limited per server and those statuses are retried with backoff.
 * Media from the homeserver itself is not limited.
 */
const MEDIA_RETRY_STATUSES = [502, 503, 504];
const MEDIA_MAX_RETRIES = 2;
const MEDIA_RETRY_DELAY_MS = 800;
const REMOTE_MEDIA_CONCURRENCY = 4;

type Lane = { active: number; waiting: Array<() => void> };
const remoteLanes = new Map<string, Lane>();

async function withRemoteLane<T>(serverName: string, task: () => Promise<T>): Promise<T> {
  const lane: Lane = remoteLanes.get(serverName) ?? { active: 0, waiting: [] };
  remoteLanes.set(serverName, lane);

  if (lane.active < REMOTE_MEDIA_CONCURRENCY) {
    lane.active += 1;
  } else {
    await new Promise<void>((resolve) => {
      lane.waiting.push(resolve);
    });
  }

  try {
    return await task();
  } finally {
    const next = lane.waiting.shift();
    if (next) next(); // hand the slot over to the next waiting request
    else lane.active -= 1;
  }
}

// /_matrix/client/v1/media/{download|thumbnail}/{serverName}/{mediaId}
function mediaServerName(url: string): string {
  return new URL(url).pathname.split('/')[6] ?? '';
}

function isLocalServerName(serverName: string, baseUrl: string): boolean {
  const { hostname } = new URL(baseUrl);
  return hostname === serverName || hostname.endsWith(`.${serverName}`);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function fetchMedia(url: string, session: SessionInfo, attempt = 0): Promise<Response> {
  const serverName = mediaServerName(url);
  const send = () => fetch(url, fetchConfig(session.accessToken));

  let res: Response | undefined;
  let failure: unknown;
  try {
    res = await (isLocalServerName(serverName, session.baseUrl)
      ? send()
      : withRemoteLane(serverName, send));
  } catch (e) {
    failure = e;
  }

  if (res && !MEDIA_RETRY_STATUSES.includes(res.status)) return res;
  if (attempt >= MEDIA_MAX_RETRIES) {
    if (res) return res; // out of retries: hand back the last error response as is
    throw failure;
  }

  res?.body?.cancel().catch(() => undefined);
  await sleep(MEDIA_RETRY_DELAY_MS * 2 ** attempt + Math.random() * MEDIA_RETRY_DELAY_MS);
  return fetchMedia(url, session, attempt + 1);
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET' || !mediaPath(url)) return;

  const { clientId } = event;
  if (!clientId) return;

  const session = sessions.get(clientId);
  if (session) {
    if (validMediaRequest(url, session.baseUrl)) {
      event.respondWith(fetchMedia(url, session));
    }
    return;
  }

  event.respondWith(
    requestSessionWithTimeout(clientId).then((s) => {
      if (s && validMediaRequest(url, s.baseUrl)) {
        return fetchMedia(url, s);
      }
      return fetch(event.request);
    })
  );
});