/** One transcript row: thinking rows, tool rows, markdown bubbles, streaming + error states. */
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { ChatMessage } from '@/lib/api';
import { providerLabel } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { ProviderLogo } from '@/ui/ProviderLogo';
import { MarkdownBody } from '@/screens/chat/MarkdownBody';
import { ThinkingRow } from '@/screens/chat/ThinkingRow';
import { formatTimestamp, isThinkingMessage } from '@/screens/chat/messageUtils';

type MessageBubbleProps = { message: ChatMessage; onRetry: () => void };

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const { colors } = useTheme();
  const [toolExpanded, setToolExpanded] = useState(false);

  if (isThinkingMessage(message)) {
    return (
      <ThinkingRow content={message.content} isStreaming={message.isStreaming} timestamp={message.timestamp} />
    );
  }

  const isUser = message.role === 'user';
  const bubbleTextColor = isUser ? colors.primaryText : colors.text;
  const metaColor = isUser ? colors.primaryText : colors.textMuted;
  const renderedTime = message.timestamp ? formatTimestamp(message.timestamp) : '';

  // Empty text rows (settled, no error) are protocol noise — render nothing
  // instead of a blank bubble. Thinking/tool/streaming rows still render.
  if (!message.content && !message.isStreaming && !message.error && message.kind !== 'tool') {
    return null;
  }

  const copyMessage = (): void => {
    if (!message.content) return;
    void Clipboard.setStringAsync(message.content);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy message"
      onLongPress={copyMessage}
      style={[
        styles.bubble,
        isUser
          ? [styles.user, { backgroundColor: colors.userBubble }]
          : [styles.assistant, { backgroundColor: colors.assistantBubble }],
      ]}
    >
      <View style={styles.bubbleHeader}>
        {isUser ? null : <ProviderLogo provider={message.provider} size={12} />}
        <Text style={[styles.bubbleLabel, { color: metaColor }]}>
          {isUser ? 'You' : providerLabel(message.provider)}
        </Text>
      </View>
      {message.kind === 'tool' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toolExpanded ? 'Collapse tool output' : 'Expand tool output'}
          accessibilityState={{ expanded: toolExpanded }}
          onPress={() => setToolExpanded((value) => !value)}
        >
          <Text
            selectable
            style={[styles.tool, { color: colors.textMuted }]}
            numberOfLines={toolExpanded ? undefined : 3}
          >
            ⚙︎ {message.content || 'tool call'}
          </Text>
        </Pressable>
      ) : (
        <MarkdownBody content={message.content ?? ''} textColor={bubbleTextColor} />
      )}
      {message.attachments && message.attachments.length > 0 ? (
        <View style={styles.attachRow}>
          <Ionicons name="attach" size={12} color={metaColor} />
          <Text style={[styles.meta, { color: metaColor }]}>
            {message.attachments.length} attached
          </Text>
        </View>
      ) : null}
      {message.delivery === 'waiting' ? (
        <Text style={[styles.meta, { color: metaColor }]}>Waiting to send…</Text>
      ) : null}
      {message.isStreaming ? (
        <View style={styles.streamingRow} accessibilityLabel="Streaming response">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.streamingText, { color: colors.textMuted }]}>Streaming…</Text>
        </View>
      ) : null}
      {message.error ? (
        <View style={styles.errorRow}>
          <Text selectable style={[styles.errorText, { color: colors.danger }]}>
            {message.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry failed message"
            onPress={onRetry}
            style={[styles.inlineRetry, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.inlineRetryText, { color: colors.primaryText }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {renderedTime ? (
        <Text style={[styles.timestamp, { color: colors.textMuted }]}>{renderedTime}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: { borderRadius: 12, padding: 10, maxWidth: '88%', alignSelf: 'flex-start' },
  user: { alignSelf: 'flex-end' },
  assistant: {},
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  bubbleLabel: { fontSize: 10 },
  tool: { fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  meta: { fontSize: 11, marginTop: 4 },
  streamingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  streamingText: { fontSize: 12, fontStyle: 'italic' },
  errorRow: { marginTop: 6, gap: 6 },
  errorText: { fontSize: 13 },
  inlineRetry: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 },
  inlineRetryText: { fontSize: 12, fontWeight: '600' },
  timestamp: { fontSize: 10, marginTop: 6 },
});
