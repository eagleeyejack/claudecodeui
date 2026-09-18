/** First-run screen: server URL + web-app credentials, validated against /health then /api/auth/login. */
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { healthCheck, login } from '@/lib/api';
import { loadLastServerUrl, saveAuth, saveLastServerUrl } from '@/lib/store';
import { useTheme } from '@/lib/theme';

export function ConnectScreen({ onSignedIn }: { onSignedIn: () => void }) {
  // No hardcoded default: `localhost` on a phone means the phone itself, so a
  // wrong default produces a confusing DNS error (JAA-224). Prefill the last
  // URL that actually worked, if there is one.
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    void loadLastServerUrl().then((last) => {
      // Only prefill when the field is still empty: a late SecureStore read
      // must not clobber a URL the user already typed.
      if (!cancelled && last) setBaseUrl((current) => current || last);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await healthCheck(baseUrl);
      const auth = await login(baseUrl, username.trim(), password);
      await saveAuth(auth);
      // Remember the working URL separately: auth is wiped on sign-out, but
      // the server address is still the right prefill next time.
      await saveLastServerUrl(auth.baseUrl);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSignedIn();
    } catch (cause) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(cause instanceof Error ? cause.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={[styles.title, { color: colors.text }]}>CloudCLI</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Sign in to your self-hosted server</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]}
        placeholder="Server URL (http://mac:3450)"
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
        returnKeyType="next"
        editable={!busy}
        accessibilityLabel="Server URL"
        value={baseUrl}
        onChangeText={setBaseUrl}
      />
      <TextInput
        style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]}
        placeholder="Username"
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        textContentType="username"
        autoComplete="username"
        returnKeyType="next"
        editable={!busy}
        accessibilityLabel="Username"
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]}
        placeholder="Password"
        placeholderTextColor={colors.placeholder}
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        returnKeyType="go"
        editable={!busy}
        accessibilityLabel="Password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={signIn}
      />
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      <Pressable
        style={[styles.button, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
        onPress={signIn}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        accessibilityState={{ disabled: busy, busy }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: 16 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { textAlign: 'center' },
});
