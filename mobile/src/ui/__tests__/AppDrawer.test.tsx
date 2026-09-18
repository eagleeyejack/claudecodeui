jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppDrawer } from '@/ui/AppDrawer';

const baseProps = {
  open: true,
  activeRoute: 'Projects',
  onNavigate: jest.fn(),
  onClose: jest.fn(),
};

describe('AppDrawer', () => {
  it('renders nothing when closed', async () => {
    await render(<AppDrawer {...baseProps} open={false} onNavigate={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('App menu')).toBeNull();
  });

  it('renders all destinations and navigates on press', async () => {
    const onNavigate = jest.fn();
    const onClose = jest.fn();
    await render(<AppDrawer {...baseProps} onNavigate={onNavigate} onClose={onClose} />);
    for (const label of ['Projects', 'New session', 'Archive', 'Settings']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    await fireEvent.press(screen.getByLabelText('Archive'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('Archive');
  });

  it('marks the active destination selected', async () => {
    await render(
      <AppDrawer {...baseProps} onNavigate={jest.fn()} onClose={jest.fn()} />,
    );
    expect(screen.getByLabelText('Projects').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Archive').props.accessibilityState.selected).toBe(false);
  });

  it('offers System/Light/Dark theme choices', async () => {
    await render(<AppDrawer {...baseProps} onNavigate={jest.fn()} onClose={jest.fn()} />);
    for (const label of ['Theme System', 'Theme Light', 'Theme Dark']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('shows the connection status', async () => {
    await render(<AppDrawer {...baseProps} onNavigate={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('Live') ?? screen.queryByLabelText('Offline')).toBeTruthy();
  });

  it('closes via the scrim', async () => {
    const onClose = jest.fn();
    await render(<AppDrawer {...baseProps} onNavigate={jest.fn()} onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText('Close menu'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
