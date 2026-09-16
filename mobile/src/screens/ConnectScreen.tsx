/** First-run screen: server URL + web-app credentials, validated against /health then /api/auth/login. */
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { healthCheck, login } from '@/lib/api';
import { saveAuth } from '@/lib/store';

export function ConnectScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [baseUrl, setBaseUrl] = useState('http://localhost:3450');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await healthCheck(baseUrl);
      const auth = await login(baseUrl, username.trim(), password);
      await saveAuth(auth);
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>CloudCLI</Text>
      <Text style={styles.subtitle}>Sign in to your self-hosted server</Text>
      <TextInput style={styles.input} placeholder="Server URL (http://mac:3450)" autoCapitalize="none" autoCorrect={false} value={baseUrl} onChangeText={setBaseUrl} />
      <TextInput style={styles.input} placeholder="Username" autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={signIn} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e14', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: '#fff', fontSize: 32, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#8b93a7', textAlign: 'center', marginBottom: 16 },
  input: { backgroundColor: '#161b26', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#f87171', textAlign: 'center' },
});
