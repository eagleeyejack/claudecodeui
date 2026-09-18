/** Compact token-usage line under the chat title; hides when unsupported. */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fetchTokenUsage } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { formatUsageLine } from '@/screens/chat/messageUtils';

type TokenUsageHeaderProps = { sessionId: string; refreshKey: number };

export function TokenUsageHeader({ sessionId, refreshKey }: TokenUsageHeaderProps) {
  const { colors } = useTheme();
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void fetchTokenUsage(sessionId)
      .then((usage) => {
        if (!cancelled) setLine(formatUsageLine(usage));
      })
      .catch(() => {
        if (!cancelled) setLine(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (!line) return null;
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text accessibilityLabel="Token usage" style={[styles.text, { color: colors.textMuted }]}>
        {line} tokens
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { fontSize: 11, textAlign: 'center' },
});
