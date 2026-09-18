/**
 * Full-width session settings drawer: agent (permission mode), reasoning
 * effort, and model for one session's provider.
 *
 * The badge button in the composer opens this sheet. Model/effort rows persist
 * per session through `setActiveModel` / `setActiveEffort` (owned by the
 * parent) and ride on every `chat.send` options until then. The agent mode is
 * session-local state in the parent and rides on every `chat.send` options as
 * `permissionMode` (omitted while `default`). Effort and agent sections only
 * appear when the provider's capabilities advertise them.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { LLMProvider, ModelOption, ProviderAgent } from '@/lib/api';
import { providerLabel } from '@/lib/store';
import { useTheme } from '@/lib/theme';

export const DEFAULT_EFFORT_VALUE = 'default';
export const DEFAULT_PERMISSION_MODE = 'default';
export const DEFAULT_AGENT_VALUE = 'build';

/**
 * Effort values offered when the catalog carries no per-model metadata.
 * Mirrors the web composer's pre-catalog superset per provider.
 */
const FALLBACK_EFFORT_VALUES: Record<string, readonly string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  opencode: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
};

const MODE_LABELS: Record<string, string> = {
  default: 'Default',
  auto: 'Auto',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass permissions',
  plan: 'Plan',
};

export function permissionModeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** Display name for an agent value: built-ins are titled, customs show raw. */
export function agentLabel(name: string): string {
  if (name === DEFAULT_AGENT_VALUE) return 'Build';
  if (name === 'plan') return 'Plan';
  return name;
}

/** Agent-flavoured copy for opencode, approval-flavoured for the rest. */
export function permissionModeDescription(provider: LLMProvider, mode: string): string {
  if (provider === 'opencode') {
    switch (mode) {
      case 'plan':
        return 'Plan agent — researches read-only, makes no code changes.';
      case 'bypassPermissions':
        return 'Build agent with full system access. Use with caution.';
      case 'acceptEdits':
        return 'Build agent — workspace commands run automatically.';
      default:
        return 'Build agent — asks for approval, can write to the workspace.';
    }
  }
  switch (mode) {
    case 'plan':
      return 'Planning mode — no commands are executed.';
    case 'bypassPermissions':
      return 'Full system access with no restrictions. Use with caution.';
    case 'acceptEdits':
      return 'All workspace commands run automatically.';
    case 'auto':
      return 'A classifier approves or denies each tool call.';
    default:
      return 'Asks for approval before acting.';
  }
}

export type SessionSettingsSheetProps = {
  visible: boolean;
  provider: LLMProvider;
  permissionModes: string[];
  activePermissionMode: string;
  onSelectPermissionMode: (mode: string) => void;
  agents: ProviderAgent[];
  activeAgent: string;
  onSelectAgent: (name: string) => void;
  activeModel: string;
  activeEffort: string;
  supportsEffort: boolean;
  models: ModelOption[] | null;
  modelsDefault: string;
  loadingModels: boolean;
  modelsError: string | null;
  onRetryModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: string) => void;
  favouriteModels: string[];
  onToggleFavourite: (model: string) => void;
  onClose: () => void;
};

/** Effort values for the active model: catalog metadata first, provider fallback otherwise. */
export function effortOptionsFor(
  provider: LLMProvider,
  activeModel: string,
  models: ModelOption[] | null,
): string[] {
  const match = models?.find((option) => option.value === activeModel) ?? null;
  const fromCatalog = match?.effort?.values.map((entry) => entry.value).filter(Boolean) ?? [];
  if (fromCatalog.length > 0) return fromCatalog;
  return [...(FALLBACK_EFFORT_VALUES[provider] ?? [])];
}

export function SessionSettingsSheet({
  visible,
  provider,
  permissionModes,
  activePermissionMode,
  onSelectPermissionMode,
  activeModel,
  activeEffort,
  supportsEffort,
  models,
  modelsDefault,
  loadingModels,
  modelsError,
  onRetryModels,
  onSelectModel,
  onSelectEffort,
  favouriteModels,
  onToggleFavourite,
  agents,
  activeAgent,
  onSelectAgent,
  onClose,
}: SessionSettingsSheetProps) {
  const { colors } = useTheme();
  const showAgentSection = provider === 'opencode';
  const offersPlan = permissionModes.includes('plan');
  // Plan rides the agent flag on opencode, so it moves out of Permissions
  // into the Agent section next to build and the custom agents.
  const approvalModes = showAgentSection
    ? permissionModes.filter((mode) => mode !== 'plan')
    : permissionModes;
  const [modelQuery, setModelQuery] = useState('');

  // Fresh search each time the drawer opens.
  useEffect(() => {
    if (!visible) setModelQuery('');
  }, [visible]);

  const favouriteSet = useMemo(() => new Set(favouriteModels), [favouriteModels]);

  const { favourites, predefined, custom } = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    const all = models ?? [];
    const searched = needle
      ? all.filter((option) =>
          `${option.label ?? ''} ${option.value} ${option.description ?? ''}`
            .toLowerCase()
            .includes(needle),
        )
      : all;
    return {
      favourites: searched.filter((option) => favouriteSet.has(option.value)),
      predefined: searched.filter((option) => !option.isCustom && !favouriteSet.has(option.value)),
      custom: searched.filter((option) => option.isCustom && !favouriteSet.has(option.value)),
    };
  }, [models, modelQuery, favouriteSet]);

  const effortOptions = useMemo(
    () => (supportsEffort ? effortOptionsFor(provider, activeModel, models) : []),
    [supportsEffort, provider, activeModel, models],
  );

  const select = (run: () => void) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    run();
  };

  const renderModelRow = (item: ModelOption) => {
    const selected = item.value === activeModel;
    const favourited = favouriteSet.has(item.value);
    return (
      <View key={item.value} style={[styles.row, { borderBottomColor: colors.border }]}>
        <Pressable
          style={styles.rowText}
          onPress={() => select(() => onSelectModel(item.value))}
          accessibilityRole="button"
          accessibilityLabel={`Select model ${item.label || item.value}`}
          accessibilityState={{ selected }}
        >
          <Text style={[styles.rowLabel, { color: colors.text }]}>
            {item.label || item.value}
          </Text>
          {item.description ? (
            <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => select(() => onToggleFavourite(item.value))}
          accessibilityRole="button"
          accessibilityLabel={
            favourited
              ? `Unfavourite model ${item.label || item.value}`
              : `Favourite model ${item.label || item.value}`
          }
          accessibilityState={{ selected: favourited }}
          hitSlop={12}
          style={styles.star}
        >
          <Ionicons
            name={favourited ? 'star' : 'star-outline'}
            size={20}
            color={favourited ? colors.primary : colors.textMuted}
          />
        </Pressable>
        {selected ? (
          <Text style={[styles.check, { color: colors.primary }]}>✓</Text>
        ) : null}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityLabel="Session settings"
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss settings"
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => undefined}
          accessibilityRole="none"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {providerLabel(provider)} settings
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              hitSlop={12}
            >
              <Text style={[styles.done, { color: colors.primary }]}>Done</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {showAgentSection && (
              <View>
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Agent</Text>
                {[
                  { name: DEFAULT_AGENT_VALUE, description: permissionModeDescription(provider, 'default') },
                  ...(offersPlan
                    ? [{ name: 'plan', description: permissionModeDescription(provider, 'plan') }]
                    : []),
                  ...agents.map((agent) => ({
                    name: agent.name,
                    description: agent.description || 'Custom agent.',
                  })),
                ].map((agent) => {
                  const selected = (activeAgent || DEFAULT_AGENT_VALUE) === agent.name;
                  return (
                    <Pressable
                      key={agent.name}
                      style={[styles.row, { borderBottomColor: colors.border }]}
                      onPress={() => select(() => onSelectAgent(agent.name))}
                      accessibilityRole="button"
                      accessibilityLabel={`Select agent ${agentLabel(agent.name)}`}
                      accessibilityState={{ selected }}
                    >
                      <View style={styles.rowText}>
                        <Text style={[styles.rowLabel, { color: colors.text }]}>
                          {agentLabel(agent.name)}
                        </Text>
                        <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={2}>
                          {agent.description}
                        </Text>
                      </View>
                      {selected ? (
                        <Text style={[styles.check, { color: colors.primary }]}>✓</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {approvalModes.length > 0 && (
              <View>
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Permissions</Text>
                {approvalModes.map((mode) => {
                  const selected = (activePermissionMode || DEFAULT_PERMISSION_MODE) === mode;
                  return (
                    <Pressable
                      key={mode}
                      style={[styles.row, { borderBottomColor: colors.border }]}
                      onPress={() => select(() => onSelectPermissionMode(mode))}
                      accessibilityRole="button"
                      accessibilityLabel={`Select permission mode ${permissionModeLabel(mode)}`}
                      accessibilityState={{ selected }}
                    >
                      <View style={styles.rowText}>
                        <Text style={[styles.rowLabel, { color: colors.text }]}>
                          {permissionModeLabel(mode)}
                        </Text>
                        <Text style={[styles.rowSub, { color: colors.textMuted }]} numberOfLines={2}>
                          {permissionModeDescription(provider, mode)}
                        </Text>
                      </View>
                      {selected ? (
                        <Text style={[styles.check, { color: colors.primary }]}>✓</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {effortOptions.length > 0 && (
              <View style={styles.effortBlock}>
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Reasoning</Text>
                <View style={styles.chips}>
                  {[DEFAULT_EFFORT_VALUE, ...effortOptions].map((value) => {
                    const selected = (activeEffort || DEFAULT_EFFORT_VALUE) === value;
                    return (
                      <Pressable
                        key={value}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected ? colors.primary : colors.surfaceAlt,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => select(() => onSelectEffort(value))}
                        accessibilityRole="button"
                        accessibilityLabel={`Select effort ${value}`}
                        accessibilityState={{ selected }}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: selected ? colors.primaryText : colors.text },
                          ]}
                        >
                          {value === DEFAULT_EFFORT_VALUE ? `Default${modelsDefault ? ` (${modelsDefault})` : ''}` : value}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Models</Text>
            <TextInput
              style={[styles.search, { backgroundColor: colors.inputBackground, color: colors.text }]}
              placeholder="Search models"
              placeholderTextColor={colors.placeholder}
              accessibilityLabel="Search models"
              value={modelQuery}
              onChangeText={setModelQuery}
              returnKeyType="search"
            />
            {loadingModels ? (
              <ActivityIndicator color={colors.primary} style={styles.loader} />
            ) : modelsError && favourites.length === 0 && predefined.length === 0 && custom.length === 0 ? (
              <View style={styles.centerWrap}>
                <Text style={[styles.centerText, { color: colors.textMuted }]}>{modelsError}</Text>
                <Pressable
                  style={[styles.retry, { backgroundColor: colors.primary }]}
                  onPress={onRetryModels}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading models"
                >
                  <Text style={[styles.retryText, { color: colors.primaryText }]}>Retry</Text>
                </Pressable>
              </View>
            ) : favourites.length === 0 && predefined.length === 0 && custom.length === 0 ? (
              <Text style={[styles.centerText, { color: colors.textMuted }]}>
                {modelQuery.trim()
                  ? `No models match "${modelQuery.trim()}".`
                  : `No models available for ${providerLabel(provider)} yet.`}
              </Text>
            ) : (
              <View>
                {favourites.length > 0 && (
                  <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Favourites</Text>
                )}
                {favourites.map(renderModelRow)}
                {predefined.map(renderModelRow)}
                {custom.length > 0 && (
                  <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Custom</Text>
                )}
                {custom.map(renderModelRow)}
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  title: { fontSize: 17, fontWeight: '700' },
  done: { fontSize: 15, fontWeight: '600' },
  body: { paddingHorizontal: 20, paddingBottom: 8 },
  search: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginBottom: 4 },
  effortBlock: { marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  loader: { marginVertical: 24 },
  centerWrap: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  centerText: { textAlign: 'center', fontSize: 14 },
  retry: { borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 },
  star: { padding: 6 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 2 },
  check: { fontSize: 17, fontWeight: '700' },
});
