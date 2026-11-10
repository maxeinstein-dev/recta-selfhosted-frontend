import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../utils/api';

/** What GET/POST /devices return for a device (never the hash). `token` exists only in the POST /devices answer. */
export interface DeviceRecord {
  id: string;
  name: string;
  householdId: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  token?: string;
}

/**
 * Creates a device token for the Android capture app (EDITOR or more on the household). The plain token comes back
 * once, in this response; the caller hands it straight to the native plugin and does not keep it.
 */
export function useCreateDevice() {
  return useMutation({
    mutationFn: (input: { name: string; householdId?: string }) => apiClient.post<DeviceRecord>('/devices', input),
  });
}

/** Revokes one of the caller's devices (idempotent). */
export function useRevokeDevice() {
  return useMutation({
    mutationFn: (deviceId: string) => apiClient.delete<DeviceRecord>(`/devices/${deviceId}`),
  });
}
