/**
 * Pure logic of the Android capture reader screen (Settings > "Leitor de notificações"): what the native plugin returns,
 * the checks before a device token is handed to it, and the verdict the screen shows. No React, no Capacitor and no
 * `import.meta`: the plugin is passed in, so this also runs under `tsx` (tools/fe-tests/t26_capture_device.mts).
 *
 * The plugin (android/.../capture/CaptureReaderPlugin.kt) never returns the device token. The web side only hands it
 * over once, right after POST /devices, and the token is not kept here.
 */

/** A device token as the backend issues it ("rdt_" + base64url). Loose on purpose; the server is the judge. */
export const DEVICE_TOKEN_SHAPE = /^rdt_[A-Za-z0-9_-]{20,128}$/;

/** The longest device name POST /devices accepts. */
export const DEVICE_NAME_MAX = 100;

export interface LinkState {
  linked: boolean;
  apiUrl: string | null;
  deviceId: string | null;
  secureStorageAvailable: boolean;
}

export type QueueErrorCode = 'AUTH' | 'RETRY' | 'REJECTED' | 'NO_TOKEN';

export interface QueueState {
  pending: number;
  sent: number;
  rejected: number;
  /** Epoch milliseconds of the last accepted upload. */
  lastSentAt: number | null;
  lastError: string | null;
  lastErrorCode: QueueErrorCode | null;
  lastErrorAt: number | null;
  /** True after a 401/403: sending stays stopped until a new link or a manual "send now". */
  authBlocked: boolean;
}

/** The methods of the native `CaptureReader` plugin. */
export interface CaptureReaderPlugin {
  configure(options: { apiUrl: string; token: string; deviceId?: string | null }): Promise<void>;
  clearLink(): Promise<void>;
  getLinkState(): Promise<LinkState>;
  getNotificationAccessState(): Promise<{ enabled: boolean }>;
  openNotificationAccessSettings(): Promise<void>;
  openAppDetailsSettings(): Promise<void>;
  getBatteryState(): Promise<{ ignoringOptimizations: boolean }>;
  openBatterySettings(): Promise<void>;
  getQueueState(): Promise<QueueState>;
  sendNow(): Promise<void>;
  getDeviceName(): Promise<{ name: string }>;
}

export type LinkErrorCode = 'invalid-api-url' | 'invalid-token' | 'plugin-failed';

export class CaptureLinkError extends Error {
  constructor(public readonly code: LinkErrorCode, message: string) {
    super(message);
    this.name = 'CaptureLinkError';
  }
}

/**
 * The API base URL the app sends to the plugin: https only (the token would travel in the clear otherwise), without
 * credentials, query or fragment, and no trailing slash. Null when it is not usable.
 */
export function normalizeApiUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** A name for the new device: the phone's model when known, trimmed to what the server accepts. */
export function deviceNameFor(raw: string | null | undefined): string {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, DEVICE_NAME_MAX).trim();
  return name || 'Android';
}

/** The body of POST /devices. `householdId` is left out when there is none (the server uses the personal household). */
export function createDeviceBody(name: string | null | undefined, householdId?: string | null): { name: string; householdId?: string } {
  const body: { name: string; householdId?: string } = { name: deviceNameFor(name) };
  if (householdId) body.householdId = householdId;
  return body;
}

export interface CreatedDevice {
  id: string;
  token: string;
}

/** Reads `{ data: { id, token, ... } }` from POST /devices; throws when the token or the id is missing or malformed. */
export function parseCreatedDevice(response: unknown): CreatedDevice {
  const data = (response as { data?: { id?: unknown; token?: unknown } } | null | undefined)?.data;
  const id = data?.id;
  const token = data?.token;
  if (typeof id !== 'string' || !id) throw new CaptureLinkError('plugin-failed', 'The server did not return a device id');
  if (typeof token !== 'string' || !DEVICE_TOKEN_SHAPE.test(token)) {
    throw new CaptureLinkError('invalid-token', 'The server did not return a device token');
  }
  return { id, token };
}

/**
 * Hands the device to the plugin. The checks run before the call, so a malformed token or a cleartext URL never reaches
 * the native side. Errors never carry the token.
 */
export async function linkDevice(
  plugin: Pick<CaptureReaderPlugin, 'configure'>,
  params: { apiBaseUrl: string | null | undefined; token: string; deviceId: string | null | undefined },
): Promise<void> {
  const apiUrl = normalizeApiUrl(params.apiBaseUrl);
  if (!apiUrl) throw new CaptureLinkError('invalid-api-url', 'The API address must be an https URL');
  if (!DEVICE_TOKEN_SHAPE.test(params.token)) throw new CaptureLinkError('invalid-token', 'Not a device token');
  try {
    await plugin.configure({ apiUrl, token: params.token, deviceId: params.deviceId ?? null });
  } catch {
    throw new CaptureLinkError('plugin-failed', 'The phone refused the link');
  }
}

/** Forgets the link on this phone (the server side is revoked separately, with DELETE /devices/:id). */
export async function unlinkDevice(plugin: Pick<CaptureReaderPlugin, 'clearLink'>): Promise<void> {
  await plugin.clearLink();
}

export interface DiagnosticsSnapshot {
  link: LinkState | null;
  /** null when the plugin could not answer. */
  accessEnabled: boolean | null;
  /** null when the plugin could not answer. */
  batteryUnrestricted: boolean | null;
  queue: QueueState | null;
}

const EMPTY_QUEUE_FIELDS = { lastSentAt: null, lastError: null, lastErrorCode: null, lastErrorAt: null, authBlocked: false } as const;

/** Fills the optional fields of a queue answer so the screen can rely on them. */
export function normalizeQueue(raw: Partial<QueueState> | null | undefined): QueueState | null {
  if (!raw || typeof raw !== 'object') return null;
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  return {
    ...EMPTY_QUEUE_FIELDS,
    ...raw,
    pending: count(raw.pending),
    sent: count(raw.sent),
    rejected: count(raw.rejected),
  };
}

/** Reads every state the screen shows. One call that fails leaves its field unknown instead of failing the others. */
export async function readDiagnostics(
  plugin: Pick<CaptureReaderPlugin, 'getLinkState' | 'getNotificationAccessState' | 'getBatteryState' | 'getQueueState'>,
): Promise<DiagnosticsSnapshot> {
  const [link, access, battery, queue] = await Promise.allSettled([
    plugin.getLinkState(),
    plugin.getNotificationAccessState(),
    plugin.getBatteryState(),
    plugin.getQueueState(),
  ]);
  return {
    link: link.status === 'fulfilled' ? link.value : null,
    accessEnabled: access.status === 'fulfilled' ? access.value.enabled === true : null,
    batteryUnrestricted: battery.status === 'fulfilled' ? battery.value.ignoringOptimizations === true : null,
    queue: queue.status === 'fulfilled' ? normalizeQueue(queue.value) : null,
  };
}

export type HealthIssueCode =
  | 'plugin-unavailable'
  | 'secure-storage'
  | 'not-linked'
  | 'access-off'
  | 'auth-revoked'
  | 'battery-restricted'
  | 'send-failing'
  | 'rejected-rows';

export type HealthLevel = 'error' | 'attention';

export interface HealthIssue {
  code: HealthIssueCode;
  level: HealthLevel;
}

export type HealthStatus = 'ok' | 'attention' | 'error';

/**
 * What is wrong, most serious first. 'error' means nothing is being captured or sent; 'attention' means it works but may
 * stop (the system can end the reader) or something needs a look.
 */
export function evaluateHealth(snapshot: DiagnosticsSnapshot): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const add = (code: HealthIssueCode, level: HealthLevel) => issues.push({ code, level });

  if (!snapshot.link && !snapshot.queue && snapshot.accessEnabled === null) {
    add('plugin-unavailable', 'error');
    return issues;
  }
  if (snapshot.link && !snapshot.link.secureStorageAvailable) add('secure-storage', 'error');
  if (snapshot.accessEnabled === false) add('access-off', 'error');
  if (snapshot.link && !snapshot.link.linked) add('not-linked', 'error');
  if (snapshot.queue && (snapshot.queue.authBlocked || snapshot.queue.lastErrorCode === 'AUTH')) add('auth-revoked', 'error');
  if (snapshot.batteryUnrestricted === false) add('battery-restricted', 'attention');
  if (snapshot.queue && snapshot.queue.pending > 0 && snapshot.queue.lastErrorCode === 'RETRY') add('send-failing', 'attention');
  if (snapshot.queue && snapshot.queue.rejected > 0) add('rejected-rows', 'attention');

  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

export function overallStatus(issues: HealthIssue[]): HealthStatus {
  if (issues.some((issue) => issue.level === 'error')) return 'error';
  return issues.length > 0 ? 'attention' : 'ok';
}

/** "dd/MM/yyyy HH:mm" in the phone's own time zone, or null when there is no time. */
export function formatCaptureTime(epochMillis: number | null | undefined): string | null {
  if (typeof epochMillis !== 'number' || !Number.isFinite(epochMillis)) return null;
  const date = new Date(epochMillis);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
