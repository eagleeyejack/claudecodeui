/** Green/amber dot reflecting the shared chat socket. */
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { chatSocket } from '@/lib/ws';
import { useTheme } from '@/lib/theme';

export function ConnectionStatus() {
  // Seed from current state: the socket may have opened before this mounted.
  const [connected, setConnected] = useState(() => chatSocket.isConnected());
  useEffect(() => chatSocket.onStatus(setConnected), []);
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="text"
      accessibilityLabel={connected ? 'Live' : 'Offline'}
      style={{ color: connected ? colors.success : colors.danger, fontSize: 12 }}
    >
      {connected ? '● live' : '○ offline'}
    </Text>
  );
}
