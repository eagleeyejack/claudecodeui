jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { SessionSettingsSheet } from '@/ui/SessionSettingsSheet';
import type { SessionSettingsSheetProps } from '@/ui/SessionSettingsSheet';

const models = [
  { value: 'grok-4.6', label: 'Grok 4.6', description: 'OpenCode Go' },
  { value: 'glm-5.3-flash', label: 'GLM 5.3 Flash', description: 'OpenCode Go' },
  { value: 'my-custom', label: 'My Custom', isCustom: true },
];

const baseProps: SessionSettingsSheetProps = {
  visible: true,
  provider: 'opencode',
  permissionModes: ['default', 'plan'],
  activePermissionMode: 'default',
  onSelectPermissionMode: jest.fn(),
  activeModel: 'grok-4.6',
  activeEffort: 'default',
  supportsEffort: false,
  models,
  modelsDefault: 'grok-4.6',
  loadingModels: false,
  modelsError: null,
  onRetryModels: jest.fn(),
  onSelectModel: jest.fn(),
  onSelectEffort: jest.fn(),
  favouriteModels: [],
  onToggleFavourite: jest.fn(),
  agents: [],
  activeAgent: 'build',
  onSelectAgent: jest.fn(),
  onClose: jest.fn(),
};

describe('SessionSettingsSheet', () => {
  it('renders build/plan agents and selects one', async () => {
    const onSelectAgent = jest.fn();
    await render(
      <SessionSettingsSheet {...{ ...baseProps, onSelectAgent }} />,
    );
    expect(screen.getByLabelText('Select agent Build')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Select agent Plan'));
    expect(onSelectAgent).toHaveBeenCalledWith('plan');
  });

  it('lists custom agents and moves plan out of Permissions', async () => {
    const onSelectAgent = jest.fn();
    await render(
      <SessionSettingsSheet
        {...{
          ...baseProps,
          onSelectAgent,
          agents: [{ name: 'crew-builder', description: 'Builds.', scope: 'user', sourcePath: '/a.md' }],
        }}
      />,
    );
    await fireEvent.press(screen.getByLabelText('Select agent crew-builder'));
    expect(onSelectAgent).toHaveBeenCalledWith('crew-builder');
    expect(screen.queryByLabelText('Select permission mode Plan')).toBeNull();
    expect(screen.getByLabelText('Select permission mode Default')).toBeTruthy();
  });

  it('shows plan under Permissions for non-opencode providers', async () => {
    await render(
      <SessionSettingsSheet
        {...{
          ...baseProps,
          provider: 'claude',
          permissionModes: ['default', 'plan'],
        }}
      />,
    );
    expect(screen.queryByLabelText('Select agent Build')).toBeNull();
    expect(screen.getByLabelText('Select permission mode Plan')).toBeTruthy();
  });

  it('hides the agent section without permission modes', async () => {
    await render(<SessionSettingsSheet {...{ ...baseProps, permissionModes: [] }} />);
    expect(screen.queryByLabelText('Select agent Plan')).toBeNull();
    expect(screen.getByLabelText('Select model Grok 4.6')).toBeTruthy();
  });

  it('filters models by label and value', async () => {
    await render(<SessionSettingsSheet {...baseProps} />);
    expect(screen.getByLabelText('Select model Grok 4.6')).toBeTruthy();
    expect(screen.getByLabelText('Select model GLM 5.3 Flash')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search models'), 'glm');
    expect(screen.queryByLabelText('Select model Grok 4.6')).toBeNull();
    expect(screen.getByLabelText('Select model GLM 5.3 Flash')).toBeTruthy();
  });

  it('shows an empty state when nothing matches', async () => {
    await render(<SessionSettingsSheet {...baseProps} />);
    await fireEvent.changeText(screen.getByLabelText('Search models'), 'zzz-nope');
    expect(screen.getByText('No models match "zzz-nope".')).toBeTruthy();
  });

  it('toggles a favourite via the star button', async () => {
    const onToggleFavourite = jest.fn();
    await render(
      <SessionSettingsSheet {...{ ...baseProps, onToggleFavourite }} />,
    );
    await fireEvent.press(screen.getByLabelText('Favourite model Grok 4.6'));
    expect(onToggleFavourite).toHaveBeenCalledWith('grok-4.6');
  });

  it('pins favourited models in a Favourites section', async () => {
    await render(
      <SessionSettingsSheet {...{ ...baseProps, favouriteModels: ['glm-5.3-flash'] }} />,
    );
    expect(screen.getByText('Favourites')).toBeTruthy();
    expect(screen.getByLabelText('Unfavourite model GLM 5.3 Flash')).toBeTruthy();
  });
});
