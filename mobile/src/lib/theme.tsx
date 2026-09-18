/** App-wide theme: System / Light / Dark tri-state, persisted in SecureStore. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Semantic color tokens; every screen must use these instead of hardcoded hex. */
export type ThemeColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  danger: string;
  success: string;
  border: string;
  inputBackground: string;
  placeholder: string;
  userBubble: string;
  assistantBubble: string;
  codeBackground: string;
  /** Text on codeBackground (always a dark surface in both themes). */
  codeText: string;
  /** Translucent overlay behind sheets and dialogs. */
  scrim: string;
};

const DARK: ThemeColors = {
  background: '#0b0e14',
  surface: '#161b26',
  surfaceAlt: '#1f2532',
  text: '#ffffff',
  textMuted: '#8b93a7',
  primary: '#2563eb',
  primaryText: '#ffffff',
  danger: '#f87171',
  success: '#22c55e',
  border: '#1f2532',
  inputBackground: '#161b26',
  placeholder: '#5b6377',
  userBubble: '#1d4ed8',
  assistantBubble: '#161b26',
  codeBackground: '#0b0e14',
  codeText: '#e5e9f0',
  scrim: 'rgba(0,0,0,0.5)',
};

const LIGHT: ThemeColors = {
  background: '#f6f4ef',
  surface: '#ffffff',
  surfaceAlt: '#eceae4',
  text: '#141414',
  textMuted: '#6b7280',
  primary: '#1d4ed8',
  primaryText: '#ffffff',
  danger: '#dc2626',
  success: '#16a34a',
  border: '#e2e0d8',
  inputBackground: '#eceae4',
  placeholder: '#9ca3af',
  userBubble: '#1d4ed8',
  assistantBubble: '#ffffff',
  codeBackground: '#141414',
  codeText: '#f5f5f5',
  scrim: 'rgba(20,20,20,0.45)',
};

const MODE_KEY = 'cloudcli.themeMode';

type ThemeContextValue = {
  /** User's chosen mode. */
  mode: ThemeMode;
  /** Effective theme after resolving `system` against the OS. */
  resolved: ResolvedTheme;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'dark',
  colors: DARK,
  setMode: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let cancelled = false;
    void SecureStore.getItemAsync(MODE_KEY).then((saved) => {
      if (!cancelled && (saved === 'light' || saved === 'dark' || saved === 'system')) {
        setModeState(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void SecureStore.setItemAsync(MODE_KEY, next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolved: ResolvedTheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
    return { mode, resolved, colors: resolved === 'light' ? LIGHT : DARK, setMode };
  }, [mode, system, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Consumed by every screen for mode-aware colors. Defaults to dark outside a provider (tests). */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
