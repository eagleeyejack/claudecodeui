/** Start a session: pick project, capabilities-gated provider, model, optional first message. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  createSession,
  fetchCapabilities,
  fetchModels,
  fetchProjects,
  projectIdOf,
  projectNameOf,
} from '@/lib/api';
import type { LLMProvider, ModelOption, ProjectSummary, ProviderCapability } from '@/lib/api';
import { providerLabel } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { ProviderLogo } from '@/ui/ProviderLogo';
import type { RootStackParamList } from '@/lib/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSession'>;

export function NewSessionScreen({ navigation }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [step, setStep] = useState<'project' | 'setup'>('project');
  const [firstMessage, setFirstMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextProjects, caps] = await Promise.all([fetchProjects(), fetchCapabilities()]);
        if (cancelled) return;
        setProjects(nextProjects);
        setCapabilities(caps.providers ?? []);
        if (nextProjects.length > 0) {
          setSelectedProjectId((current) => current ?? projectIdOf(nextProjects[0]));
        }
        const firstProvider = (caps.providers ?? [])[0]?.provider ?? null;
        if (firstProvider) setSelectedProvider((current) => current ?? firstProvider);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load options');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedProvider) return;
    let cancelled = false;
    setModelsLoading(true);
    void (async () => {
      try {
        const result = await fetchModels(selectedProvider);
        if (cancelled) return;
        setModels(result.options ?? []);
        setSelectedModel(result.default ?? null);
      } catch {
        if (!cancelled) {
          setModels([]);
          setSelectedModel(null);
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProvider]);

  const selectedProject = useMemo(
    () => projects.find((p) => projectIdOf(p) === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ title: step === 'project' ? 'New session' : 'Setup session' });
  }, [navigation, step]);

  const goToChat = useCallback(
    (
      project: ProjectSummary,
      result: { sessionId: string; provider?: LLMProvider; sessionName?: string },
      provider: LLMProvider,
      summary: string,
    ) => {
      navigation.navigate('Chat', {
        project,
        session: {
          id: result.sessionId,
          provider: result.provider ?? provider,
          summary: result.sessionName ?? summary,
        },
        sessionId: result.sessionId,
      });
    },
    [navigation],
  );

  const create = async () => {
    if (!selectedProject || !selectedProvider || creating) return;
    setCreating(true);
    setError(null);
    try {
      const trimmed = firstMessage.trim();
      const result = await createSession(
        selectedProvider,
        selectedProject.path,
        trimmed ? trimmed : undefined,
      );
      goToChat(selectedProject, result, selectedProvider, trimmed ? trimmed : 'New session');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        accessibilityLabel="Loading new session options"
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      {step === 'project' ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
            Project
          </Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Tap a project to continue
          </Text>
          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
          {projects.map((project) => {
            const id = projectIdOf(project);
            const selected = id === selectedProjectId;
            return (
              <Pressable
                key={id}
                style={[
                  styles.option,
                  styles.projectRow,
                  { backgroundColor: selected ? colors.primary : colors.surfaceAlt },
                ]}
                onPress={() => {
                  setSelectedProjectId(id);
                  setStep('setup');
                }}
                accessibilityRole="button"
                accessibilityLabel={`Continue with ${projectNameOf(project)}`}
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.optionText,
                    styles.projectText,
                    { color: selected ? colors.primaryText : colors.text },
                  ]}
                >
                  {projectNameOf(project)}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={selected ? colors.primaryText : colors.textMuted}
                />
              </Pressable>
            );
          })}
        </>
      ) : (
        <>
          <Pressable
            style={[styles.recap, { backgroundColor: colors.surfaceAlt }]}
            onPress={() => setStep('project')}
            accessibilityRole="button"
            accessibilityLabel="Change project"
          >
            <Text style={[styles.recapText, { color: colors.text }]} numberOfLines={1}>
              {selectedProject ? projectNameOf(selectedProject) : 'Project'}
            </Text>
            <Text style={[styles.recapChange, { color: colors.primary }]}>Change</Text>
          </Pressable>

          <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
            Provider
          </Text>
      {capabilities.map((cap) => {
        const selected = cap.provider === selectedProvider;
        return (
          <Pressable
            key={cap.provider}
            style={[
              styles.providerRow,
              { backgroundColor: selected ? colors.primary : colors.surfaceAlt },
            ]}
            onPress={() => setSelectedProvider(cap.provider)}
            accessibilityRole="button"
            accessibilityLabel={`Select provider ${cap.provider}`}
            accessibilityState={{ selected }}
          >
            <ProviderLogo provider={cap.provider} size={24} />
            <Text
              style={[styles.optionText, { color: selected ? colors.primaryText : colors.text }]}
            >
              {providerLabel(cap.provider)}
            </Text>
          </Pressable>
        );
      })}

      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        Model
      </Text>
      {modelsLoading ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading models" />
      ) : models.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>No models available</Text>
      ) : (
        models.map((model) => {
          const selected = model.value === selectedModel;
          return (
            <Pressable
              key={model.value}
              style={[
                styles.option,
                { backgroundColor: selected ? colors.primary : colors.surfaceAlt },
              ]}
              onPress={() => setSelectedModel(model.value)}
              accessibilityRole="button"
              accessibilityLabel={`Select model ${model.label}`}
              accessibilityState={{ selected }}
            >
              <Text
                style={[styles.optionText, { color: selected ? colors.primaryText : colors.text }]}
              >
                {model.label}
              </Text>
            </Pressable>
          );
        })
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        First message (optional)
      </Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]}
        placeholder="Say hello…"
        placeholderTextColor={colors.placeholder}
        multiline
        accessibilityLabel="First message (optional)"
        value={firstMessage}
        onChangeText={setFirstMessage}
      />
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
          <Pressable
            style={[
              styles.create,
              {
                backgroundColor: colors.primary,
                opacity: !selectedProject || !selectedProvider || creating ? 0.5 : 1,
              },
            ]}
            onPress={create}
            disabled={!selectedProject || !selectedProvider || creating}
            accessibilityRole="button"
            accessibilityLabel="Start chatting"
            accessibilityState={{ disabled: !selectedProject || !selectedProvider || creating }}
          >
            {creating ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={[styles.createText, { color: colors.primaryText }]}>Start chatting</Text>
            )}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 12 },
  hint: { fontSize: 13 },
  option: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectText: { flex: 1 },
  recap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  recapText: { flex: 1, fontSize: 15, fontWeight: '600' },
  recapChange: { fontSize: 14, fontWeight: '600' },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  optionText: { fontSize: 15 },
  empty: { fontSize: 14 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 80 },
  error: { textAlign: 'center' },
  create: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  createText: { fontSize: 16, fontWeight: '600' },
});
