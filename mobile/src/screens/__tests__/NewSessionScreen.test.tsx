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

jest.mock('@/ui/ProviderLogo', () => ({
  ProviderLogo: () => null,
}));

jest.mock('@/lib/store', () => ({
  providerLabel: jest.fn((provider?: string) =>
    provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'CloudCLI',
  ),
}));

jest.mock('@/lib/api', () => ({
  fetchProjects: jest.fn(),
  fetchCapabilities: jest.fn(),
  fetchModels: jest.fn(),
  createSession: jest.fn(),
  projectIdOf: jest.fn((p: { projectId?: string; id?: string; path?: string }) => p.projectId ?? p.id ?? p.path ?? ''),
  projectNameOf: jest.fn(
    (p: { displayName?: string; name?: string; path?: string }) => p.displayName ?? p.name ?? p.path ?? '',
  ),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NewSessionScreen } from '@/screens/NewSessionScreen';
import { createSession, fetchCapabilities, fetchModels, fetchProjects } from '@/lib/api';

const mockFetchProjects = fetchProjects as jest.Mock;
const mockFetchCaps = fetchCapabilities as jest.Mock;
const mockFetchModels = fetchModels as jest.Mock;
const mockCreate = createSession as jest.Mock;

const projects = [
  { projectId: 'p1', displayName: 'Alpha', path: '/a' },
  { projectId: 'p2', displayName: 'Beta', path: '/b' },
] as never;

const navigationMock = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() };

function renderNewSession() {
  return render(<NewSessionScreen navigation={navigationMock as never} route={{ params: undefined } as never} />);
}

describe('NewSessionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchProjects.mockResolvedValue(projects);
    mockFetchCaps.mockResolvedValue({ providers: [{ provider: 'claude' }, { provider: 'codex' }] });
    mockFetchModels.mockResolvedValue({
      options: [{ value: 'm1', label: 'Model One' }],
      default: 'm1',
    });
    mockCreate.mockResolvedValue({ sessionId: 's-new', provider: 'claude', projectPath: '/b', sessionName: 'Hi' });
  });

  it('starts on the project step without providers or models', async () => {
    await renderNewSession();
    await waitFor(() => expect(screen.getByLabelText('Continue with Alpha')).toBeTruthy());
    expect(screen.getByLabelText('Continue with Beta')).toBeTruthy();
    expect(screen.queryByLabelText('Select provider claude')).toBeNull();
    expect(screen.queryByLabelText('Start chatting')).toBeNull();
  });

  it('tapping a project advances to setup with providers and models', async () => {
    await renderNewSession();
    await waitFor(() => expect(screen.getByLabelText('Continue with Beta')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Continue with Beta'));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Select provider claude')).toBeTruthy();
    expect(screen.getByLabelText('Select provider codex')).toBeTruthy();
    await waitFor(() => expect(mockFetchModels).toHaveBeenCalledWith('claude'));
    await waitFor(() => expect(screen.getByLabelText('Select model Model One')).toBeTruthy());
    expect(screen.getByLabelText('First message (optional)')).toBeTruthy();
  });

  it('setup starts a chat with the chosen project and message', async () => {
    await renderNewSession();
    await waitFor(() => expect(screen.getByLabelText('Continue with Beta')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Continue with Beta'));
    await fireEvent.press(screen.getByLabelText('Select provider claude'));
    await waitFor(() => expect(screen.getByLabelText('Select model Model One')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('First message (optional)'), 'hello');
    await fireEvent.press(screen.getByLabelText('Start chatting'));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('claude', '/b', 'hello'),
    );
    expect(navigationMock.navigate).toHaveBeenCalledWith(
      'Chat',
      expect.objectContaining({ sessionId: 's-new' }),
    );
  });

  it('change project returns to the project step', async () => {
    await renderNewSession();
    await waitFor(() => expect(screen.getByLabelText('Continue with Beta')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Continue with Beta'));
    await waitFor(() => expect(screen.getByLabelText('Change project')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Change project'));
    expect(screen.getByLabelText('Continue with Alpha')).toBeTruthy();
    expect(screen.queryByLabelText('Start chatting')).toBeNull();
  });

  it('surfaces load errors', async () => {
    mockFetchProjects.mockRejectedValueOnce(new Error('load failed'));
    await renderNewSession();
    await waitFor(() => expect(screen.getByText('load failed')).toBeTruthy());
  });

  it('surfaces create errors without navigating', async () => {
    mockCreate.mockRejectedValueOnce(new Error('create failed'));
    await renderNewSession();
    await waitFor(() => expect(screen.getByLabelText('Continue with Alpha')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Continue with Alpha'));
    await waitFor(() => expect(screen.getByLabelText('Start chatting')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Start chatting'));
    await waitFor(() => expect(screen.getByText('create failed')).toBeTruthy());
    expect(navigationMock.navigate).not.toHaveBeenCalled();
  });
});
