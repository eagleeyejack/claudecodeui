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

// Mock only the network functions: return the already-unwrapped `{ messages }`
// shape (the real `fetchMessages` unwraps the `{success,data}` envelope
// internally, so tests bypass HTTP and assert on the UI contract).
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

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
    addEventListener: jest.fn(() => jest.fn()),
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
import * as Clipboard from 'expo-clipboard';
import { ChatScreen } from '@/screens/ChatScreen';
import {
  fetchActiveModel,
  fetchCapabilities,
  fetchMessages,
  fetchModels,
  fetchTokenUsage,
} from '@/lib/api';
import { chatSocket } from '@/lib/ws';

const mockFetchMessages = fetchMessages as jest.Mock;
const mockFetchTokenUsage = fetchTokenUsage as jest.Mock;
const mockFetchCapabilities = fetchCapabilities as jest.Mock;
const mockFetchModels = fetchModels as jest.Mock;
const mockFetchActiveModel = fetchActiveModel as jest.Mock;
const mockClipboard = Clipboard as unknown as { setStringAsync: jest.Mock };
const mockSocket = chatSocket as unknown as {
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  onEvent: jest.Mock;
  onStatus: jest.Mock;
  onOutboxFlush: jest.Mock;
  sendMessage: jest.Mock;
  respondToPermission: jest.Mock;
  isOpen: jest.Mock;
  getOutbox: jest.Mock;
  abort: jest.Mock;
};

type Listener = (event: Record<string, unknown>) => void;

const project = { projectId: 'p1', displayName: 'Proj', path: '/tmp/proj' } as never;
const session = { id: 's1', title: 'Test session' } as never;

// Screens take navigation props; tests drive the in-app path (full objects).
const navigation = { setOptions: jest.fn(), goBack: jest.fn() } as never;
const routeWithObjects = { params: { project, session } } as never;

async function renderChat() {
  await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
}

function currentListener(): Listener {
  expect(mockSocket.onEvent).toHaveBeenCalled();
  return mockSocket.onEvent.mock.calls[mockSocket.onEvent.mock.calls.length - 1][0] as Listener;
}

async function emit(event: Record<string, unknown>) {
  await act(async () => {
    currentListener()(event);
  });
}

const now = () => new Date().toISOString();

describe('ChatScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSocket.onEvent.mockImplementation(() => jest.fn());
    mockSocket.onStatus.mockImplementation(() => jest.fn());
    mockSocket.sendMessage.mockReturnValue('sent');
    mockSocket.isOpen.mockReturnValue(true);
    mockFetchMessages.mockResolvedValue({ messages: [] });
    // Usage header hides by default so transcript tests stay focused.
    mockFetchTokenUsage.mockResolvedValue({ unsupported: true });
    // Composer runtime loads capabilities + session model on mount.
    mockFetchCapabilities.mockResolvedValue({ providers: [] });
    mockFetchModels.mockResolvedValue({ options: [], default: '' });
    mockFetchActiveModel.mockResolvedValue({ provider: 'claude', sessionId: 's1', model: '', effort: null, source: 'default' });
  });

  it('renders REST history on mount', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'm1', sessionId: 's1', timestamp: now(), role: 'user', kind: 'text', content: 'hello history' },
        { id: 'm2', sessionId: 's1', timestamp: now(), role: 'assistant', kind: 'text', content: 'hi back' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(mockFetchMessages).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.getByText('hello history')).toBeTruthy());
    expect(screen.getByText('hi back')).toBeTruthy();
  });

  it('appends live WS frames by id', async () => {
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(mockFetchMessages).toHaveBeenCalled());
    await emit({
      sessionId: 's1',
      id: 'live-1',
      timestamp: now(),
      role: 'assistant',
      kind: 'text',
      content: 'live hello world',
    });
    await waitFor(() => expect(screen.getByText('live hello world')).toBeTruthy());
  });

  it('replaces (not duplicates) on duplicate id for streaming updates', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'stream-1', sessionId: 's1', timestamp: now(), role: 'assistant', kind: 'text', content: 'AAA streaming' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('AAA streaming')).toBeTruthy());

    await emit({
      sessionId: 's1',
      id: 'stream-1',
      timestamp: now(),
      role: 'assistant',
      kind: 'text',
      content: 'BBB complete',
    });

    await waitFor(() => expect(screen.getByText('BBB complete')).toBeTruthy());
    expect(screen.queryByText('AAA streaming')).toBeNull();
    expect(screen.queryAllByText('BBB complete')).toHaveLength(1);
  });

  it('folds an optimistic local-* echo + server user row into ONE bubble', async () => {
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(mockFetchMessages).toHaveBeenCalled());

    await fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'hello echo');
    await fireEvent.press(screen.getByText('↑'));

    await waitFor(() => expect(screen.queryAllByText('hello echo')).toHaveLength(1));
    // chat.send always carries an options object (model/effort/attachments).
    expect(mockSocket.sendMessage).toHaveBeenCalledWith('s1', 'hello echo', {});

    // Server broadcasts its own persisted user row with identical content and
    // a timestamp inside the 30s dedupe window: must replace, not duplicate.
    await emit({
      sessionId: 's1',
      id: 'server-1',
      timestamp: now(),
      role: 'user',
      kind: 'text',
      content: 'hello echo',
    });

    await act(async () => {});
    expect(screen.queryAllByText('hello echo')).toHaveLength(1);
  });

  it('renders tool-kind rows distinctly from text rows', async () => {    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 't1', sessionId: 's1', timestamp: now(), role: 'assistant', kind: 'tool', content: 'read file.ts' },
        { id: 'm2', sessionId: 's1', timestamp: now(), role: 'assistant', kind: 'text', content: 'plain answer here' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('plain answer here')).toBeTruthy());
    // Tool rows carry the gear prefix; text rows render bare content.
    expect(screen.getByText(/⚙︎/)).toBeTruthy();
    expect(screen.getByText(/read file\.ts/)).toBeTruthy();
  });

  it('orders newest messages at the bottom (reversed data on the inverted list)', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'm1', sessionId: 's1', timestamp: now(), role: 'user', kind: 'text', content: 'first message' },
        { id: 'm2', sessionId: 's1', timestamp: now(), role: 'assistant', kind: 'text', content: 'second message' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('second message')).toBeTruthy());
    const data = screen.getByTestId('message-list').props.data as Array<{ id: string }>;
    expect(data.map((message) => message.id)).toEqual(['m2', 'm1']);
  });

  it('shows a scroll-to-latest FAB only when scrolled up', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'm1', sessionId: 's1', timestamp: now(), role: 'user', kind: 'text', content: 'fab check' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('fab check')).toBeTruthy());
    expect(screen.queryByLabelText('Scroll to latest messages')).toBeNull();

    await fireEvent.scroll(screen.getByTestId('message-list'), {
      nativeEvent: {
        contentOffset: { y: 300, x: 0 },
        contentSize: { width: 100, height: 2000 },
        layoutMeasurement: { width: 100, height: 600 },
      },
    });
    await waitFor(() => expect(screen.getByLabelText('Scroll to latest messages')).toBeTruthy());
  });

  it('offers Load earlier messages at the top, re-running the loader', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'm1', sessionId: 's1', timestamp: now(), role: 'user', kind: 'text', content: 'paging check' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('paging check')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Load earlier messages'));
    // fetchMessages takes no paging params yet: the button re-runs the full
    // loader until the server adds limit/offset (see ChatScreen note).
    expect(mockFetchMessages).toHaveBeenCalledTimes(2);
  });

  it('renders thinking rows as a collapsible Thinking row, not a bubble', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          id: 'th1',
          sessionId: 's1',
          timestamp: now(),
          role: 'assistant',
          kind: 'text',
          content: 'hidden reasoning',
          isThinking: true,
        },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Toggle thinking details')).toBeTruthy());
    // Finished thinking starts collapsed and is not a copyable bubble.
    expect(screen.queryByText('hidden reasoning')).toBeNull();
    expect(screen.queryByLabelText('Copy message')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Toggle thinking details'));
    await waitFor(() => expect(screen.getByText('hidden reasoning')).toBeTruthy());
  });

  it('shows a streaming indicator on in-progress assistant messages', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          id: 'st1',
          sessionId: 's1',
          timestamp: now(),
          role: 'assistant',
          kind: 'text',
          content: 'partial answer',
          isStreaming: true,
        },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Streaming response')).toBeTruthy());
    expect(screen.getByText('Streaming…')).toBeTruthy();
  });

  it('renders error rows with a Retry affordance', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          id: 'e1',
          sessionId: 's1',
          timestamp: now(),
          role: 'assistant',
          kind: 'text',
          content: 'partial answer',
          error: 'Something went wrong',
        },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Retry failed message'));
    expect(mockFetchMessages).toHaveBeenCalledTimes(2);
  });

  it('shows timestamps under bubbles', async () => {
    const timestamp = '2026-09-17T12:34:56.000Z';
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'm1', sessionId: 's1', timestamp, role: 'user', kind: 'text', content: 'timestamp check' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('timestamp check')).toBeTruthy());
    expect(screen.getByText(new Date(timestamp).toLocaleTimeString())).toBeTruthy();
  });

  it('copies bubble text on long-press', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'm1', sessionId: 's1', timestamp: now(), role: 'user', kind: 'text', content: 'copy me please' },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('copy me please')).toBeTruthy());
    await fireEvent(screen.getByLabelText('Copy message'), 'longPress');
    expect(mockClipboard.setStringAsync).toHaveBeenCalledWith('copy me please');
  });

  it('expands tool rows on tap instead of 3-line truncation', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          id: 't1',
          sessionId: 's1',
          timestamp: now(),
          role: 'assistant',
          kind: 'tool',
          content: 'read file.ts line one\nline two\nline three\nline four',
        },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Expand tool output')).toBeTruthy());
    expect(screen.getByText(/read file\.ts/).props.numberOfLines).toBe(3);

    await fireEvent.press(screen.getByLabelText('Expand tool output'));
    await waitFor(() => expect(screen.getByLabelText('Collapse tool output')).toBeTruthy());
    expect(screen.getByText(/read file\.ts/).props.numberOfLines).toBeFalsy();
  });

  it('renders code blocks with a Copy button', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          id: 'c1',
          sessionId: 's1',
          timestamp: now(),
          role: 'assistant',
          kind: 'text',
          content: 'Here is code:\n```js\nconst a = 1;\n```\n',
        },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Copy code block')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Copy code block'));
    expect(mockClipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('const a = 1;'));
  });

  it('opens images fullscreen from thumbnails', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          id: 'i1',
          sessionId: 's1',
          timestamp: now(),
          role: 'assistant',
          kind: 'text',
          content: 'Look:\n\n![alt text](https://example.com/pic.png)\n',
        },
      ],
    });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Open image fullscreen')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Open image fullscreen'));
    await waitFor(() => expect(screen.getByLabelText('Close image viewer')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Close image viewer'));
    await waitFor(() => expect(screen.queryByLabelText('Close image viewer')).toBeNull());
  });

  it('shows a compact token-usage line and refreshes on new messages', async () => {
    mockFetchTokenUsage.mockResolvedValue({ used: 12345, total: 200000 });
    await render(<ChatScreen route={routeWithObjects} navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Token usage')).toBeTruthy());
    expect(screen.getByText('12.3K / 200K tokens')).toBeTruthy();

    await emit({
      sessionId: 's1',
      id: 'live-1',
      timestamp: now(),
      role: 'assistant',
      kind: 'text',
      content: 'another turn',
    });
    await waitFor(() => expect(mockFetchTokenUsage).toHaveBeenCalledTimes(2));
  });

  it('hides the usage line when the provider does not support it', async () => {
    mockFetchTokenUsage.mockResolvedValue({ unsupported: true });
    await renderChat();
    await waitFor(() => expect(mockFetchTokenUsage).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByLabelText('Token usage')).toBeNull();
  });

  it('collapses settled empty text messages instead of blank bubbles', async () => {
    mockFetchMessages.mockResolvedValueOnce({
      messages: [
        { id: 'empty-1', sessionId: 's1', timestamp: now(), role: 'assistant', kind: 'text', content: '', provider: 'claude' },
        { id: 'm2', sessionId: 's1', timestamp: now(), role: 'assistant', kind: 'text', content: 'real answer' },
      ],
    });
    await renderChat();
    await waitFor(() => expect(screen.getByText('real answer')).toBeTruthy());
    // The empty row renders nothing — not even its provider label.
    expect(screen.queryByText('Claude')).toBeNull();
  });
});
