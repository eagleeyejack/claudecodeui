/** Settings: theme picker, server URL display, sign out. */
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { getAuth } from '@/lib/api';
import { clearAuth } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import type { ThemeMode } from '@/lib/theme';
import { chatSocket } from '@/lib/ws';
import type { RootStackParamList } from '@/lib/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'> & {
  onSignedOut: () => void;
};

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function SettingsScreen({ onSignedOut }: Props) {
  const { colors, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const serverUrl = getAuth()?.baseUrl ?? 'Not connected';

  const signOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to use the app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            } finally {
              await clearAuth();
              chatSocket.close();
              onSignedOut();
            }
          })();
        },
      },
    ]);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingBottom: insets.bottom },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        Theme
      </Text>
      <View style={styles.segment} accessibilityLabel="Theme picker">
        {MODES.map((option) => {
          const selected = mode === option.value;
          return (
            <Pressable
              key={option.value}
              style={[
                styles.segmentButton,
                { backgroundColor: selected ? colors.primary : colors.surfaceAlt },
              ]}
              onPress={() => setMode(option.value)}
              accessibilityRole="button"
              accessibilityLabel={`Theme ${option.label.toLowerCase()}`}
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: selected ? colors.primaryText : colors.text },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        Server
      </Text>
      <Text
        style={[styles.serverUrl, { color: colors.textMuted }]}
        accessibilityLabel="Server URL"
      >
        {serverUrl}
      </Text>

      <Pressable
        style={[styles.signOut, { backgroundColor: colors.surfaceAlt }]}
        onPress={signOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={[styles.signOutText, { color: colors.danger }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentButton: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  segmentText: { fontSize: 14, fontWeight: '600' },
  serverUrl: { fontSize: 14 },
  signOut: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  signOutText: { fontSize: 16, fontWeight: '600' },
});
