import React, { useMemo } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';

import { PageHeader } from '../components/BackButton';
import { CARD_SHADOW } from '../components/SettingsUi';
import { t } from '../lib/i18n';
import { LegalDocumentId, buildLegalDocument } from '../lib/legalDocuments';
import { legalWebUrl, splitLegalLinks } from '../lib/legalLinks';
import { storePlatformOf } from '../lib/storeLinks';
import { Theme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { AppLanguage } from '../types/models';

interface LegalDocumentScreenProps {
  document: LegalDocumentId;
  language: AppLanguage;
  onBack: () => void;
}

/**
 * Renders the privacy policy or the terms from src/lib/legalDocuments.ts.
 *
 * One screen for both, because they are the same shape and a legal document
 * whose in-app version can drift from its published version is worse than
 * having none. Both read from the same data the Markdown export uses.
 */
export function LegalDocumentScreen({ document, language, onBack }: LegalDocumentScreenProps) {
  const styles = useThemedStyles(makeStyles);
  // The phone's own store and backup: an iPhone is not told about Google Play.
  // The published documents (docs/legal) are the ones that name both.
  const platform = storePlatformOf(Platform.OS);
  const doc = useMemo(() => buildLegalDocument(document, language, platform), [document, language, platform]);

  const open = (url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  };
  // An address in the text (the account deletion page) opens it; the rest of
  // the sentence stays text.
  const withLinks = (text: string) =>
    splitLegalLinks(text).map((part, partIndex) =>
      part.url ? (
        <Text key={partIndex} accessibilityRole="link" onPress={() => open(part.url!)} style={styles.inlineLink}>
          {part.text}
        </Text>
      ) : (
        part.text
      ),
    );

  return (
    <View style={styles.screen}>
      <PageHeader style={styles.header} title={doc.title} onBack={onBack} backLabel={t(language, 'common.back')} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={styles.updated}>{doc.updatedLabel}</Text>
        <Text style={styles.summary}>{doc.summary}</Text>

        {doc.sections.map((section, index) => (
          <View key={section.heading} style={[styles.card, index === 0 && styles.cardFirst]}>
            <Text style={styles.heading}>{section.heading}</Text>
            {(section.body ?? []).map((paragraph, paragraphIndex) => (
              <Text key={paragraphIndex} style={styles.paragraph}>
                {withLinks(paragraph)}
              </Text>
            ))}
            {(section.bullets ?? []).map((bullet, bulletIndex) => (
              <View key={bulletIndex} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{withLinks(bullet)}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* The same document on styxon.fi, for the reader who wants the web
            copy (user, 2026-10-05). The screen above stays the one read: it
            works offline and is the version the reader accepts. */}
        <Pressable
          accessibilityRole="link"
          onPress={() => open(legalWebUrl(document, language))}
          hitSlop={8}
          style={({ pressed }) => [styles.webLink, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.webLinkText}>{t(language, 'legal.readOnWeb')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    paddingHorizontal: layout.screenGutter,
    paddingTop: layout.pageHeaderTop,
    paddingBottom: 6,
  },
  body: {
    paddingHorizontal: layout.screenGutter,
    paddingBottom: layout.bottomTabBarReserve,
  },
  updated: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: theme.muted,
  },
  summary: {
    marginTop: 8,
    fontSize: 15.5,
    lineHeight: 23,
    fontWeight: '600',
    color: theme.ink,
  },
  card: {
    marginTop: 14,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 15,
    ...CARD_SHADOW,
  },
  cardFirst: {
    marginTop: 18,
  },
  heading: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.ink,
    marginBottom: 9,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    color: theme.muted,
    marginBottom: 9,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 8,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.purple,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    color: theme.muted,
  },
  inlineLink: {
    color: theme.highlight,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  webLink: {
    alignSelf: 'center',
    marginTop: 18,
    paddingVertical: 8,
  },
  webLinkText: {
    color: theme.highlight,
    fontSize: 14,
    fontWeight: '800',
  },
});
