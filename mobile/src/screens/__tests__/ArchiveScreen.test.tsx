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

jest.mock('@/lib/api', () => ({
  fetchArchivedSessions: jest.fn(),
  restoreSession: jest.fn(),
  deleteSession: jest.fn(),
}));

import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ArchiveScreen } from '@/screens/ArchiveScreen';
import { deleteSession, fetchArchivedSessions, restoreSession } from '@/lib/api';
import * as Haptics from 'expo-haptics';

const mockFetchArchived = fetchArchivedSessions as jest.Mock;
const mockRestore = restoreSession as jest.Mock;
const mockDelete = deleteSession as jest.Mock;
const mockImpact = Haptics.impactAsync as jest.Mock;

const sessions = [
  { sessionId: 'a1', provider: 'claude', projectId: 'p1', projectDisplayName: 'Alpha', sessionTitle: 'Old chat' },
  { sessionId: 'a2', provider: 'codex', projectId: 'p1', projectDisplayName: 'Alpha', sessionTitle: 'Older chat' },
  { sessionId: 'b1', provider: 'claude', projectId: 'p2', projectDisplayName: 'Beta', sessionTitle: 'Beta old' },
];

const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() } as never;

function renderArchive() {
  return render(<ArchiveScreen navigation={navigation} route={{ params: undefined } as never} />);
}

describe('ArchiveScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchArchived.mockResolvedValue({ sessions });
    mockRestore.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue({ action: 'deleted' });
    jest.spyOn(Alert, 'alert').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('groups archived sessions by project', async () => {
    await renderArchive();
    await waitFor(() => expect(screen.getByText('Old chat')).toBeTruthy());
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Older chat')).toBeTruthy();
    expect(screen.getByText('Beta old')).toBeTruthy();
  });

  it('restores per row', async () => {
    await renderArchive();
    await waitFor(() => expect(screen.getByLabelText('Restore Old chat')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Restore Old chat'));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('a1'));
  });

  it('delete-forever confirms then calls deleteSession force with haptics', async () => {
    const alertMock = jest.spyOn(Alert, 'alert').mockImplementation((() => undefined) as never);
    await renderArchive();
    await waitFor(() => expect(screen.getByLabelText('Delete Old chat forever')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Delete Old chat forever'));
    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    const buttons = alertMock.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === 'Delete');
    await confirm?.onPress?.();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('a1', { force: true }));
    expect(mockImpact).toHaveBeenCalled();
  });

  it('shows error with retry', async () => {
    mockFetchArchived.mockRejectedValueOnce(new Error('archive boom'));
    await renderArchive();
    await waitFor(() => expect(screen.getByText('archive boom')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Retry loading archived sessions'));
    await waitFor(() => expect(screen.getByText('Old chat')).toBeTruthy());
  });
});
