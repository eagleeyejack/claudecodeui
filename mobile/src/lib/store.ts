/** Persists the signed-in session in SecureStore so the app opens on the last server. */
import * as SecureStore from 'expo-secure-store';
import { setAuth } from '@/lib/api';
import type { LLMProvider } from '@/lib/api';

const AUTH_KEY = 'cloudcli.auth';
const LAST_URL_KEY = 'cloudcli.lastServerUrl';
const FAVOURITE_MODELS_KEY = 'cloudcli.favouriteModels';

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

/** Favourited model values per provider, pinning the settings-sheet roster. */
export const loadFavouriteModels = async (): Promise<Record<string, string[]>> => {
  const raw = await SecureStore.getItemAsync(FAVOURITE_MODELS_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, string[]>;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

export const saveFavouriteModels = async (value: Record<string, string[]>): Promise<void> => {
  await SecureStore.setItemAsync(FAVOURITE_MODELS_KEY, JSON.stringify(value));
};

/** Last successfully connected server URL, prefilled on the connect screen. */
export const saveLastServerUrl = async (baseUrl: string): Promise<void> => {
  await SecureStore.setItemAsync(LAST_URL_KEY, baseUrl);
};

export const loadLastServerUrl = async (): Promise<string | null> =>
  SecureStore.getItemAsync(LAST_URL_KEY);

export const providerLabel = (provider: LLMProvider | undefined): string =>
  provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'CloudCLI';
