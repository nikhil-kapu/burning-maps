import * as SecureStore from "expo-secure-store";

const KEY = "turtle-maps.pending-invite.v1";

export async function savePendingInvite(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function getPendingInvite(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function clearPendingInvite(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
