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

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
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
  fetchRunningSessions: jest.fn(),
  renameSession: jest.fn(),
  deleteSession: jest.fn(),
  toggleStar: jest.fn(),
  projectIdOf: jest.fn((p: { projectId?: string; id?: string; path?: string }) => p.projectId ?? p.id ?? p.path ?? ''),
  projectNameOf: jest.fn(
    (p: { displayName?: string; name?: string; path?: string }) => p.displayName ?? p.name ?? p.path ?? '',
  ),
  sessionIdOf: jest.fn((s: { id?: string; sessionId?: string }) => s.id ?? s.sessionId ?? ''),
}));

import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProjectsScreen } from '@/screens/ProjectsScreen';
import {
  deleteSession,
  fetchProjects,
  fetchRunningSessions,
  renameSession,
  toggleStar,
} from '@/lib/api';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

const mockFetchProjects = fetchProjects as jest.Mock;
const mockFetchRunning = fetchRunningSessions as jest.Mock;
const mockRename = renameSession as jest.Mock;
const mockDelete = deleteSession as jest.Mock;
const mockToggleStar = toggleStar as jest.Mock;
const mockCopy = Clipboard.setStringAsync as jest.Mock;
const mockImpact = Haptics.impactAsync as jest.Mock;

const recent = new Date(Date.now() - 2 * 60 * 1000).toISOString();
const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

// View-model name prefers `summary`, so keep title/summary aligned per row.
const projects = [
  {
    projectId: 'p1',
    displayName: 'Alpha',
    path: '/a',
    isStarred: true,
    sessions: [
      { id: 's1', provider: 'claude', title: 'Fix login bug', summary: 'Fix login bug', lastActivity: recent },
      { id: 's2', provider: 'codex', title: 'Refactor utils', summary: 'Refactor utils', lastActivity: old },
    ],
  },
  {
    projectId: 'p2',
    displayName: 'Beta',
    path: '/b',
    isStarred: false,
    sessions: [{ id: 's3', provider: 'claude', title: 'Write docs', summary: 'Write docs', lastActivity: old }],
  },
] as never;

const running = { sessions: [{ sessionId: 's2', provider: 'codex' }] };

const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

function renderProjects() {
  return render(
    <ProjectsScreen navigation={navigation as never} route={{ params: undefined } as never} />,
  );
}

async function expandFilters() {
  await fireEvent.press(screen.getByLabelText('Show filters'));
}

async function longPressRow(accessibilityLabel: RegExp) {
  const row = await screen.findByLabelText(accessibilityLabel);
  await fireEvent(row, 'longPress');
  return row;
}

describe('ProjectsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchProjects.mockResolvedValue(projects);
    mockFetchRunning.mockResolvedValue(running);
    mockRename.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue({ action: 'archived' });
    mockToggleStar.mockResolvedValue({ isStarred: false });
    mockCopy.mockResolvedValue(true);
    jest.spyOn(Alert, 'alert').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes the in-screen heading and hides filters behind a disclosure', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
    expect(screen.queryByText('Projects')).toBeNull();
    expect(screen.getByLabelText('Search projects and sessions')).toBeTruthy();
    expect(screen.getByLabelText('Show filters')).toBeTruthy();
    expect(screen.queryByLabelText('Filter all')).toBeNull();
    expect(screen.queryByLabelText('Open archive')).toBeNull();
    // New session lives in the header, not the list body.
    expect(screen.queryByLabelText('New session')).toBeNull();
    expect(navigation.setOptions).toHaveBeenCalled();
    await expandFilters();
    expect(screen.getByLabelText('Filter all')).toBeTruthy();
    expect(screen.getByLabelText('Filter starred')).toBeTruthy();
    expect(screen.getByLabelText('Filter running')).toBeTruthy();
    expect(screen.getByLabelText('Open archive')).toBeTruthy();
    expect(screen.getByText('Refactor utils')).toBeTruthy();
    expect(screen.getByText('Write docs')).toBeTruthy();
  });

  it('header new-session button navigates', async () => {
    await renderProjects();
    await waitFor(() => expect(navigation.setOptions).toHaveBeenCalled());
    const headerRight = navigation.setOptions.mock.calls[0][0].headerRight();
    const header = await render(headerRight);
    await fireEvent.press(header.getByLabelText('New session'));
    expect(navigation.navigate).toHaveBeenCalledWith('NewSession');
  });

  it('archive row inside the filters panel navigates', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
    await expandFilters();
    await fireEvent.press(screen.getByLabelText('Open archive'));
    expect(navigation.navigate).toHaveBeenCalledWith('Archive');
  });

  it('collapsed toggle names the active filter and clears it', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Write docs')).toBeTruthy());
    await expandFilters();
    await fireEvent.press(screen.getByLabelText('Filter starred'));
    await fireEvent.press(screen.getByLabelText('Hide filters'));
    expect(screen.getByLabelText('Show filters')).toBeTruthy();
    expect(screen.getByText('Filters · Starred')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Clear filters'));
    expect(screen.getByText('Write docs')).toBeTruthy();
    expect(screen.queryByLabelText('Clear filters')).toBeNull();
  });

  it('shows loading skeletons while projects load', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockFetchProjects.mockImplementationOnce(() => new Promise((res) => { resolve = res; }));
    const rendered = renderProjects();
    await waitFor(() => expect(screen.getByLabelText('Loading projects')).toBeTruthy());
    expect(screen.getAllByLabelText('Loading session row').length).toBeGreaterThan(2);
    await resolve(projects);
    await rendered;
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
  });

  it('filters client-side by title and summary', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Search projects and sessions'), 'docs');
    expect(screen.queryByText('Fix login bug')).toBeNull();
    expect(screen.getByText('Write docs')).toBeTruthy();
  });

  it('starred chip uses isStarred', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Write docs')).toBeTruthy());
    await expandFilters();
    await fireEvent.press(screen.getByLabelText('Filter starred'));
    expect(screen.getByText('Fix login bug')).toBeTruthy();
    expect(screen.getByText('Refactor utils')).toBeTruthy();
    expect(screen.queryByText('Write docs')).toBeNull();
  });

  it('running chip uses fetchRunningSessions', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Write docs')).toBeTruthy());
    expect(mockFetchRunning).toHaveBeenCalled();
    await expandFilters();
    await fireEvent.press(screen.getByLabelText('Filter running'));
    expect(screen.getByText('Refactor utils')).toBeTruthy();
    expect(screen.queryByText('Fix login bug')).toBeNull();
    expect(screen.queryByText('Write docs')).toBeNull();
  });

  it('provider chips filter by provider', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Write docs')).toBeTruthy());
    await expandFilters();
    await fireEvent.press(screen.getByLabelText('Filter provider codex'));
    expect(screen.getByText('Refactor utils')).toBeTruthy();
    expect(screen.queryByText('Fix login bug')).toBeNull();
    expect(screen.queryByText('Write docs')).toBeNull();
  });

  it('blocks actions while the session is running', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Refactor utils')).toBeTruthy());
    await longPressRow(/Refactor utils/);
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Session is running',
        expect.any(String),
        expect.any(Array),
      ),
    );
    expect(mockToggleStar).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('long-press menu stars via toggleStar', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
    await longPressRow(/Fix login bug/);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const star = buttons.find((b) => b.text === 'Unstar' || b.text === 'Star');
    expect(star).toBeTruthy();
    await star?.onPress?.();
    await waitFor(() => expect(mockToggleStar).toHaveBeenCalledWith('p1'));
  });

  it('long-press menu copies the session id', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
    await longPressRow(/Fix login bug/);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const copy = buttons.find((b) => b.text === 'Copy session ID');
    expect(copy).toBeTruthy();
    await copy?.onPress?.();
    expect(mockCopy).toHaveBeenCalledWith('s1');
  });

  it('delete confirms then calls deleteSession force with haptics', async () => {
    const alertMock = jest.spyOn(Alert, 'alert').mockImplementation((() => undefined) as never);
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
    await longPressRow(/Fix login bug/);
    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    const buttons = alertMock.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const del = buttons.find((b) => b.text === 'Delete');
    await del?.onPress?.();
    // Second alert is the destructive confirm.
    await waitFor(() => expect(alertMock).toHaveBeenCalledTimes(2));
    const confirmButtons = alertMock.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    const confirm = confirmButtons.find((b) => b.text === 'Delete');
    await confirm?.onPress?.();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('s1', { force: true }));
    expect(mockImpact).toHaveBeenCalled();
  });

  it('rename opens inline edit and calls renameSession', async () => {
    await renderProjects();
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
    await longPressRow(/Fix login bug/);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const rename = buttons.find((b) => b.text === 'Rename');
    await rename?.onPress?.();
    const input = await screen.findByLabelText('Rename session');
    await fireEvent.changeText(input, 'New name');
    await fireEvent.press(screen.getByLabelText('Save rename'));
    await waitFor(() => expect(mockRename).toHaveBeenCalledWith('s1', 'New name'));
  });

  it('shows error with retry', async () => {
    mockFetchProjects.mockRejectedValueOnce(new Error('boom'));
    await renderProjects();
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Retry loading projects'));
    await waitFor(() => expect(screen.getByText('Fix login bug')).toBeTruthy());
  });
});
