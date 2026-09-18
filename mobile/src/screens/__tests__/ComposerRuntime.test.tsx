/**
 * Phase 3b composer + runtime tests: session settings sheet (agent/model/effort),
 * image attachments, permission approvals, queue-while-busy, and the offline hold.
 *
 * Follows the mock patterns in `ChatScreen.test.tsx` (mocked REST/socket,
 * controllable NetInfo + socket-status listeners).
 */
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

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
  getStringAsync: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/ui/ProviderLogo', () => ({
  ProviderLogo: () => null,
}));

jest.mock('@/lib/api', () => ({
  fetchMessages: jest.fn(),
  fetchSessionDetail: jest.fn(),
  sessionIdOf: jest.fn((session: { id?: string; sessionId?: string }) => session.id ?? session.sessionId ?? ''),
  fetchCapabilities: jest.fn(),
  fetchAgents: jest.fn(),
  fetchModels: jest.fn(),
  fetchActiveModel: jest.fn(),
  fetchTokenUsage: jest.fn(),
  setActiveModel: jest.fn(),
  setActiveEffort: jest.fn(),
  uploadImages: jest.fn(),
}));

const mockNet = {
  connected: true,
  listener: null as null | ((state: { isConnected: boolean | null }) => void),
};

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() => Promise.resolve({ isConnected: mockNet.connected })),
    addEventListener: jest.fn((listener: (state: { isConnected: boolean | null }) => void) => {
      mockNet.listener = listener;
      return jest.fn();
    }),
  },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  providerLabel: jest.fn((provider?: string) =>
    provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'CloudCLI',
  ),
  loadFavouriteModels: jest.fn(async () => ({})),
  saveFavouriteModels: jest.fn(async () => undefined),
}));

jest.mock('@/lib/ws', () => ({
  chatSocket: {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    onEvent: jest.fn(),
    onStatus: jest.fn(),
    isConnected: jest.fn(() => false),
    onOutboxFlush: jest.fn(),
    sendMessage: jest.fn(),
    respondToPermission: jest.fn(),
    isOpen: jest.fn(),
    getOutbox: jest.fn(() => []),
    abort: jest.fn(),
  },
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ChatScreen } from '@/screens/ChatScreen';
import {
  fetchActiveModel,
  fetchAgents,
  fetchCapabilities,
  fetchMessages,
  fetchModels,
  fetchTokenUsage,
  setActiveEffort,
  setActiveModel,
  uploadImages,
} from '@/lib/api';
import { chatSocket } from '@/lib/ws';
import { saveFavouriteModels } from '@/lib/store';

const mockFetchMessages = fetchMessages as jest.Mock;
const mockFetchCapabilities = fetchCapabilities as jest.Mock;
const mockFetchAgents = fetchAgents as jest.Mock;
const mockFetchModels = fetchModels as jest.Mock;
const mockFetchActiveModel = fetchActiveModel as jest.Mock;
const mockFetchTokenUsage = fetchTokenUsage as jest.Mock;
const mockSetActiveModel = setActiveModel as jest.Mock;
const mockSetActiveEffort = setActiveEffort as jest.Mock;
const mockUploadImages = uploadImages as jest.Mock;
const mockRequestLibrary = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const mockLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;
const mockSocket = chatSocket as unknown as {
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  onEvent: jest.Mock;
  onStatus: jest.Mock;
  sendMessage: jest.Mock;
  respondToPermission: jest.Mock;
};
const alertSpy = jest.spyOn(Alert, 'alert');

type Listener = (event: Record<string, unknown>) => void;
type AlertButton = { text: string; style?: string; onPress?: () => void };

const project = { projectId: 'p1', displayName: 'Proj', path: '/tmp/proj' } as never;
const session = { id: 's1', provider: 'claude', title: 'Test session' } as never;
const navigation = { setOptions: jest.fn(), goBack: jest.fn() } as never;
const routeWithObjects = { params: { project, session } } as never;

let statusListener: ((connected: boolean) => void) | null = null;

function currentListener(): Listener {
  expect(mockSocket.onEvent).toHaveBeenCalled();
  return mockSocket.onEvent.mock.calls[mockSocket.onEvent.mock.calls.length - 1][0] as Listener;
}

async function emit(event: Record<string, unknown>) {
  await act(async () => {
    currentListener()(event);
  });
}

async function goOnline() {
  await act(async () => {
    mockNet.connected = true;
    mockNet.listener?.({ isConnected: true });
    statusListener?.(true);
  });
}

const now = () => new Date().toISOString();

describe('ComposerRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy.mockImplementation(() => undefined);
    mockNet.connected = true;
    mockNet.listener = null;
    statusListener = null;
    mockSocket.onEvent.mockImplementation(() => jest.fn());
    mockSocket.onStatus.mockImplementation((listener: (connected: boolean) => void) => {
      statusListener = listener;
      return jest.fn();
    });
    mockSocket.sendMessage.mockReturnValue('sent');
    mockSocket.respondToPermission.mockReturnValue('sent');
    mockFetchMessages.mockResolvedValue({ messages: [] });
    mockFetchTokenUsage.mockResolvedValue({ unsupported: true });
    mockFetchCapabilities.mockResolvedValue({
      providers: [{
        provider: 'claude',
        supportsImages: true,
        supportsEffort: true,
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
      }],
    });
    mockFetchAgents.mockResolvedValue({ agents: [] });
    mockFetchModels.mockResolvedValue({
      options: [
        {
          value: 'sonnet',
          label: 'Sonnet',
          effort: { values: [{ value: 'low' }, { value: 'high' }] },
        },
        { value: 'opus', label: 'Opus' },
      ],
      default: 'sonnet',
    });
    mockFetchActiveModel.mockResolvedValue({
      provider: 'claude',
      sessionId: 's1',
      model: 'sonnet',
      effort: 'high',
      source: 'session',
    });
    mockSetActiveModel.mockResolvedValue(undefined);
    mockSetActiveEffort.mockResolvedValue(undefined);
    mockUploadImages.mockResolvedValue([
      { path: '/assets/a.png', name: 'a.png', mimeType: 'image/png' },
    ]);
    mockRequestLibrary.mockResolvedValue({ granted: true });
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: [] });
  });

  async function renderChat() {
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(mockFetchMessages).toHaveBeenCalled());
    await goOnline();
  }

  it('opens the settings sheet from the badge and persists model + effort', async () => {
    await renderChat();

    const badge = await waitFor(() =>
      screen.getByLabelText('Session settings, current Sonnet'),
    );
    await fireEvent.press(badge);

    await waitFor(() => expect(screen.getByLabelText('Select model Opus')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Select model Opus'));
    await waitFor(() =>
      expect(mockSetActiveModel).toHaveBeenCalledWith('claude', 's1', 'opus'),
    );

    // Effort row shows because capabilities report supportsEffort.
    await fireEvent.press(screen.getByLabelText('Select effort low'));
    await waitFor(() =>
      expect(mockSetActiveEffort).toHaveBeenCalledWith('claude', 's1', 'low'),
    );
  });

  it('hides the effort row when the provider does not support it', async () => {
    mockFetchCapabilities.mockResolvedValue({
      providers: [{ provider: 'claude', supportsImages: true, supportsEffort: false }],
    });
    await renderChat();

    await fireEvent.press(
      await waitFor(() => screen.getByLabelText('Session settings, current Sonnet')),
    );
    await waitFor(() => expect(screen.getByLabelText('Select model Opus')).toBeTruthy());
    expect(screen.queryByLabelText('Select effort low')).toBeNull();
  });

  it('selects the plan agent and carries agent instead of permissionMode', async () => {
    mockFetchCapabilities.mockResolvedValue({
      providers: [{
        provider: 'opencode',
        supportsImages: true,
        supportsEffort: true,
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
      }],
    });
    const opencodeSession = { id: 's1', provider: 'opencode', title: 'Opencode session' } as never;
    await render(
      <ChatScreen
        route={{ params: { project, session: opencodeSession } } as never}
        navigation={navigation}
      />,
    );
    await waitFor(() => expect(mockFetchMessages).toHaveBeenCalled());
    await goOnline();

    await fireEvent.press(
      await waitFor(() => screen.getByLabelText('Session settings, current Sonnet')),
    );
    await waitFor(() => expect(screen.getByLabelText('Select agent Plan')).toBeTruthy());
    expect(screen.queryByLabelText('Select permission mode Plan')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Select agent Plan'));
    await fireEvent.press(screen.getByLabelText('Close settings'));

    await waitFor(() =>
      expect(screen.getByLabelText('Session settings, current Sonnet · Plan')).toBeTruthy(),
    );
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'hello plan');
    await fireEvent.press(screen.getByText('↑'));

    await waitFor(() =>
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        's1',
        'hello plan',
        expect.objectContaining({ model: 'sonnet', effort: 'high', agent: 'plan' }),
      ),
    );
    expect(mockSocket.sendMessage).not.toHaveBeenCalledWith(
      's1',
      'hello plan',
      expect.objectContaining({ permissionMode: 'plan' }),
    );
  });

  it('selects a custom agent and carries it on every send', async () => {
    mockFetchCapabilities.mockResolvedValue({
      providers: [{
        provider: 'opencode',
        supportsImages: true,
        supportsEffort: true,
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
      }],
    });
    mockFetchAgents.mockResolvedValue({
      agents: [{ name: 'crew-builder', description: 'Builds.', scope: 'user', sourcePath: '/a.md' }],
    });
    const opencodeSession = { id: 's1', provider: 'opencode', title: 'Opencode session' } as never;
    await render(
      <ChatScreen
        route={{ params: { project, session: opencodeSession } } as never}
        navigation={navigation}
      />,
    );
    await waitFor(() => expect(mockFetchMessages).toHaveBeenCalled());
    await goOnline();
    await waitFor(() => expect(mockFetchAgents).toHaveBeenCalled());

    await fireEvent.press(
      await waitFor(() => screen.getByLabelText('Session settings, current Sonnet')),
    );
    await waitFor(() => expect(screen.getByLabelText('Select agent crew-builder')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Select agent crew-builder'));
    await fireEvent.press(screen.getByLabelText('Close settings'));

    await waitFor(() =>
      expect(screen.getByLabelText('Session settings, current Sonnet · crew-builder')).toBeTruthy(),
    );
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'hello crew');
    await fireEvent.press(screen.getByText('↑'));

    await waitFor(() =>
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        's1',
        'hello crew',
        expect.objectContaining({ agent: 'crew-builder' }),
      ),
    );
  });

  it('stars a model into Favourites and persists them', async () => {
    await renderChat();

    await fireEvent.press(
      await waitFor(() => screen.getByLabelText('Session settings, current Sonnet')),
    );
    await waitFor(() => expect(screen.getByLabelText('Select model Opus')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Favourite model Opus'));
    await waitFor(() =>
      expect(saveFavouriteModels).toHaveBeenCalledWith({ claude: ['opus'] }),
    );
    expect(screen.getByText('Favourites')).toBeTruthy();
    expect(screen.getByLabelText('Unfavourite model Opus')).toBeTruthy();
  });

  it('hides the agent section when the capability omits permission modes', async () => {
    mockFetchCapabilities.mockResolvedValue({
      providers: [{ provider: 'claude', supportsImages: true, supportsEffort: true }],
    });
    await renderChat();

    await fireEvent.press(
      await waitFor(() => screen.getByLabelText('Session settings, current Sonnet')),
    );
    await waitFor(() => expect(screen.getByLabelText('Select model Opus')).toBeTruthy());
    expect(screen.queryByLabelText('Select permission mode Plan')).toBeNull();
  });

  it('carries the active model + effort on every send', async () => {
    await renderChat();

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'hello model');
    await fireEvent.press(screen.getByText('↑'));

    await waitFor(() =>
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        's1',
        'hello model',
        expect.objectContaining({ model: 'sonnet', effort: 'high' }),
      ),
    );
  });

  it('queues a draft behind a running turn and sends it on complete', async () => {
    await renderChat();

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'first');
    await fireEvent.press(screen.getByText('↑'));
    expect(mockSocket.sendMessage).toHaveBeenCalledTimes(1);

    // A run is now in flight: Enter queues instead of racing the server.
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'second');
    await fireEvent.press(screen.getByText('↑'));
    expect(mockSocket.sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Cancel queued message')).toBeTruthy();

    await emit({ kind: 'complete', sessionId: 's1', id: 'c1', timestamp: now() });

    await waitFor(() => expect(mockSocket.sendMessage).toHaveBeenCalledTimes(2));
    expect(mockSocket.sendMessage).toHaveBeenLastCalledWith(
      's1',
      'second',
      expect.anything(),
    );
    expect(screen.queryByLabelText('Cancel queued message')).toBeNull();
  });

  it('cancelling the queued chip restores the draft to the composer', async () => {
    await renderChat();

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'first');
    await fireEvent.press(screen.getByText('↑'));
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'second');
    await fireEvent.press(screen.getByText('↑'));
    expect(screen.getByLabelText('Cancel queued message')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Cancel queued message'));

    expect(screen.queryByLabelText('Cancel queued message')).toBeNull();
    expect(screen.getByLabelText('Message input').props.value).toBe('second');
    expect(mockSocket.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('queues multiple drafts and sends them FIFO across completes', async () => {
    await renderChat();

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'first');
    await fireEvent.press(screen.getByText('↑'));
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'second');
    await fireEvent.press(screen.getByText('↑'));
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'third');
    await fireEvent.press(screen.getByText('↑'));
    // Nothing new raced the in-flight run.
    expect(mockSocket.sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByText('⏳ 2 queued: second — tap to cancel')).toBeTruthy();

    await emit({ kind: 'complete', sessionId: 's1', id: 'c1', timestamp: now() });
    await waitFor(() => expect(mockSocket.sendMessage).toHaveBeenCalledTimes(2));
    expect(mockSocket.sendMessage).toHaveBeenLastCalledWith(
      's1',
      'second',
      expect.anything(),
    );
    expect(screen.getByLabelText('Cancel queued message')).toBeTruthy();

    await emit({ kind: 'complete', sessionId: 's1', id: 'c2', timestamp: now() });
    await waitFor(() => expect(mockSocket.sendMessage).toHaveBeenCalledTimes(3));
    expect(mockSocket.sendMessage).toHaveBeenLastCalledWith(
      's1',
      'third',
      expect.anything(),
    );
    expect(screen.queryByLabelText('Cancel queued message')).toBeNull();
  });

  it('cancelling clears every held turn and restores the latest', async () => {
    await renderChat();

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'first');
    await fireEvent.press(screen.getByText('↑'));
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'second');
    await fireEvent.press(screen.getByText('↑'));
    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'third');
    await fireEvent.press(screen.getByText('↑'));

    await fireEvent.press(screen.getByLabelText('Cancel queued message'));

    expect(screen.queryByLabelText('Cancel queued message')).toBeNull();
    expect(screen.getByLabelText('Message input').props.value).toBe('third');
    expect(mockSocket.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('prompts for permission requests and answers allow-once', async () => {
    await renderChat();

    await emit({
      kind: 'permission_request',
      sessionId: 's1',
      id: 'p1',
      timestamp: now(),
      requestId: 'req-1',
      toolName: 'Bash',
      input: { command: 'npm test' },
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(screen.getByLabelText('Review pending permission')).toBeTruthy();

    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as AlertButton[];
    expect(buttons.map((button) => button.text)).toEqual(
      expect.arrayContaining(['Deny', 'Allow once']),
    );
    await act(async () => {
      buttons.find((button) => button.text === 'Allow once')?.onPress?.();
    });

    expect(mockSocket.respondToPermission).toHaveBeenCalledWith('req-1', { allow: true });
    await waitFor(() =>
      expect(screen.queryByLabelText('Review pending permission')).toBeNull(),
    );
  });

  it('supports allow-and-remember with a real permission entry', async () => {
    await renderChat();

    await emit({
      kind: 'permission_request',
      sessionId: 's1',
      id: 'p1',
      timestamp: now(),
      requestId: 'req-2',
      toolName: 'Bash',
      input: { command: 'npm test' },
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as AlertButton[];
    await act(async () => {
      buttons.find((button) => button.text === 'Allow & remember')?.onPress?.();
    });

    expect(mockSocket.respondToPermission).toHaveBeenCalledWith('req-2', {
      allow: true,
      rememberEntry: 'Bash(npm:*)',
    });
  });

  it('surfaces approvals from the subscribe ack, never stalling silently', async () => {
    await renderChat();

    await emit({
      kind: 'chat_subscribed',
      sessionId: 's1',
      isProcessing: true,
      pendingPermissions: [{ requestId: 'req-9', toolName: 'Read', input: '/tmp/x' }],
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as AlertButton[];
    await act(async () => {
      buttons.find((button) => button.text === 'Deny')?.onPress?.();
    });
    expect(mockSocket.respondToPermission).toHaveBeenCalledWith(
      'req-9',
      expect.objectContaining({ allow: false }),
    );
  });

  it('holds sends while offline as waiting rows and clears them on reconnect', async () => {
    mockNet.connected = false;
    mockSocket.sendMessage.mockReturnValue('queued');
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(mockFetchMessages).toHaveBeenCalled());

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'offline hello');
    await fireEvent.press(screen.getByText('↑'));

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      's1',
      'offline hello',
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText('Waiting to send…')).toBeTruthy());

    mockSocket.sendMessage.mockReturnValue('sent');
    await goOnline();

    await waitFor(() => expect(screen.queryByText('Waiting to send…')).toBeNull());
  });

  it('attaches an image and sends its stored descriptor in options', async () => {
    await renderChat();
    expect(screen.getByLabelText('Attach image')).toBeTruthy();

    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/a.png', fileName: 'a.png', mimeType: 'image/png' }],
    });
    await fireEvent.press(screen.getByLabelText('Attach image'));

    await waitFor(() => expect(mockUploadImages).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Attachment 1')).toBeTruthy());

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'look at this');
    await fireEvent.press(screen.getByText('↑'));

    await waitFor(() =>
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        's1',
        'look at this',
        expect.objectContaining({
          attachments: [{ path: '/assets/a.png', name: 'a.png', mimeType: 'image/png' }],
        }),
      ),
    );
  });

  it('hides the attach button when the provider lacks image support', async () => {
    mockFetchCapabilities.mockResolvedValue({
      providers: [{ provider: 'claude', supportsImages: false, supportsEffort: false }],
    });
    await renderChat();
    expect(screen.queryByLabelText('Attach image')).toBeNull();
  });
});
