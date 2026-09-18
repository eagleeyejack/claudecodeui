/** Archived sessions grouped by project, with restore + delete-forever per row. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { deleteSession, fetchArchivedSessions, restoreSession } from '@/lib/api';
import type { ArchivedSession } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { ProviderLogo } from '@/ui/ProviderLogo';
import type { RootStackParamList } from '@/lib/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Archive'>;

type Section = { title: string; data: ArchivedSession[] };

const SKELETON_ROWS = [0, 1, 2, 3];

export function ArchiveScreen(_props: Props) {
  const [sessions, setSessions] = useState<ArchivedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const refresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const result = await fetchArchivedSessions();
      setSessions(result.sessions ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load archived sessions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sections: Section[] = useMemo(() => {
    const groups = new Map<string, ArchivedSession[]>();
    for (const session of sessions) {
      const key = session.projectId ?? session.projectDisplayName ?? 'Archived';
      const list = groups.get(key) ?? [];
      list.push(session);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([key, data]) => {
      const title =
        data[0]?.projectDisplayName ?? (key === 'Archived' ? 'Archived' : key);
      return { title, data };
    });
  }, [sessions]);

  const restore = useCallback(
    async (sessionId: string) => {
      try {
        await restoreSession(sessionId);
        await refresh();
      } catch (cause) {
        Alert.alert('Failed to restore', cause instanceof Error ? cause.message : 'Try again');
      }
    },
    [refresh],
  );

  const destroy = useCallback(
    (sessionId: string, title: string) => {
      Alert.alert(
        'Delete forever?',
        `"${title}" will be permanently deleted.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  await deleteSession(sessionId, { force: true });
                  await refresh();
                } catch (cause) {
                  Alert.alert('Failed to delete', cause instanceof Error ? cause.message : 'Try again');
                }
              })();
            },
          },
        ],
      );
    },
    [refresh],
  );

  if (loading) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}
        accessibilityLabel="Loading archived sessions"
      >
        {SKELETON_ROWS.map((key) => (
          <View
            key={key}
            accessibilityLabel="Loading archived row"
            style={[styles.skeleton, { backgroundColor: colors.surfaceAlt }]}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.sessionId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textMuted}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={[styles.empty, { color: colors.textMuted }]}>
              {error ?? 'No archived sessions'}
            </Text>
            {error ? (
              <Pressable
                style={[styles.retry, { backgroundColor: colors.primary }]}
                onPress={refresh}
                accessibilityRole="button"
                accessibilityLabel="Retry loading archived sessions"
              >
                <Text style={[styles.retryText, { color: colors.primaryText }]}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const title = item.sessionTitle ?? item.sessionId;
          return (
            <View style={[styles.row, { borderBottomColor: colors.border }]}>
              <ProviderLogo provider={item.provider} size={24} />
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                style={[styles.miniButton, { backgroundColor: colors.surfaceAlt }]}
                onPress={() => void restore(item.sessionId)}
                accessibilityRole="button"
                accessibilityLabel={`Restore ${title}`}
              >
                <Text style={[styles.miniText, { color: colors.text }]}>Restore</Text>
              </Pressable>
              <Pressable
                style={[styles.miniButton, { backgroundColor: colors.surfaceAlt }]}
                onPress={() => destroy(item.sessionId, title)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${title} forever`}
              >
                <Text style={[styles.miniText, { color: colors.danger }]}>Delete</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  skeleton: { height: 56, borderRadius: 8, marginBottom: 8, marginTop: 8, opacity: 0.6 },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 15 },
  miniButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  miniText: { fontSize: 13, fontWeight: '600' },
  emptyWrap: { alignItems: 'center', marginTop: 32, gap: 12 },
  empty: { textAlign: 'center' },
  retry: { borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { fontSize: 14, fontWeight: '600' },
});
