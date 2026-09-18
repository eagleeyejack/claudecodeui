/**
 * Thinking indicator: a brain-icon trigger row with the reasoning expanding
 * underneath (mirroring web `Reasoning`). Open while streaming, auto-collapses
 * ~1s after the stream finishes. Never renders as a plain bubble.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { formatTimestamp } from '@/screens/chat/messageUtils';

const AUTO_COLLAPSE_DELAY_MS = 1000;

type ThinkingRowProps = { content?: string; isStreaming?: boolean; timestamp?: string };

export function ThinkingRow({ content, isStreaming = false, timestamp }: ThinkingRowProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setOpen(true);
      return;
    }
    const timer = setTimeout(() => setOpen(false), AUTO_COLLAPSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isStreaming]);

  const renderedTime = timestamp ? formatTimestamp(timestamp) : '';

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle thinking details"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.trigger}
        hitSlop={8}
      >
        <MaterialCommunityIcons
          name="brain"
          size={18}
          color={isStreaming ? colors.primary : colors.textMuted}
        />
        <Text style={[styles.triggerText, { color: colors.textMuted }]}>
          {isStreaming ? 'Thinking…' : 'Thought'}
        </Text>
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color={colors.textMuted}
        />
        {renderedTime && !open ? (
          <Text style={[styles.time, { color: colors.textMuted }]}>{renderedTime}</Text>
        ) : null}
      </Pressable>
      {open && content ? (
        <View style={[styles.details, { backgroundColor: colors.surface }]}>
          <Text selectable style={[styles.content, { color: colors.textMuted }]}>
            {content}
          </Text>
          {renderedTime ? (
            <Text style={[styles.time, { color: colors.textMuted }]}>{renderedTime}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  triggerText: { fontSize: 13, fontStyle: 'italic' },
  details: { borderRadius: 12, padding: 12, marginTop: 4 },
  content: { fontSize: 13 },
  time: { fontSize: 10, marginTop: 6 },
});
