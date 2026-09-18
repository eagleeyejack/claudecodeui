/** Projects with their sessions; tapping a session opens the chat. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  deleteSession,
  fetchProjects,
  fetchRunningSessions,
  projectIdOf,
  projectNameOf,
  renameSession,
  sessionIdOf,
  toggleStar,
} from '@/lib/api';
import type { ProjectSummary, SessionSummary } from '@/lib/api';
import type { LLMProvider } from '@/lib/api';
import { createSessionViewModel } from '@/lib/sessionView';
import { providerLabel } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { ProviderLogo } from '@/ui/ProviderLogo';
import type { RootStackParamList } from '@/lib/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Projects'>;

type Row = { project: ProjectSummary; session: SessionSummary };

type Chip = { value: string; label: string; accessibilityLabel: string };

const SKELETON_ROWS = [0, 1, 2, 3];

export function ProjectsScreen({ navigation }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // New sessions start from the header so the list body stays scannable.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('NewSession')}
          accessibilityRole="button"
          accessibilityLabel="New session"
          hitSlop={8}
          style={{
            marginRight: 4,
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={24} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, colors.text]);

  const refresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [nextProjects, running] = await Promise.all([fetchProjects(), fetchRunningSessions()]);
      setProjects(nextProjects);
      setRunningIds((running.sessions ?? []).map((s) => s.sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load projects');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runningSet = useMemo(() => new Set(runningIds), [runningIds]);

  const providersPresent = useMemo(() => {
    const seen = new Set<string>();
    for (const project of projects) {
      for (const session of project.sessions ?? []) {
        if (session.provider) seen.add(session.provider);
      }
    }
    return [...seen].sort();
  }, [projects]);

  // Status and provider are separate axes — grouped, not mixed in one row.
  const statusChips: Chip[] = useMemo(
    () => [
      { value: 'all', label: 'All', accessibilityLabel: 'Filter all' },
      { value: 'starred', label: 'Starred', accessibilityLabel: 'Filter starred' },
      { value: 'running', label: 'Running', accessibilityLabel: 'Filter running' },
    ],
    [],
  );

  const providerChips: Chip[] = useMemo(
    () =>
      providersPresent.map((provider) => ({
        value: provider,
        label: providerLabel(provider as LLMProvider),
        accessibilityLabel: `Filter provider ${provider}`,
      })),
    [providersPresent],
  );

  const activeLabel = [...statusChips, ...providerChips].find((chip) => chip.value === filter)?.label;

  const renderChip = (chip: Chip) => {
    const selected = filter === chip.value;
    return (
      <Pressable
        key={chip.value}
        style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surfaceAlt }]}
        onPress={() => setFilter(chip.value)}
        accessibilityRole="button"
        accessibilityLabel={chip.accessibilityLabel}
        accessibilityState={{ selected }}
      >
        <Text style={[styles.chipText, { color: selected ? colors.primaryText : colors.text }]}>
          {chip.label}
        </Text>
      </Pressable>
    );
  };

  const rows: Row[] = useMemo(() => {
    const all = projects.flatMap((project) =>
      (project.sessions ?? []).map((session) => ({ project, session })),
    );
    const needle = query.trim().toLowerCase();
    const searched = needle
      ? all.filter((row) =>
          `${row.session.title ?? ''} ${row.session.summary ?? ''}`.toLowerCase().includes(needle),
        )
      : all;
    const filtered =
      filter === 'all'
        ? searched
        : filter === 'starred'
          ? searched.filter((row) => row.project.isStarred)
          : filter === 'running'
            ? searched.filter((row) => runningSet.has(sessionIdOf(row.session)))
            : searched.filter((row) => row.session.provider === filter);
    return [...filtered].sort(
      (a, b) =>
        new Date(b.session.lastActivity || 0).getTime() -
        new Date(a.session.lastActivity || 0).getTime(),
    );
  }, [projects, query, filter, runningSet]);

  const removeSessionLocally = useCallback((sessionId: string) => {
    setProjects((current) =>
      current.map((project) => ({
        ...project,
        sessions: (project.sessions ?? []).filter((s) => sessionIdOf(s) !== sessionId),
      })),
    );
  }, []);

  const openContextMenu = useCallback(
    (row: Row) => {
      const sessionId = sessionIdOf(row.session);
      const projectId = projectIdOf(row.project);
      if (runningSet.has(sessionId)) {
        Alert.alert(
          'Session is running',
          'Wait until the run finishes before managing this session.',
          [{ text: 'OK', style: 'cancel' }],
        );
        return;
      }
      const view = createSessionViewModel(row.session, projectId);
      const starred = !!row.project.isStarred;
      Alert.alert(view.name, undefined, [
        {
          text: 'Rename',
          onPress: () => {
            setEditingId(sessionId);
            setEditTitle(view.name === 'New session' ? '' : view.name);
          },
        },
        {
          text: starred ? 'Unstar' : 'Star',
          onPress: () => {
            void (async () => {
              try {
                const result = await toggleStar(projectId);
                setProjects((current) =>
                  current.map((p) =>
                    projectIdOf(p) === projectId ? { ...p, isStarred: result.isStarred } : p,
                  ),
                );
              } catch (cause) {
                Alert.alert('Failed to update star', cause instanceof Error ? cause.message : 'Try again');
              }
            })();
          },
        },
        {
          text: 'Archive',
          onPress: () => {
            void (async () => {
              try {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                await deleteSession(sessionId);
                removeSessionLocally(sessionId);
              } catch (cause) {
                Alert.alert('Failed to archive', cause instanceof Error ? cause.message : 'Try again');
              }
            })();
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete session?',
              'This permanently deletes the session.',
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
                        removeSessionLocally(sessionId);
                      } catch (cause) {
                        Alert.alert(
                          'Failed to delete',
                          cause instanceof Error ? cause.message : 'Try again',
                        );
                      }
                    })();
                  },
                },
              ],
            );
          },
        },
        {
          text: 'Copy session ID',
          onPress: () => {
            void Clipboard.setStringAsync(sessionId);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [removeSessionLocally, runningSet],
  );

  const saveRename = useCallback(
    async (sessionId: string) => {
      if (runningSet.has(sessionId)) {
        Alert.alert(
          'Session is running',
          'Wait until the run finishes before managing this session.',
          [{ text: 'OK', style: 'cancel' }],
        );
        return;
      }
      const trimmed = editTitle.trim();
      if (!trimmed) return;
      try {
        await renameSession(sessionId, trimmed.slice(0, 500));
        setEditingId(null);
        await refresh();
      } catch (cause) {
        Alert.alert('Failed to rename', cause instanceof Error ? cause.message : 'Try again');
      }
    },
    [editTitle, refresh, runningSet],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      <TextInput
        style={[styles.search, { backgroundColor: colors.inputBackground, color: colors.text }]}
        placeholder="Search sessions"
        placeholderTextColor={colors.placeholder}
        accessibilityLabel="Search projects and sessions"
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />
      <View style={styles.filterBar}>
        <Pressable
          style={[styles.filterToggle, { backgroundColor: colors.inputBackground }]}
          onPress={() => setFiltersOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={filtersOpen ? 'Hide filters' : 'Show filters'}
          accessibilityState={{ expanded: filtersOpen }}
        >
          <Ionicons name="options-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.filterToggleText, { color: colors.text }]}>
            {filter === 'all' ? 'Filters' : `Filters · ${activeLabel}`}
          </Text>
          <Ionicons
            name={filtersOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </Pressable>
        {filter !== 'all' ? (
          <Pressable
            onPress={() => setFilter('all')}
            accessibilityRole="button"
            accessibilityLabel="Clear filters"
            hitSlop={8}
            style={styles.clearButton}
          >
            <Text style={[styles.clearText, { color: colors.textMuted }]}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {filtersOpen ? (
        <View
          style={[
            styles.filterPanel,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          accessibilityLabel="Session filters"
        >
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Status</Text>
          <View style={styles.chipsRow}>{statusChips.map(renderChip)}</View>
          {providerChips.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Provider</Text>
              <View style={styles.chipsRow}>{providerChips.map(renderChip)}</View>
            </>
          ) : null}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Pressable
            style={styles.archiveRow}
            onPress={() => navigation.navigate('Archive')}
            accessibilityRole="button"
            accessibilityLabel="Open archive"
          >
            <Ionicons name="archive-outline" size={20} color={colors.textMuted} />
            <Text style={[styles.archiveText, { color: colors.text }]}>Archive</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      {loading ? (
        <View accessibilityLabel="Loading projects">
          {SKELETON_ROWS.map((key) => (
            <View
              key={key}
              accessibilityLabel="Loading session row"
              style={[styles.skeleton, { backgroundColor: colors.surfaceAlt }]}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => `${projectIdOf(row.project)}:${sessionIdOf(row.session)}`}
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
                {error ?? 'No sessions yet'}
              </Text>
              {error ? (
                <Pressable
                  style={[styles.retry, { backgroundColor: colors.primary }]}
                  onPress={refresh}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading projects"
                >
                  <Text style={[styles.retryText, { color: colors.primaryText }]}>Retry</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const view = createSessionViewModel(item.session, projectIdOf(item.project));
            const sessionId = sessionIdOf(item.session);
            const isRunning = runningSet.has(sessionId);
            const editing = editingId === sessionId;
            return (
              <Pressable
                style={[styles.row, { borderBottomColor: colors.border }]}
                onPress={() =>
                  navigation.navigate('Chat', { project: item.project, session: item.session })
                }
                onLongPress={() => openContextMenu(item)}
                accessibilityRole="button"
                accessibilityLabel={`${projectNameOf(item.project)}: ${view.name}, ${view.age || 'unknown age'}${isRunning ? ', running' : ''}${item.project.isStarred ? ', starred' : ''}`}
              >
                <ProviderLogo provider={view.provider} size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.projectName, { color: colors.textMuted }]} numberOfLines={1}>
                    {item.project.isStarred ? '★ ' : ''}
                    {projectNameOf(item.project)}
                    {isRunning ? ' · running' : ''}
                  </Text>
                  {editing ? (
                    <View style={styles.editWrap}>
                      <TextInput
                        style={[
                          styles.editInput,
                          { backgroundColor: colors.inputBackground, color: colors.text },
                        ]}
                        value={editTitle}
                        onChangeText={setEditTitle}
                        placeholder="Session name"
                        placeholderTextColor={colors.placeholder}
                        accessibilityLabel="Rename session"
                        autoFocus
                        maxLength={500}
                        onSubmitEditing={() => void saveRename(sessionId)}
                      />
                      <Pressable
                        style={[styles.miniButton, { backgroundColor: colors.primary }]}
                        onPress={() => void saveRename(sessionId)}
                        accessibilityRole="button"
                        accessibilityLabel="Save rename"
                      >
                        <Text style={[styles.miniText, { color: colors.primaryText }]}>Save</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.miniButton, { backgroundColor: colors.surfaceAlt }]}
                        onPress={() => setEditingId(null)}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel rename"
                      >
                        <Text style={[styles.miniText, { color: colors.text }]}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={[styles.sessionTitle, { color: colors.text }]} numberOfLines={1}>
                      {view.name}
                    </Text>
                  )}
                </View>
                {view.isActive ? (
                  <View
                    accessibilityRole="text"
                    accessibilityLabel="Active now"
                    style={[styles.activeDot, { backgroundColor: colors.success }]}
                  />
                ) : null}
                <Text style={[styles.provider, { color: colors.textMuted }]}>{view.age}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  search: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginTop: 8 },
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  filterToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  filterToggleText: { flex: 1, fontSize: 14, fontWeight: '600' },
  clearButton: { paddingHorizontal: 4, paddingVertical: 8 },
  clearText: { fontSize: 13, fontWeight: '600' },
  filterPanel: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  sectionLabel: { fontSize: 12, fontWeight: '600' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  archiveText: { flex: 1, fontSize: 15, fontWeight: '600' },
  skeleton: { height: 56, borderRadius: 8, marginBottom: 8, opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  projectName: { fontSize: 12 },
  sessionTitle: { fontSize: 15, marginTop: 2 },
  provider: { fontSize: 12 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  emptyWrap: { alignItems: 'center', marginTop: 32, gap: 12 },
  empty: { textAlign: 'center' },
  retry: { borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { fontSize: 14, fontWeight: '600' },
  editWrap: { gap: 8, marginTop: 4 },
  editInput: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  miniButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  miniText: { fontSize: 13, fontWeight: '600' },
});
