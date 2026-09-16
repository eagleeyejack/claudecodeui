/** Minimal state router: Connect → Projects → Chat. No navigation dependency for v1. */
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { chatSocket } from '@/lib/ws';
import { loadAuth } from '@/lib/store';
import type { ProjectSummary, SessionSummary } from '@/lib/api';
import { ConnectScreen } from '@/screens/ConnectScreen';
import { ProjectsScreen } from '@/screens/ProjectsScreen';
import { ChatScreen } from '@/screens/ChatScreen';

type Route = { name: 'projects' } | { name: 'chat'; project: ProjectSummary; session: SessionSummary };

export default function App() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'projects' });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    void loadAuth().then((auth) => {
      if (auth) setSignedIn(true);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    chatSocket.connect();
    const off = chatSocket.onStatus(setConnected);
    return () => {
      off();
      chatSocket.close();
    };
  }, [signedIn]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style="light" />
      {!signedIn ? (
        <ConnectScreen onSignedIn={() => setSignedIn(true)} />
      ) : route.name === 'projects' ? (
        <ProjectsScreen onOpenSession={(project, session) => setRoute({ name: 'chat', project, session })} />
      ) : (
        <ChatScreen project={route.project} session={route.session} onBack={() => setRoute({ name: 'projects' })} />
      )}
      {signedIn ? <Text style={{ position: 'absolute', top: 14, right: 16, color: connected ? '#22c55e' : '#f87171', fontSize: 10 }}>
        {connected ? '● live' : '○ offline'}
      </Text> : null}
    </>
  );
}
