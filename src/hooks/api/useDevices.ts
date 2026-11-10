import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
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

/** The caller's devices (no token, no hash), newest first. */
export function useDevices() {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['devices'],
    enabled: !!currentUser,
    queryFn: async () => {
      const response = await apiClient.get<DeviceRecord[]>('/devices');
      return (response as unknown as { data?: DeviceRecord[] }).data ?? [];
    },
    refetchOnWindowFocus: false,
  });
}

/** Revokes one of the caller's devices (idempotent). The device list is refreshed when it answers. */
export function useRevokeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => apiClient.delete<DeviceRecord>(`/devices/${deviceId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}
