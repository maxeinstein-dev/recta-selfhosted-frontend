import { useCallback, useEffect, useRef, useState } from 'react';
import { BatteryCharging, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Smartphone } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useToastContext } from '../../context/ToastContext';
import { useDefaultHousehold } from '../../hooks/useDefaultHousehold';
import { useCreateDevice, useRevokeDevice } from '../../hooks/api/useDevices';
import { CaptureReader, isNativeApp } from '../../native/captureReader';
import {
  CaptureLinkError,
  createDeviceBody,
  evaluateHealth,
  formatCaptureTime,
  linkDevice,
  overallStatus,
  parseCreatedDevice,
  readDiagnostics,
  unlinkDevice,
} from '../../utils/captureDevice';
import type { DiagnosticsSnapshot, HealthIssueCode } from '../../utils/captureDevice';
import { captureText } from '../../utils/captureTexts';
import type { CaptureTextKey } from '../../utils/captureTexts';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SECONDARY_SM, MUTED_CLS } from '../people/ui';

const REFRESH_MS = 5000;

const ISSUE_TEXT: Record<HealthIssueCode, CaptureTextKey> = {
  'plugin-unavailable': 'captureIssuePluginUnavailable',
  'secure-storage': 'captureIssueSecureStorage',
  'not-linked': 'captureIssueNotLinked',
  'access-off': 'captureIssueAccessOff',
  'auth-revoked': 'captureIssueAuth',
  'battery-restricted': 'captureIssueBattery',
  'send-failing': 'captureIssueSendFailing',
  'rejected-rows': 'captureIssueRejected',
};

const ROW_CLS = 'flex items-start justify-between gap-3 py-2 text-sm';
const LABEL_CLS = 'font-light text-gray-500 dark:text-gray-400';
const VALUE_CLS = 'font-light text-gray-900 dark:text-white text-right';

/**
 * Diagnostics of the Android notification reader: permission, battery optimization, the send queue, and the link of this
 * phone to the Recta account. Renders nothing outside the native app.
 */
const CaptureDiagnostics = () => {
  if (!isNativeApp()) return null;
  return <CaptureDiagnosticsPanel />;
};

const CaptureDiagnosticsPanel = () => {
  const { t } = useI18n();
  const tx = useCallback((key: CaptureTextKey) => captureText(t, key), [t]);
  const { success, error: showError } = useToastContext();
  const { householdId } = useDefaultHousehold();
  const createDevice = useCreateDevice();
  const revokeDevice = useRevokeDevice();

  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState<'link' | 'unlink' | 'send' | null>(null);
  const [unlinkFailed, setUnlinkFailed] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await readDiagnostics(CaptureReader);
    if (mounted.current) setSnapshot(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    // Coming back from a system settings screen: show the new state right away.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const issues = snapshot ? evaluateHealth(snapshot) : [];
  const status = snapshot ? overallStatus(issues) : null;
  const linked = snapshot?.link?.linked === true;
  const authIssue = issues.some((issue) => issue.code === 'auth-revoked');

  const handleLink = async () => {
    if (busy) return;
    setBusy('link');
    setUnlinkFailed(false);
    const previousDeviceId = snapshot?.link?.deviceId ?? null;
    let createdId: string | null = null;
    try {
      const { name } = await CaptureReader.getDeviceName().catch(() => ({ name: '' }));
      const response = await createDevice.mutateAsync(createDeviceBody(name, householdId));
      const created = parseCreatedDevice(response);
      createdId = created.id;
      await linkDevice(CaptureReader, {
        apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
        token: created.token,
        deviceId: created.id,
      });
      success(tx('captureLinkedToast'));
      // A relink replaces the old device: revoke it, best effort (it may already be revoked).
      if (previousDeviceId && previousDeviceId !== created.id) {
        void revokeDevice.mutateAsync(previousDeviceId).catch(() => undefined);
      }
    } catch (error) {
      // The server made a device the phone did not take: do not leave a working token behind.
      if (createdId) void revokeDevice.mutateAsync(createdId).catch(() => undefined);
      if (error instanceof CaptureLinkError && error.code === 'invalid-api-url') {
        showError(tx('captureApiUrlMissing'));
      } else {
        showError(tx('captureLinkFailed'));
      }
    } finally {
      if (mounted.current) setBusy(null);
      await refresh();
    }
  };

  const handleUnlink = async (localOnly: boolean) => {
    if (busy) return;
    setBusy('unlink');
    const deviceId = snapshot?.link?.deviceId ?? null;
    try {
      if (!localOnly && deviceId) {
        await revokeDevice.mutateAsync(deviceId);
      }
      await unlinkDevice(CaptureReader);
      setUnlinkFailed(false);
      success(tx('captureUnlinkedToast'));
    } catch {
      setUnlinkFailed(true);
      showError(tx('captureUnlinkFailed'));
    } finally {
      if (mounted.current) setBusy(null);
      await refresh();
    }
  };

  const handleSendNow = async () => {
    if (busy) return;
    setBusy('send');
    try {
      await CaptureReader.sendNow();
      success(tx('captureSendQueued'));
    } catch {
      showError(tx('captureSendFailed'));
    } finally {
      if (mounted.current) setBusy(null);
      // The send runs in the background: look again shortly, and the timer keeps looking after that.
      window.setTimeout(() => void refresh(), 2500);
    }
  };

  const open = (action: () => Promise<void>) => () => {
    void action().catch(() => showError(tx('captureOpenFailed')));
  };

  const queue = snapshot?.queue ?? null;
  const StatusIcon = status === 'ok' ? CheckCircle2 : status === 'attention' ? AlertTriangle : XCircle;
  const statusTone =
    status === 'ok'
      ? 'text-green-600 dark:text-green-400'
      : status === 'attention'
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-red-600 dark:text-red-400';
  const statusText =
    status === 'ok' ? tx('captureStatusOk') : status === 'attention' ? tx('captureStatusAttention') : tx('captureStatusError');

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
      <h2 className="text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-white mb-2 flex items-center">
        <Smartphone className="h-5 w-5 mr-2" />
        {tx('captureSectionTitle')}
      </h2>
      <p className={`text-sm font-light mb-4 ${MUTED_CLS}`}>{tx('captureSectionIntro')}</p>

      {status && (
        <div className="mb-4" role="status" aria-live="polite">
          <div className={`flex items-center gap-2 text-sm font-medium ${statusTone}`}>
            <StatusIcon className="h-4 w-4" aria-hidden="true" />
            {statusText}
          </div>
          {issues.length > 0 && (
            <ul className="mt-2 list-disc list-inside space-y-1 text-sm font-light text-gray-700 dark:text-gray-300">
              {issues.map((issue) => (
                <li key={issue.code}>{tx(ISSUE_TEXT[issue.code])}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        <div className="py-3">
          <div className={ROW_CLS}>
            <span className={LABEL_CLS}>{tx('captureLinkTitle')}</span>
            <span className={VALUE_CLS}>{linked ? tx('captureLinked') : tx('captureNotLinked')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(!linked || authIssue) && (
              <button type="button" className={BTN_PRIMARY} onClick={handleLink} disabled={busy !== null}>
                {busy === 'link' ? tx('captureLinking') : tx('captureLinkButton')}
              </button>
            )}
            {linked && (
              <button type="button" className={BTN_SECONDARY} onClick={() => void handleUnlink(false)} disabled={busy !== null}>
                {busy === 'unlink' ? tx('captureUnlinking') : tx('captureUnlinkButton')}
              </button>
            )}
            {linked && unlinkFailed && (
              <button type="button" className={BTN_SECONDARY} onClick={() => void handleUnlink(true)} disabled={busy !== null}>
                {tx('captureUnlinkLocalOnly')}
              </button>
            )}
          </div>
        </div>

        <div className="py-3">
          <div className={ROW_CLS}>
            <span className={LABEL_CLS}>{tx('captureAccessTitle')}</span>
            <span className={VALUE_CLS}>
              {snapshot?.accessEnabled == null ? '…' : snapshot.accessEnabled ? tx('captureAccessOn') : tx('captureAccessOff')}
            </span>
          </div>
          {snapshot?.accessEnabled === false && (
            <p className={`text-xs font-light mb-2 ${MUTED_CLS}`}>{tx('captureAccessRestrictedHint')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY_SM} onClick={open(() => CaptureReader.openNotificationAccessSettings())}>
              {tx('captureAccessOpen')}
            </button>
            <button type="button" className={BTN_SECONDARY_SM} onClick={open(() => CaptureReader.openAppDetailsSettings())}>
              {tx('captureAppInfoOpen')}
            </button>
          </div>
        </div>

        <div className="py-3">
          <div className={ROW_CLS}>
            <span className={`${LABEL_CLS} inline-flex items-center`}>
              <BatteryCharging className="h-4 w-4 mr-1" aria-hidden="true" />
              {tx('captureBatteryTitle')}
            </span>
            <span className={VALUE_CLS}>
              {snapshot?.batteryUnrestricted == null
                ? '…'
                : snapshot.batteryUnrestricted
                  ? tx('captureBatteryOk')
                  : tx('captureBatteryRestricted')}
            </span>
          </div>
          {snapshot?.batteryUnrestricted === false && (
            <p className={`text-xs font-light mb-2 ${MUTED_CLS}`}>{tx('captureBatteryHint')}</p>
          )}
          <button type="button" className={BTN_SECONDARY_SM} onClick={open(() => CaptureReader.openBatterySettings())}>
            {tx('captureBatteryOpen')}
          </button>
        </div>

        <div className="py-3">
          <div className={ROW_CLS}>
            <span className={LABEL_CLS}>{tx('capturePending')}</span>
            <span className={VALUE_CLS}>{queue ? queue.pending : '…'}</span>
          </div>
          <div className={ROW_CLS}>
            <span className={LABEL_CLS}>{tx('captureSent')}</span>
            <span className={VALUE_CLS}>{queue ? queue.sent : '…'}</span>
          </div>
          <div className={ROW_CLS}>
            <span className={LABEL_CLS}>{tx('captureRejected')}</span>
            <span className={VALUE_CLS}>{queue ? queue.rejected : '…'}</span>
          </div>
          <div className={ROW_CLS}>
            <span className={LABEL_CLS}>{tx('captureLastSent')}</span>
            <span className={VALUE_CLS}>{formatCaptureTime(queue?.lastSentAt) ?? tx('captureNever')}</span>
          </div>
          {queue?.lastError && (
            <div className={ROW_CLS}>
              <span className={LABEL_CLS}>{tx('captureLastError')}</span>
              <span className={`${VALUE_CLS} break-words max-w-[65%]`}>
                {queue.lastError}
                {formatCaptureTime(queue.lastErrorAt) ? ` (${formatCaptureTime(queue.lastErrorAt)})` : ''}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-1">
            <button type="button" className={BTN_PRIMARY} onClick={handleSendNow} disabled={busy !== null || !linked}>
              {busy === 'send' ? tx('captureSending') : tx('captureSendNow')}
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              {tx('captureRefresh')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CaptureDiagnostics;
