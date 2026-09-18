/**
 * Session transcript + composer: REST history on open, live frames over the shared socket.
 *
 * Transcript rows render through `screens/chat` (markdown bubbles, thinking
 * rows, token usage, scroll-to-latest FAB, earlier-messages paging).
 *
 * Phase 3b runtime: session settings drawer (agent/model/effort), image
 * attachments, native permission approvals, queue-while-busy, and an offline
 * outbox hold.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { chatSocket } from '@/lib/ws';
import type { ChatSendOptions, PermissionDecision } from '@/lib/ws';
import {
  fetchActiveModel,
  fetchAgents,
  fetchCapabilities,
  fetchMessages,
  fetchModels,
  fetchSessionDetail,
  sessionIdOf,
  setActiveEffort as setActiveEffortApi,
  setActiveModel as setActiveModelApi,
  uploadImages,
} from '@/lib/api';
import type {
  ChatMessage,
  LLMProvider,
  ModelOption,
  ProjectSummary,
  ProviderAgent,
  ProviderCapability,
  SessionSummary,
  StoredAttachment,
} from '@/lib/api';
import {
  buildClaudeToolPermissionEntry,
  describePermissionRequest,
} from '@/lib/permissions';
import type { PendingPermissionRequest } from '@/lib/permissions';
import { loadFavouriteModels, providerLabel, saveFavouriteModels } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { ProviderLogo } from '@/ui/ProviderLogo';
import { DEFAULT_AGENT_VALUE, DEFAULT_PERMISSION_MODE, SessionSettingsSheet, agentLabel, permissionModeLabel } from '@/ui/SessionSettingsSheet';
import { MessageBubble } from '@/screens/chat/MessageBubble';
import { TokenUsageHeader } from '@/screens/chat/TokenUsageHeader';
import type { RootStackParamList } from '@/lib/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

// Window in which a server-echoed user row replaces the optimistic local echo.
const ECHO_DEDUPE_WINDOW_MS = 30000;

// Offset past which the scroll-to-latest FAB appears on the inverted list.
const FAB_SCROLL_THRESHOLD = 200;

// Server frames that drive run/permission state but never render as bubbles
// (web parity: `useChatRealtimeHandlers` persists everything except these).
const META_KINDS = new Set([
  'chat_subscribed',
  'complete',
  'status',
  'protocol_error',
  'permission_request',
  'permission_resolved',
  'permission_cancelled',
  'history_truncated',
]);

/** One image picked in the composer: local preview + server descriptor once uploaded. */
type PickedAttachment = {
  id: string;
  localUri: string;
  name: string;
  mimeType: string;
  stored?: StoredAttachment;
};

/** Turns held behind a running turn, dispatched FIFO on each `complete`. */
type QueuedDraft = { id: string; content: string; attachments: PickedAttachment[] };

const storedOf = (items: PickedAttachment[]): StoredAttachment[] =>
  items.flatMap((item) => (item.stored ? [item.stored] : []));

export function ChatScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Full objects come from in-app navigation; bare ids come from deep links.
  const [project, setProject] = useState<ProjectSummary | undefined>(route.params.project);
  const [session, setSession] = useState<SessionSummary | undefined>(route.params.session);

  // Session id regardless of which shape the row arrived in.
  const sessionId =
    session ? sessionIdOf(session) : (route.params.sessionId ?? '');
  const provider: LLMProvider = session?.provider ?? 'claude';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showFab, setShowFab] = useState(false);
  const [usageRefresh, setUsageRefresh] = useState(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // ---- Phase 3b runtime state ----
  const [capabilities, setCapabilities] = useState<ProviderCapability[] | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelOption[] | null>(null);
  const [catalogDefault, setCatalogDefault] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState('');
  const [activeEffort, setActiveEffort] = useState('');
  const [activePermissionMode, setActivePermissionMode] = useState(DEFAULT_PERMISSION_MODE);
  const [agents, setAgents] = useState<ProviderAgent[]>([]);
  const [activeAgent, setActiveAgent] = useState(DEFAULT_AGENT_VALUE);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [favouriteModels, setFavouriteModels] = useState<Record<string, string[]>>({});
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [runInProgress, setRunInProgress] = useState(false);
  const [queue, setQueue] = useState<QueuedDraft[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [offline, setOffline] = useState(false);
  // Seed from the socket like LiveDot: it may have opened before this screen mounted.
  const [connected, setConnected] = useState(() => chatSocket.isConnected());

  // Ref mirrors for use inside the socket listener without re-subscribing.
  const activeModelRef = useRef('');
  const activeEffortRef = useRef('');
  const activePermissionModeRef = useRef(DEFAULT_PERMISSION_MODE);
  const activeAgentRef = useRef(DEFAULT_AGENT_VALUE);
  const queueRef = useRef<QueuedDraft[]>([]);
  const pendingRef = useRef<PendingPermissionRequest[]>([]);
  const promptedRef = useRef<Set<string>>(new Set());
  const promptingRef = useRef(false);

  const capability = capabilities?.find((entry) => entry.provider === provider);
  const supportsImages = capability?.supportsImages ?? false;
  const supportsEffort = capability?.supportsEffort ?? false;
  const permissionModes = capability?.permissionModes ?? [];
  const modelLabel =
    modelCatalog?.find((option) => option.value === activeModel)?.label
    || activeModel
    || 'Model';
  const permissionModeSuffix =
    activePermissionMode && activePermissionMode !== DEFAULT_PERMISSION_MODE
      ? ` · ${permissionModeLabel(activePermissionMode)}`
      : '';
  const agentSuffix =
    activeAgent && activeAgent !== DEFAULT_AGENT_VALUE ? ` · ${agentLabel(activeAgent)}` : '';

  // Resolve deep-link ids into display objects once.
  useEffect(() => {
    if (project && session) return;
    const params = route.params;
    const targetSessionId = params.sessionId ?? (params.session ? sessionIdOf(params.session) : '');
    if (!targetSessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await fetchSessionDetail(targetSessionId);
        if (cancelled) return;
        const resolvedSession: SessionSummary = {
          id: detail.sessionId,
          provider: detail.provider,
          summary: detail.summary,
          lastActivity: detail.lastActivity,
        };
        setSession(params.session ?? resolvedSession);
        if (!params.project && detail.project) {
          setProject({
            projectId: detail.project.projectId,
            displayName: detail.project.displayName,
            path: detail.project.path,
          });
        }
        navigation.setOptions({
          title: detail.summary || targetSessionId,
        });
      } catch (cause) {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Failed to load session');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, session, route.params, navigation]);

  useEffect(() => {
    navigation.setOptions({
      title: session?.title || session?.summary || sessionId,
    });
  }, [navigation, session, sessionId]);

  // Favourited model roster, shared across sessions per provider.
  useEffect(() => {
    let cancelled = false;
    void loadFavouriteModels().then((value) => {
      if (!cancelled) setFavouriteModels(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFavouriteModel = useCallback(
    (model: string) => {
      setFavouriteModels((current) => {
        const existing = current[provider] ?? [];
        const next = existing.includes(model)
          ? existing.filter((value) => value !== model)
          : [...existing, model];
        const updated = { ...current, [provider]: next };
        void saveFavouriteModels(updated);
        return updated;
      });
    },
    [provider],
  );

  // Custom agents for the session project (opencode only). Session-local
  // like the permission mode: resets when the session changes.
  useEffect(() => {
    setAgents([]);
    setActiveAgent(DEFAULT_AGENT_VALUE);
    activeAgentRef.current = DEFAULT_AGENT_VALUE;
    if (provider !== 'opencode') return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchAgents(provider, project?.path);
        if (!cancelled) setAgents(result.agents);
      } catch {
        // Gating degrades to hidden; the composer still sends plain text.
        if (!cancelled) setAgents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, sessionId, project?.path]);

  // Capability matrix for composer gating (images, effort).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchCapabilities();
        if (!cancelled) setCapabilities(result.providers);
      } catch {
        // Gating degrades to hidden; the composer still sends plain text.
        if (!cancelled) setCapabilities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadModels = useCallback(async () => {
    if (!sessionId) return;
    setLoadingModels(true);
    setModelsError(null);
    try {
      const [active, catalog] = await Promise.all([
        fetchActiveModel(provider, sessionId).catch(() => null),
        fetchModels(provider).catch(() => null),
      ]);
      if (catalog) {
        setModelCatalog(catalog.options);
        setCatalogDefault(catalog.default);
      }
      const resolvedModel = active?.model || catalog?.default || '';
      if (resolvedModel) {
        setActiveModel(resolvedModel);
        activeModelRef.current = resolvedModel;
      }
      if (active?.effort) {
        setActiveEffort(active.effort);
        activeEffortRef.current = active.effort;
      }
    } catch (cause) {
      setModelsError(cause instanceof Error ? cause.message : 'Failed to load models');
    } finally {
      setLoadingModels(false);
    }
  }, [sessionId, provider]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  // Device connectivity for the offline hold.
  useEffect(() => {
    let cancelled = false;
    void NetInfo.fetch()
      .then((state) => {
        if (!cancelled) setOffline(!(state.isConnected ?? true));
      })
      .catch(() => undefined);
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOffline(!(state.isConnected ?? true));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => chatSocket.onStatus(setConnected), []);

  // On reconnect the socket flushes its outbox; waiting rows become live turns.
  useEffect(() => {
    if (!connected || offline) return;
    setMessages((current) => {
      if (!current.some((message) => message.delivery === 'waiting')) return current;
      return current.map((message) => {
        if (message.delivery !== 'waiting') return message;
        const next = { ...message };
        delete next.delivery;
        return next;
      });
    });
  }, [connected, offline]);

  const append = useCallback((incoming: ChatMessage) => {
    setMessages((current) => {
      // Streaming frames reuse the server message id: replace in place, else append.
      const index = current.findIndex((message) => message.id === incoming.id);
      if (index !== -1) {
        const next = [...current];
        next[index] = incoming;
        return next;
      }
      // The server broadcasts its own user row after our optimistic `local-*`
      // echo (JAA-225): fold the echo into the server row when role + content
      // match within a short window instead of showing both bubbles.
      if (incoming.role === 'user' && typeof incoming.content === 'string') {
        const echoIndex = current.findIndex(
          (message) =>
            message.id.startsWith('local-') &&
            message.role === 'user' &&
            message.content === incoming.content &&
            Math.abs(Date.parse(incoming.timestamp) - Date.parse(message.timestamp)) < ECHO_DEDUPE_WINDOW_MS,
        );
        if (echoIndex !== -1) {
          const next = [...current];
          next[echoIndex] = incoming;
          return next;
        }
      }
      return [...current, incoming];
    });
  }, []);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const history = await fetchMessages(sessionId);
      setMessages(history.messages ?? []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Error-row and paging Retry affordances re-run the full loader until the
  // server adds limit/offset paging.
  const retryHistory = useCallback(() => {
    void loadHistory();
  }, [loadHistory]);

  // ---- Permission approvals (serial native prompts, never silent) ----

  const removePermission = (requestId: string) => {
    promptedRef.current.delete(requestId);
    if (!pendingRef.current.some((request) => request.requestId === requestId)) return;
    pendingRef.current = pendingRef.current.filter((request) => request.requestId !== requestId);
    setPendingPermissions(pendingRef.current);
  };

  const maybePrompt = () => {
    if (promptingRef.current) return;
    const next = pendingRef.current.find((request) => !promptedRef.current.has(request.requestId));
    if (!next) return;
    promptingRef.current = true;
    promptedRef.current.add(next.requestId);
    const entry = buildClaudeToolPermissionEntry(next.toolName, next.input);
    const { title, message } = describePermissionRequest(next);
    const decide = (decision: PermissionDecision) => {
      chatSocket.respondToPermission(next.requestId, decision);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      promptedRef.current.delete(next.requestId);
      pendingRef.current = pendingRef.current.filter((request) => request.requestId !== next.requestId);
      setPendingPermissions(pendingRef.current);
      promptingRef.current = false;
      maybePrompt();
    };
    Alert.alert(
      title,
      message,
      [
        {
          text: 'Deny',
          style: 'destructive',
          onPress: () => decide({ allow: false, message: 'The user denied this tool call.' }),
        },
        ...(entry
          ? [{ text: 'Allow & remember', onPress: () => decide({ allow: true, rememberEntry: entry }) }]
          : []),
        { text: 'Allow once', onPress: () => decide({ allow: true }) },
      ],
      { cancelable: false },
    );
  };

  const addPermissions = (incoming: PendingPermissionRequest[]) => {
    if (incoming.length === 0) return;
    // pendingRef is the source of truth so prompts fire synchronously —
    // setState updaters run later and cannot be read back here.
    const known = new Set(pendingRef.current.map((request) => request.requestId));
    let changed = false;
    const merged = [...pendingRef.current];
    for (const request of incoming) {
      if (request.requestId && !known.has(request.requestId)) {
        known.add(request.requestId);
        merged.push(request);
        changed = true;
      }
    }
    if (!changed) return;
    pendingRef.current = merged;
    setPendingPermissions(merged);
    maybePrompt();
  };

  const clearPermissions = () => {
    promptedRef.current.clear();
    promptingRef.current = false;
    pendingRef.current = [];
    setPendingPermissions([]);
  };

  // ---- Send path: transmit now, queue behind a run, or hold while offline ----

  const transmit = (content: string, stored: StoredAttachment[]) => {
    if (!sessionId) return;
    // Web parity: every turn carries the composer's model/effort/mode so the
    // run resumes with the same settings even before the sheet persisted them.
    const options: ChatSendOptions = {};
    if (activeModelRef.current) options.model = activeModelRef.current;
    if (activeEffortRef.current) options.effort = activeEffortRef.current;
    if (
      activePermissionModeRef.current &&
      activePermissionModeRef.current !== DEFAULT_PERMISSION_MODE
    ) {
      options.permissionMode = activePermissionModeRef.current;
    }
    if (activeAgentRef.current && activeAgentRef.current !== DEFAULT_AGENT_VALUE) {
      options.agent = activeAgentRef.current;
    }
    if (stored.length > 0) {
      options.attachments = stored.map(({ path, name, mimeType, size }) => ({
        path,
        name,
        mimeType,
        size,
      }));
    }
    const result = chatSocket.sendMessage(sessionId, content, options);
    const waiting = result === 'queued';
    append({
      id: `local-${Date.now()}`,
      sessionId,
      timestamp: new Date().toISOString(),
      role: 'user',
      kind: 'text',
      content,
      ...(stored.length > 0 ? { attachments: stored } : {}),
      ...(waiting ? { delivery: 'waiting' as const } : {}),
    });
    if (!waiting) setRunInProgress(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const flushQueue = () => {
    const [head, ...rest] = queueRef.current;
    if (!head) return;
    queueRef.current = rest;
    setQueue(rest);
    transmit(head.content, storedOf(head.attachments));
  };

  // Latest closures for the socket listener without re-subscribing every keystroke.
  const runtimeRef = useRef({ flushQueue, maybePrompt, addPermissions });
  runtimeRef.current = { flushQueue, maybePrompt, addPermissions };

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Drop the previous session's transcript immediately so it never flashes
    // while the new history loads. Session-scoped runtime state resets too.
    setMessages([]);
    setQueue([]);
    queueRef.current = [];
    setRunInProgress(false);
    clearPermissions();
    void loadHistory();
    chatSocket.subscribe(sessionId);
    const offEvent = chatSocket.onEvent((event) => {
      if (cancelled) return;
      if (event.sessionId !== sessionId) return;
      if (event.kind === 'chat_subscribed' || event.type === 'chat_subscribed') {
        // Authoritative run flag after (re)subscribe, plus approvals that
        // arrived while we were away — surface them, never stall silently.
        if (typeof event.isProcessing === 'boolean') setRunInProgress(event.isProcessing);
        if (Array.isArray(event.pendingPermissions)) {
          runtimeRef.current.addPermissions(event.pendingPermissions);
        }
        return;
      }
      if (!event.kind || META_KINDS.has(event.kind)) {
        if (event.kind === 'complete') {
          setRunInProgress(false);
          clearPermissions();
          runtimeRef.current.flushQueue();
        } else if (event.kind === 'protocol_error') {
          // The run never started (or was rejected): no `complete` follows,
          // so held turns must go now or they stall behind nothing.
          setRunInProgress(false);
          runtimeRef.current.flushQueue();
        } else if (event.kind === 'permission_request' && event.requestId) {
          setRunInProgress(true);
          runtimeRef.current.addPermissions([{
            requestId: event.requestId,
            toolName: event.toolName || 'UnknownTool',
            input: event.input,
            context: event.context,
            sessionId,
          }]);
        } else if (
          (event.kind === 'permission_resolved' || event.kind === 'permission_cancelled')
          && event.requestId
        ) {
          removePermission(event.requestId);
        }
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      append(event as ChatMessage);
      setUsageRefresh((count) => count + 1);
    });
    return () => {
      cancelled = true;
      offEvent();
      chatSocket.unsubscribe(sessionId);
    };
  }, [sessionId, append, loadHistory]);

  const send = () => {
    const content = draft.trim();
    const ready = storedOf(attachments);
    const uploading = ready.length !== attachments.length;
    if ((!content && ready.length === 0) || !sessionId || uploading) return;
    // A turn is already in flight: hold this one at the back of the queue
    // with a visible chip instead of racing the server (which would reject
    // with RUN_IN_PROGRESS).
    if (runInProgress && connected && !offline) {
      const entry: QueuedDraft = {
        id: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        content,
        attachments,
      };
      queueRef.current = [...queueRef.current, entry];
      setQueue(queueRef.current);
      setDraft('');
      setAttachments([]);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    setDraft('');
    setAttachments([]);
    transmit(content, ready);
  };

  const cancelQueue = () => {
    const held = queueRef.current;
    queueRef.current = [];
    setQueue([]);
    // Restore the most recent held turn so nothing typed is lost.
    const last = held[held.length - 1];
    if (last) {
      setDraft(last.content);
      setAttachments(last.attachments);
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ---- Model / effort selection ----

  const selectModel = (model: string) => {
    if (!sessionId) return;
    const previous = activeModelRef.current;
    setActiveModel(model);
    activeModelRef.current = model;
    void setActiveModelApi(provider, sessionId, model).catch((cause) => {
      setActiveModel(previous);
      activeModelRef.current = previous;
      Alert.alert('Could not change model', cause instanceof Error ? cause.message : 'Request failed');
    });
  };

  // Agent and permission mode are session-local (no server persistence
  // endpoint): they ride on every send while this screen is mounted and reset
  // on revisit. Plan now rides the agent flag, so picking it clears any
  // approval mode; picking an approval mode while the plan agent is active
  // returns to the build agent instead of stacking conflicting flags.
  const selectAgent = (name: string) => {
    setActiveAgent(name);
    activeAgentRef.current = name;
    if (name === 'plan') {
      setActivePermissionMode(DEFAULT_PERMISSION_MODE);
      activePermissionModeRef.current = DEFAULT_PERMISSION_MODE;
    }
  };

  const selectPermissionMode = (mode: string) => {
    setActivePermissionMode(mode);
    activePermissionModeRef.current = mode;
    if (activeAgentRef.current === 'plan') {
      setActiveAgent(DEFAULT_AGENT_VALUE);
      activeAgentRef.current = DEFAULT_AGENT_VALUE;
    }
  };

  const selectEffort = (effort: string) => {
    if (!sessionId) return;
    const previous = activeEffortRef.current;
    setActiveEffort(effort);
    activeEffortRef.current = effort;
    void setActiveEffortApi(provider, sessionId, effort).catch((cause) => {
      setActiveEffort(previous);
      activeEffortRef.current = previous;
      Alert.alert('Could not change effort', cause instanceof Error ? cause.message : 'Request failed');
    });
  };

  // ---- Image attachments (upload at pick time so queued/offline sends stay durable) ----

  const pickImages = async () => {
    setAttachError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setAttachError('Photo library access is needed to attach images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (result.canceled || result.assets.length === 0) return;
      const remaining = Math.max(0, 5 - attachments.length);
      const chosen = result.assets.slice(0, remaining);
      if (chosen.length === 0) {
        setAttachError('Attach up to 5 images per message.');
        return;
      }
      const items: PickedAttachment[] = chosen.map((asset) => ({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        localUri: asset.uri,
        name: asset.fileName ?? 'image.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
      }));
      setAttachments((previous) => [...previous, ...items]);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const stored = await uploadImages(
          items.map((item) => ({ uri: item.localUri, name: item.name, mimeType: item.mimeType })),
        );
        setAttachments((previous) =>
          previous.map((item) => {
            const index = items.findIndex((candidate) => candidate.id === item.id);
            return index === -1 ? item : { ...item, stored: stored[index] };
          }),
        );
      } catch (cause) {
        const failed = new Set(items.map((item) => item.id));
        setAttachments((previous) => previous.filter((item) => !failed.has(item.id)));
        setAttachError(cause instanceof Error ? cause.message : 'Image upload failed');
      }
    } catch (cause) {
      setAttachError(cause instanceof Error ? cause.message : 'Could not open the photo library');
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((previous) => previous.filter((item) => item.id !== id));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const storedCount = storedOf(attachments).length;
  const uploading = storedCount !== attachments.length;
  const canSend = Boolean(sessionId) && !uploading && (Boolean(draft.trim()) || storedCount > 0);
  const queueHead = queue[0];
  const queuePreview = queueHead
    ? queueHead.content.trim() || `${storedOf(queueHead.attachments).length} image(s)`
    : '';

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <TokenUsageHeader sessionId={sessionId} refreshKey={usageRefresh} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
      ) : loadError && messages.length === 0 ? (
        <View style={styles.centerWrap}>
          <Text style={[styles.centerText, { color: colors.textMuted }]}>{loadError}</Text>
          <Pressable
            style={[styles.retry, { backgroundColor: colors.primary }]}
            onPress={loadHistory}
            accessibilityRole="button"
            accessibilityLabel="Retry loading messages"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            testID="message-list"
            data={[...messages].reverse()}
            keyExtractor={(message) => message.id}
            inverted
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToOffset({ offset: 0, animated: false })}
            onScroll={(event) => {
              const y = event.nativeEvent.contentOffset?.y ?? 0;
              setShowFab(y > FAB_SCROLL_THRESHOLD);
            }}
            scrollEventThrottle={16}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textMuted }]}>
                No messages yet — say hello below.
              </Text>
            }
            ListFooterComponent={
              messages.length === 0 ? null : (
                <Pressable
                  onPress={retryHistory}
                  accessibilityRole="button"
                  accessibilityLabel="Load earlier messages"
                  style={styles.paging}
                >
                  <Text style={[styles.pagingText, { color: colors.textMuted }]}>
                    Load earlier messages
                  </Text>
                </Pressable>
              )
            }
            renderItem={({ item }) => (
              <MessageBubble message={item} onRetry={retryHistory} />
            )}
          />
          {showFab ? (
            <Pressable
              style={[styles.fab, { backgroundColor: colors.primary }]}
              onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
              accessibilityRole="button"
              accessibilityLabel="Scroll to latest messages"
            >
              <Text style={[styles.fabText, { color: colors.primaryText }]}>↓</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      <View style={[styles.composer, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {pendingPermissions.length > 0 ? (
          <View style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.bannerText, { color: colors.text }]}>
              ⚠ {pendingPermissions.length} permission{pendingPermissions.length === 1 ? '' : 's'} need{pendingPermissions.length === 1 ? 's' : ''} approval
            </Text>
            <Pressable
              onPress={() => runtimeRef.current.maybePrompt()}
              accessibilityRole="button"
              accessibilityLabel="Review pending permission"
              hitSlop={8}
            >
              <Text style={[styles.bannerAction, { color: colors.primary }]}>Review</Text>
            </Pressable>
          </View>
        ) : null}
        {queue.length > 0 ? (
          <Pressable
            style={[styles.queued, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            onPress={cancelQueue}
            accessibilityRole="button"
            accessibilityLabel="Cancel queued message"
          >
            <Text style={[styles.queuedText, { color: colors.text }]} numberOfLines={1}>
              ⏳ {queue.length > 1 ? `${queue.length} queued` : 'Queued'}
              {queuePreview ? `: ${queuePreview}` : ''} — tap to cancel
            </Text>
          </Pressable>
        ) : null}
        {attachments.length > 0 ? (
          <ScrollView horizontal style={styles.strip} keyboardShouldPersistTaps="handled">
            {attachments.map((item, index) => (
              <View key={item.id} style={styles.thumbWrap}>
                <Image
                  source={{ uri: item.localUri }}
                  style={[styles.thumb, { borderColor: colors.border }]}
                  accessibilityLabel={`Attachment ${index + 1}`}
                />
                {!item.stored ? (
                  <ActivityIndicator
                    color={colors.primary}
                    size="small"
                    style={styles.thumbSpinner}
                  />
                ) : null}
                <Pressable
                  style={[styles.thumbRemove, { backgroundColor: colors.surface }]}
                  onPress={() => removeAttachment(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove attachment ${index + 1}`}
                  hitSlop={8}
                >
                  <Text style={[styles.thumbRemoveText, { color: colors.text }]}>✕</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
        {attachError ? (
          <Text style={[styles.inlineError, { color: colors.danger }]}>{attachError}</Text>
        ) : null}
        <View style={styles.badgeRow}>
          <Pressable
            style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {
              setPickerVisible(true);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Session settings, current ${modelLabel}${agentSuffix}${permissionModeSuffix}`}
            hitSlop={4}
          >
            <ProviderLogo provider={provider} size={16} />
            <Text style={[styles.badgeText, { color: colors.text }]} numberOfLines={1}>
              {providerLabel(provider)} · {modelLabel}
              {agentSuffix}
              {permissionModeSuffix}
            </Text>
            <Ionicons name="chevron-up" size={18} color={colors.textMuted} />
          </Pressable>
          {offline || !connected ? (
            <Text style={[styles.netHint, { color: colors.textMuted }]}>
              Offline — sends when reconnected
            </Text>
          ) : null}
        </View>
        <View style={styles.inputRow}>
          {supportsImages ? (
            <Pressable
              style={[styles.iconButton, { backgroundColor: colors.surfaceAlt }]}
              onPress={pickImages}
              accessibilityRole="button"
              accessibilityLabel="Attach image"
            >
              <Ionicons name="image-outline" size={20} color={colors.text} />
            </Pressable>
          ) : null}
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]}
            placeholder="Message…"
            placeholderTextColor={colors.placeholder}
            multiline
            editable={!!sessionId}
            accessibilityLabel="Message input"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
          />
          <Pressable
            style={[styles.send, { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.5 }]}
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>
      <SessionSettingsSheet
        visible={pickerVisible}
        provider={provider}
        permissionModes={permissionModes}
        activePermissionMode={activePermissionMode}
        onSelectPermissionMode={selectPermissionMode}
        agents={agents}
        activeAgent={activeAgent}
        onSelectAgent={selectAgent}
        activeModel={activeModel}
        activeEffort={activeEffort}
        supportsEffort={supportsEffort}
        models={modelCatalog}
        modelsDefault={catalogDefault}
        loadingModels={loadingModels}
        modelsError={modelsError}
        onRetryModels={() => void loadModels()}
        onSelectModel={selectModel}
        onSelectEffort={selectEffort}
        favouriteModels={favouriteModels[provider] ?? []}
        onToggleFavourite={toggleFavouriteModel}
        onClose={() => setPickerVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centerText: { textAlign: 'center', paddingHorizontal: 32 },
  retry: { borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 32 },
  listWrap: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  paging: { alignItems: 'center', paddingVertical: 8 },
  pagingText: { fontSize: 13, fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { fontSize: 20, fontWeight: '700' },
  composer: { gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerText: { fontSize: 13, fontWeight: '600', flex: 1 },
  bannerAction: { fontSize: 13, fontWeight: '700' },
  queued: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  queuedText: { fontSize: 13 },
  strip: { flexGrow: 0 },
  thumbWrap: { width: 60, height: 60, marginRight: 8 },
  thumb: { width: 60, height: 60, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  thumbSpinner: { position: 'absolute', left: 18, top: 18 },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { fontSize: 12, fontWeight: '700' },
  inlineError: { fontSize: 12 },
  badgeRow: { alignItems: 'stretch', gap: 6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  badgeText: { flex: 1, fontSize: 13, fontWeight: '600' },
  netHint: { fontSize: 11 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15, maxHeight: 120 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
