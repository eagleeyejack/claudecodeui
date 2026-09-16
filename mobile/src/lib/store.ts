/** Persists the signed-in session in SecureStore so the app opens on the last server. */
import * as SecureStore from 'expo-secure-store';
import { setAuth } from '@/lib/api';
import type { LLMProvider } from '@/lib/api';

const AUTH_KEY = 'cloudcli.auth';

export type StoredAuth = { baseUrl: string; token: string; username: string };

export const saveAuth = async (value: StoredAuth): Promise<void> => {
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(value));
  setAuth(value);
};

export const loadAuth = async (): Promise<StoredAuth | null> => {
  const raw = await SecureStore.getItemAsync(AUTH_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredAuth;
    setAuth(value);
    return value;
  } catch {
    return null;
  }
};

export const clearAuth = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(AUTH_KEY);
  setAuth(null);
};

export const providerLabel = (provider: LLMProvider | undefined): string =>
  provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'CloudCLI';
