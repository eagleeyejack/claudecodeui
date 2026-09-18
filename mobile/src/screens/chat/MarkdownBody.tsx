/** Theme-styled Markdown for chat bubbles: code copy, image viewer, links. */
import { useMemo, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/lib/theme';

type MarkdownBodyProps = { content: string; textColor: string };

const copyText = (value: string): void => {
  void Clipboard.setStringAsync(value);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

export function MarkdownBody({ content, textColor }: MarkdownBodyProps) {
  const { colors } = useTheme();
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const renderCode = (node: ASTNode) => (
    <View key={node.key} style={[styles.codeBlock, { backgroundColor: colors.codeBackground }]}>
      <Text selectable style={[styles.codeText, { color: colors.codeText }]}>
        {node.content}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy code block"
        onPress={() => copyText(node.content)}
        style={[styles.copyButton, { borderColor: colors.border }]}
      >
        <Text style={[styles.copyText, { color: colors.codeText }]}>Copy</Text>
      </Pressable>
    </View>
  );

  const rules: RenderRules = useMemo(
    () => ({
      code_block: renderCode,
      fence: renderCode,
      image: (node) => {
        const uri = String(node.attributes?.src ?? '');
        if (!uri) return null;
        const alt = String(node.attributes?.alt ?? 'Chat image');
        return (
          <Pressable
            key={node.key}
            accessibilityRole="button"
            accessibilityLabel="Open image fullscreen"
            onPress={() => setViewerUri(uri)}
          >
            <Image source={{ uri }} style={styles.thumbnail} resizeMode="cover" accessibilityLabel={alt} />
          </Pressable>
        );
      },
    }),
    // renderCode closes over theme colors; rebuilt with the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors.codeBackground, colors.text, colors.border, colors.textMuted],
  );

  const mdStyle = useMemo(
    () => ({
      body: { color: textColor, fontSize: 15 },
      heading1: { color: textColor },
      heading2: { color: textColor },
      heading3: { color: textColor },
      heading4: { color: textColor },
      heading5: { color: textColor },
      heading6: { color: textColor },
      paragraph: { color: textColor, fontSize: 15 },
      text: { color: textColor },
      list_item: { color: textColor },
      bullet_list_icon: { color: textColor },
      ordered_list_icon: { color: textColor },
      code_inline: { color: colors.codeText, backgroundColor: colors.codeBackground, fontSize: 13 },
      link: { color: colors.primary },
      blockquote: { color: colors.textMuted, backgroundColor: colors.surfaceAlt },
    }),
    [colors, textColor],
  );

  return (
    <View>
      <Markdown
        rules={rules}
        style={mdStyle}
        onLinkPress={(url) => {
          void Linking.openURL(url).catch(() => undefined);
          return true;
        }}
      >
        {content}
      </Markdown>
      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
      >
        <View style={[styles.viewer, { backgroundColor: colors.background }]}>
          {viewerUri ? (
            <Image
              source={{ uri: viewerUri }}
              style={styles.fullImage}
              resizeMode="contain"
              accessibilityLabel="Fullscreen chat image"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close image viewer"
            onPress={() => setViewerUri(null)}
            style={[styles.closeButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.closeText, { color: colors.primaryText }]}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  codeBlock: { borderRadius: 8, padding: 10, marginVertical: 4 },
  codeText: { fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  copyButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  copyText: { fontSize: 12, fontWeight: '600' },
  thumbnail: { width: 160, height: 120, borderRadius: 8, marginVertical: 4 },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  fullImage: { width: '100%', height: '70%' },
  closeButton: { marginTop: 24, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  closeText: { fontSize: 15, fontWeight: '600' },
});
