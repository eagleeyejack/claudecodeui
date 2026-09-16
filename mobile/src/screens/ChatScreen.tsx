/** Session transcript + composer: REST history on open, live frames over the shared socket. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { chatSocket } from '@/lib/ws';
import { fetchMessages } from '@/lib/api';
import type { ChatMessage, ProjectSummary, SessionSummary } from '@/lib/api';
import { providerLabel } from '@/lib/store';

export function ChatScreen({
  project,
  session,
  onBack,
}: {
  project: ProjectSummary;
  session: SessionSummary;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const append = useCallback((incoming: ChatMessage) => {
    setMessages((current) => {
      // Streaming frames reuse the server message id: replace in place, else append.
      const index = current.findIndex((message) => message.id === incoming.id);
      if (index === -1) return [...current, incoming];
      const next = [...current];
      next[index] = incoming;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchMessages(session.id)
      .then((history) => {
        if (!cancelled) setMessages(history.messages ?? []);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    chatSocket.subscribe(session.id);
    const offEvent = chatSocket.onEvent((event) => {
      if (event.sessionId !== session.id || event.type === 'chat_subscribed') return;
      if (!event.kind) return;
      append(event as ChatMessage);
    });
    return () => {
      cancelled = true;
      offEvent();
      chatSocket.unsubscribe(session.id);
    };
  }, [session.id, append]);

  const send = () => {
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    chatSocket.sendMessage(session.id, content);
    append({
      id: `local-${Date.now()}`,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      role: 'user',
      kind: 'text',
      content,
    });
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.back}>‹ Back</Text></Pressable>
        <Text style={styles.title} numberOfLines={1}>{session.title || session.summary || session.id}</Text>
        <Pressable onPress={() => chatSocket.abort(session.id)} hitSlop={12}>
          <Text style={styles.abort}>Stop</Text>
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator color="#2563eb" style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(message) => message.id}
          inverted
          onContentSizeChange={() => listRef.current?.scrollToOffset({ offset: 0, animated: false })}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === 'user' ? styles.user : styles.assistant]}>
              <Text style={styles.bubbleLabel}>{item.role === 'user' ? 'You' : providerLabel(item.provider)}</Text>
              {item.kind === 'tool' ? (
                <Text style={styles.tool} numberOfLines={3}>⚙︎ {item.content || 'tool call'}</Text>
              ) : (
                <Text style={styles.content}>{item.content || (item.isThinking ? '…' : '')}</Text>
              )}
            </View>
          )}
        />
      )}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message…"
          placeholderTextColor="#5b6377"
          multiline
          value={draft}
          onChangeText={setDraft}
        />
        <Pressable style={styles.send} onPress={send}>
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e14', paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  back: { color: '#60a5fa', fontSize: 15 },
  title: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  abort: { color: '#f87171', fontSize: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  bubble: { borderRadius: 12, padding: 10, maxWidth: '88%', alignSelf: 'flex-start' },
  user: { backgroundColor: '#1d4ed8', alignSelf: 'flex-end' },
  assistant: { backgroundColor: '#161b26' },
  bubbleLabel: { color: '#8b93a7', fontSize: 10, marginBottom: 2 },
  content: { color: '#e5e9f0', fontSize: 15 },
  tool: { color: '#9ca3af', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1f2532' },
  input: { flex: 1, backgroundColor: '#161b26', color: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15, maxHeight: 120 },
  send: { backgroundColor: '#2563eb', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
