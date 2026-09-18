/** Slide-over app drawer (custom Animated implementation). */
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getAuth } from '@/lib/api';
import { ConnectionStatus } from '@/ui/ConnectionStatus';
import { useTheme } from '@/lib/theme';
import type { ThemeMode } from '@/lib/theme';
import type { RootStackParamList } from '@/lib/navigation';

type DrawerDestination = 'Projects' | 'NewSession' | 'Archive' | 'Settings';

type DrawerItem = {
  name: DrawerDestination;
  label: string;
  icon: 'home-outline' | 'add-circle-outline' | 'archive-outline' | 'settings-outline';
};

const ITEMS: DrawerItem[] = [
  { name: 'Projects', label: 'Projects', icon: 'home-outline' },
  { name: 'NewSession', label: 'New session', icon: 'add-circle-outline' },
  { name: 'Archive', label: 'Archive', icon: 'archive-outline' },
  { name: 'Settings', label: 'Settings', icon: 'settings-outline' },
];

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const PANEL_WIDTH = Math.min(300, Dimensions.get('window').width * 0.82);

type AppDrawerProps = {
  open: boolean;
  activeRoute: keyof RootStackParamList | string;
  onNavigate: (name: DrawerDestination) => void;
  onClose: () => void;
};

/**
 * Used by the app shell, rendered above the navigator. Pure React Native
 * Animated API — no gesture/reanimated native dependencies.
 */
export function AppDrawer({ open, activeRoute, onNavigate, onClose }: AppDrawerProps) {
  const { colors, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  // Panel position + scrim opacity, driven by `open`.
  const slide = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: open ? 0 : -PANEL_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: open ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, slide, fade]);

  if (!open) return null;
  const baseUrl = getAuth()?.baseUrl ?? '';

  const go = (name: DrawerDestination) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    onNavigate(name);
  };

  return (
    <View style={StyleSheet.absoluteFill} accessibilityLabel="App menu">
      <Animated.View style={[styles.scrim, { opacity: fade, backgroundColor: colors.scrim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            backgroundColor: colors.surface,
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 12,
            transform: [{ translateX: slide }],
          },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>CloudCLI</Text>
        {ITEMS.map((item) => {
          const selected = activeRoute === item.name;
          return (
            <Pressable
              key={item.name}
              style={[
                styles.item,
                { backgroundColor: selected ? colors.surfaceAlt : 'transparent' },
              ]}
              onPress={() => go(item.name)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={selected ? colors.primary : colors.textMuted}
              />
              <Text
                style={[
                  styles.itemLabel,
                  { color: selected ? colors.text : colors.textMuted },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Theme</Text>
        <View style={styles.modes} accessibilityLabel="Theme">
          {MODES.map((option) => {
            const selected = mode === option.value;
            return (
              <Pressable
                key={option.value}
                style={[
                  styles.mode,
                  { backgroundColor: selected ? colors.primary : colors.surfaceAlt },
                ]}
                onPress={() => setMode(option.value)}
                accessibilityRole="button"
                accessibilityLabel={`Theme ${option.label}`}
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.modeLabel,
                    { color: selected ? colors.primaryText : colors.text },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.footer}>
          <ConnectionStatus />
          {baseUrl ? (
            <Text style={[styles.server, { color: colors.textMuted }]} numberOfLines={1}>
              {baseUrl}
            </Text>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_WIDTH,
    paddingHorizontal: 16,
    gap: 4,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12, paddingHorizontal: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  itemLabel: { fontSize: 15, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  sectionLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: 8, marginBottom: 8 },
  modes: { flexDirection: 'row', gap: 8 },
  mode: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  modeLabel: { fontSize: 13, fontWeight: '600' },
  footer: { marginTop: 'auto', paddingTop: 12, paddingHorizontal: 8, gap: 4 },
  server: { fontSize: 11 },
});
