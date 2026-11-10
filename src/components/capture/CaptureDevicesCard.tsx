import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useToastContext } from '../../context/ToastContext';
import { useDevices, useRevokeDevice, type DeviceRecord } from '../../hooks/api/useDevices';
import { formatCaptureDateTime } from '../../utils/captureInbox';
import { captureText, type CaptureTextKey } from '../../utils/captureTexts';
import ConfirmModal from '../ConfirmModal';
import { ERROR_CLS, MUTED_CLS } from '../people/ui';

/**
 * Settings > Capturas, devices part: the phones linked to the account, with the revoke action. The phone that is reading
 * the notifications keeps its token until it is revoked here (or unlinked on the phone); a revoked token stops the sending.
 */
const CaptureDevicesCard = () => {
  const { t } = useI18n();
  const tx = (key: CaptureTextKey) => captureText(t, key);
  const { success, error: showError } = useToastContext();
  const devices = useDevices();
  const revoke = useRevokeDevice();
  const [toRevoke, setToRevoke] = useState<DeviceRecord | null>(null);

  const handleRevoke = async () => {
    if (!toRevoke) return;
    try {
      await revoke.mutateAsync(toRevoke.id);
      success(tx('captureDeviceRevokedToast'));
      setToRevoke(null);
    } catch {
      showError(tx('captureDeviceRevokeFailed'));
    }
  };

  const list = devices.data ?? [];

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
      <h2 className="text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-white mb-2 flex items-center">
        <Smartphone className="h-5 w-5 mr-2" aria-hidden="true" />
        {tx('captureDevicesTitle')}
      </h2>
      <p className={`text-sm font-light mb-4 ${MUTED_CLS}`}>{tx('captureDevicesIntro')}</p>

      {devices.isPending && <p role="status" className={`text-sm font-light ${MUTED_CLS}`}>…</p>}
      {devices.isError && <p role="alert" className={ERROR_CLS}>{tx('captureDevicesLoadError')}</p>}
      {devices.isSuccess && list.length === 0 && <p className={`text-sm font-light ${MUTED_CLS}`}>{tx('captureDevicesEmpty')}</p>}

      {list.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {list.map((device) => {
            const revoked = device.revokedAt !== null;
            return (
              <li key={device.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white break-words">{device.name}</p>
                  <p className={`text-xs font-light ${MUTED_CLS}`}>
                    {revoked ? tx('captureDeviceStatusRevoked') : tx('captureDeviceStatusActive')}
                    {' · '}
                    {tx('captureDeviceLinkedAt')} {formatCaptureDateTime(device.createdAt)}
                    {' · '}
                    {tx('captureDeviceLastUsed')}{' '}
                    {formatCaptureDateTime(device.lastUsedAt) || tx('captureDeviceNever')}
                  </p>
                </div>
                {!revoked && (
                  <button
                    type="button"
                    onClick={() => setToRevoke(device)}
                    disabled={revoke.isPending}
                    className="min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center px-3 py-2 text-sm font-light rounded-md border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 bg-white dark:bg-gray-900 hover:opacity-70 transition-opacity disabled:opacity-50"
                  >
                    {revoke.isPending && revoke.variables === device.id ? tx('captureDeviceRevoking') : tx('captureDeviceRevoke')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        isOpen={toRevoke !== null}
        onClose={() => setToRevoke(null)}
        onConfirm={() => void handleRevoke()}
        title={tx('captureDeviceRevokeTitle')}
        message={tx('captureDeviceRevokeMessage')}
        confirmText={tx('captureDeviceRevoke')}
        cancelText={tx('captureFormCancel')}
        variant="danger"
        isLoading={revoke.isPending}
      />
    </div>
  );
};

export default CaptureDevicesCard;
