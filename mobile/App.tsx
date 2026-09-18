/** App shell: theme + safe-area providers, auth gate, stack + slide-over drawer. */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { chatSocket } from '@/lib/ws';
import { loadAuth } from '@/lib/store';
import { ThemeProvider, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/lib/navigation';
import { AppDrawer } from '@/ui/AppDrawer';
import { ConnectScreen } from '@/screens/ConnectScreen';
import { ProjectsScreen } from '@/screens/ProjectsScreen';
import { ChatScreen } from '@/screens/ChatScreen';
import { NewSessionScreen } from '@/screens/NewSessionScreen';
import { ArchiveScreen } from '@/screens/ArchiveScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking = {
  prefixes: ['exp://', 'cloudcli://'],
  config: {
    screens: {
      Connect: 'connect',
      // Deep link straight into a session: exp://…/chat/:sessionId
      // (lands on Chat pushed over the drawer; drawer screens need no URLs).
      Chat: 'chat/:sessionId',
    },
  },
};

/** Hamburger in the Projects header; opens the slide-over drawer. */
function MenuButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      hitSlop={8}
      style={{ marginLeft: 4, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name="menu-outline" size={24} color={colors.text} />
    </Pressable>
  );
}

/** Banner when the device has no network; sending is held, not dropped. */
function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const { colors } = useTheme();
  useEffect(() => {
    void NetInfo.fetch().then((state) => setOffline(!(state.isConnected ?? true)));
  }, []);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setOffline(!(state.isConnected ?? true)));
    return unsubscribe;
  }, []);
  if (!offline) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: colors.danger, paddingVertical: 6, alignItems: 'center' }}
    >
      <Text style={{ color: colors.primaryText, fontSize: 12, fontWeight: '600' }}>
        No connection — messages will send when you’re back online
      </Text>
    </View>
  );
}

function Shell() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string>('Projects');
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const { resolved, colors } = useTheme();

  useEffect(() => {
    void loadAuth().then((auth) => {
      if (auth) setSignedIn(true);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    chatSocket.connect();
    return () => {
      chatSocket.close();
    };
  }, [signedIn]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const navigateFromDrawer = useCallback(
    (name: 'Projects' | 'NewSession' | 'Archive' | 'Settings') => {
      navigationRef.navigate(name);
    },
    [navigationRef],
  );

  if (!ready) return null;

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={resolved === 'light' ? 'dark' : 'light'} />
      <OfflineBanner />
      <NavigationContainer
        ref={navigationRef}
        linking={linking}
        onStateChange={() => {
          const current = navigationRef.getCurrentRoute()?.name;
          if (current) setActiveRoute(current);
        }}
      >
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerTitleStyle: { color: colors.text },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          {!signedIn ? (
            <Stack.Screen name="Connect" options={{ headerShown: false }}>
              {() => <ConnectScreen onSignedIn={() => setSignedIn(true)} />}
            </Stack.Screen>
          ) : (
            <>
              <Stack.Screen
                name="Projects"
                component={ProjectsScreen}
                options={{
                  title: 'Projects',
                  headerLeft: () => <MenuButton onPress={openDrawer} />,
                }}
              />
              <Stack.Screen name="NewSession" component={NewSessionScreen} options={{ title: 'New session' }} />
              <Stack.Screen name="Archive" component={ArchiveScreen} options={{ title: 'Archive' }} />
              <Stack.Screen name="Settings" options={{ title: 'Settings' }}>
                {(props) => (
                  <SettingsScreen {...props} onSignedOut={() => setSignedIn(false)} />
                )}
              </Stack.Screen>
              <Stack.Screen name="Chat" component={ChatScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {signedIn ? (
        <AppDrawer
          open={drawerOpen}
          activeRoute={activeRoute}
          onNavigate={navigateFromDrawer}
          onClose={closeDrawer}
        />
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
