jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/api', () => ({
  healthCheck: jest.fn(),
  login: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  loadLastServerUrl: jest.fn(),
  saveAuth: jest.fn(),
  saveLastServerUrl: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ConnectScreen } from '@/screens/ConnectScreen';
import { healthCheck, login } from '@/lib/api';
import { loadLastServerUrl, saveAuth, saveLastServerUrl } from '@/lib/store';

const mockHealthCheck = healthCheck as jest.Mock;
const mockLogin = login as jest.Mock;
const mockLoadLastServerUrl = loadLastServerUrl as jest.Mock;
const mockSaveAuth = saveAuth as jest.Mock;
const mockSaveLastServerUrl = saveLastServerUrl as jest.Mock;

const SERVER_PLACEHOLDER = 'Server URL (http://mac:3450)';

async function fillForm(url: string, username = 'alice', password = 'secret') {
  await fireEvent.changeText(screen.getByPlaceholderText(SERVER_PLACEHOLDER), url);
  await fireEvent.changeText(screen.getByPlaceholderText('Username'), username);
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
}

describe('ConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadLastServerUrl.mockResolvedValue(null);
    mockHealthCheck.mockResolvedValue(undefined);
    mockLogin.mockResolvedValue({ baseUrl: 'http://mac:3450', token: 'tok', username: 'alice' });
    mockSaveAuth.mockResolvedValue(undefined);
    mockSaveLastServerUrl.mockResolvedValue(undefined);
  });

  it('starts with an empty server URL field (no localhost default)', async () => {
    await render(<ConnectScreen onSignedIn={() => {}} />);
    const field = screen.getByPlaceholderText(SERVER_PLACEHOLDER);
    expect(field.props.value).toBe('');
    expect(field.props.value).not.toMatch(/localhost/);
    // Let the loadLastServerUrl effect settle (resolves null => stays empty).
    await waitFor(() => expect(mockLoadLastServerUrl).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(SERVER_PLACEHOLDER).props.value).toBe('');
  });

  it('surfaces a validation error when the URL is empty', async () => {
    mockHealthCheck.mockRejectedValueOnce(new Error('Server URL is required'));
    await render(<ConnectScreen onSignedIn={() => {}} />);
    expect(screen.queryByText('Server URL is required')).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('Username'), 'alice');
    await fireEvent.changeText(screen.getByPlaceholderText('Password'), 'secret');
    await fireEvent.press(screen.getByText('Sign In'));
    await waitFor(() => expect(screen.getByText('Server URL is required')).toBeTruthy());
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('surfaces a validation error when the URL is invalid', async () => {
    mockHealthCheck.mockRejectedValueOnce(
      new Error('Server URL must start with http:// or https://'),
    );
    await render(<ConnectScreen onSignedIn={jest.fn()} />);
    await fillForm('not-a-url');
    await fireEvent.press(screen.getByText('Sign In'));
    await waitFor(() =>
      expect(screen.getByText('Server URL must start with http:// or https://')).toBeTruthy(),
    );
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('calls healthCheck before login', async () => {
    const onSignedIn = jest.fn();
    await render(<ConnectScreen onSignedIn={onSignedIn} />);
    await fillForm('http://mac:3450');
    await fireEvent.press(screen.getByText('Sign In'));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(mockHealthCheck).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockHealthCheck).toHaveBeenCalledWith('http://mac:3450');
    const healthOrder = mockHealthCheck.mock.invocationCallOrder[0];
    const loginOrder = mockLogin.mock.invocationCallOrder[0];
    expect(healthOrder).toBeLessThan(loginOrder);
  });

  it('successful sign-in persists auth + last URL and calls onSignedIn', async () => {
    const auth = { baseUrl: 'http://mac:3450', token: 'tok-123', username: 'alice' };
    mockLogin.mockResolvedValueOnce(auth);
    const onSignedIn = jest.fn();
    await render(<ConnectScreen onSignedIn={onSignedIn} />);
    await fillForm('http://mac:3450');
    await fireEvent.press(screen.getByText('Sign In'));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(mockSaveAuth).toHaveBeenCalledWith(auth);
    expect(mockSaveLastServerUrl).toHaveBeenCalledWith('http://mac:3450');
  });

  it('failed login shows the error text and does not call onSignedIn', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid username or password'));
    const onSignedIn = jest.fn();
    await render(<ConnectScreen onSignedIn={onSignedIn} />);
    await fillForm('http://mac:3450', 'alice', 'wrong');
    await fireEvent.press(screen.getByText('Sign In'));

    await waitFor(() => expect(screen.getByText('Invalid username or password')).toBeTruthy());
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(mockSaveAuth).not.toHaveBeenCalled();
  });
});
