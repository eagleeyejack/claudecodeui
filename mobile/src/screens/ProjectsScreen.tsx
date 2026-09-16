/** Projects with their sessions; tapping a session opens the chat. */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { fetchProjects } from '@/lib/api';
import type { ProjectSummary, SessionSummary } from '@/lib/api';
import { providerLabel } from '@/lib/store';

export function ProjectsScreen({
  onOpenSession,
}: {
  onOpenSession: (project: ProjectSummary, session: SessionSummary) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setProjects(await fetchProjects());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = projects.flatMap((project) =>
    (project.sessions ?? []).slice(0, 6).map((session) => ({ project, session })),
  );

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Projects</Text>
      {loading ? (
        <ActivityIndicator color="#2563eb" style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.session.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor="#8b93a7" />}
          ListEmptyComponent={<Text style={styles.empty}>{error ?? 'No sessions yet'}</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => onOpenSession(item.project, item.session)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.projectName} numberOfLines={1}>{item.project.name}</Text>
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {item.session.title || item.session.summary || item.session.id}
                </Text>
              </View>
              <Text style={styles.provider}>{providerLabel((item.session as { provider?: never }).provider)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e14', paddingTop: 60, paddingHorizontal: 16 },
  heading: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1f2532' },
  projectName: { color: '#8b93a7', fontSize: 12 },
  sessionTitle: { color: '#fff', fontSize: 15, marginTop: 2 },
  provider: { color: '#8b93a7', fontSize: 12 },
  empty: { color: '#8b93a7', textAlign: 'center', marginTop: 32 },
});
