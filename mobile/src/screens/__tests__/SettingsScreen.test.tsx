jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/api', () => ({
  getAuth: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  clearAuth: jest.fn(),
}));

jest.mock('@/lib/ws', () => ({
  chatSocket: { close: jest.fn(), connect: jest.fn() },
}));

const mockSetMode = jest.fn();

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    mode: 'system',
    resolved: 'dark',
    setMode: mockSetMode,
    colors: {
      background: 'bg',
      surface: 'surface',
      surfaceAlt: 'surfaceAlt',
      text: 'text',
      textMuted: 'muted',
      primary: 'primary',
      primaryText: 'primaryText',
      danger: 'danger',
      success: 'success',
      border: 'border',
      inputBackground: 'input',
      placeholder: 'placeholder',
      userBubble: 'user',
      assistantBubble: 'assistant',
      codeBackground: 'code',
    },
  }),
}));

import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { getAuth } from '@/lib/api';
import { clearAuth } from '@/lib/store';
import { chatSocket } from '@/lib/ws';
import * as Haptics from 'expo-haptics';

const mockGetAuth = getAuth as jest.Mock;
const mockClearAuth = clearAuth as jest.Mock;
const mockClose = (chatSocket as unknown as { close: jest.Mock }).close;
const mockImpact = Haptics.impactAsync as jest.Mock;

const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), reset: jest.fn() } as never;

async function renderSettings(onSignedOut = jest.fn()) {
  await render(
    <SettingsScreen navigation={navigation} route={{ params: undefined } as never} onSignedOut={onSignedOut} />,
  );
  return onSignedOut;
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuth.mockReturnValue({ baseUrl: 'http://mac:3450', token: 't', username: 'alice' });
    mockClearAuth.mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows theme picker, server URL, and sign out', async () => {
    await renderSettings();
    expect(screen.getByLabelText('Theme picker')).toBeTruthy();
    expect(screen.getByLabelText('Theme system')).toBeTruthy();
    expect(screen.getByLabelText('Theme light')).toBeTruthy();
    expect(screen.getByLabelText('Theme dark')).toBeTruthy();
    expect(screen.getByLabelText('Server URL')).toBeTruthy();
    expect(screen.getByText('http://mac:3450')).toBeTruthy();
    expect(screen.getByLabelText('Sign out')).toBeTruthy();
  });

  it('theme picker calls setMode', async () => {
    await renderSettings();
    await fireEvent.press(screen.getByLabelText('Theme dark'));
    expect(mockSetMode).toHaveBeenCalledWith('dark');
    await fireEvent.press(screen.getByLabelText('Theme light'));
    expect(mockSetMode).toHaveBeenCalledWith('light');
  });

  it('sign out confirms then clears auth, closes socket, and resets to Connect', async () => {
    const alertMock = jest.spyOn(Alert, 'alert').mockImplementation((() => undefined) as never);
    const onSignedOut = await renderSettings();
    await fireEvent.press(screen.getByLabelText('Sign out'));
    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    const buttons = alertMock.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === 'Sign out');
    expect(confirm).toBeTruthy();
    await confirm?.onPress?.();
    await waitFor(() => expect(mockClearAuth).toHaveBeenCalled());
    expect(mockClose).toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalled();
    expect(onSignedOut).toHaveBeenCalled();
  });
});
