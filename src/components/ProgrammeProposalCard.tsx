import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CutButton } from './CutButton';
import { CutSurface } from './CutSurface';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { I18nKey, t } from '../lib/i18n';
import { ProgrammeProposal } from '../lib/programmeBrief';
import { localizeSessionName } from '../lib/sessionNameLabel';
import { spacing } from '../theme';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * A composed week, wherever it is being read.
 *
 * It lived inside AiProgramComposerScreen, which meant the chat could only
 * hand a brief over and navigate away. Extracting it is what let the week be
 * drawn in the conversation without the day list, the unmet-lift notes and the
 * save path existing in two places — and once that was true, the screen it came
 * from had nothing left that the chat could not do, so it is gone (user
 * 2026-08-26, "koostajaruudun voi poistaa").
 */

export interface ProgrammeProposalCardProps {
  proposal: ProgrammeProposal;
  language: AppLanguage;
  /** 'saving' disables the action; the label says so. */
  busy?: 'idle' | 'saving';
  onSave: () => void;
}

export function ProgrammeProposalCard({
  proposal,
  language,
  busy = 'idle',
  onSave,
}: ProgrammeProposalCardProps) {
  const styles = useThemedStyles(makeStyles);

  /**
   * The line that proves the brief was read. Only what was actually found — an
   * empty read is stated as such rather than padded.
   */
  const readLine = useMemo(() => {
    const parts: string[] = [];
    const { signals } = proposal;
    if (signals.daysPerWeek) {
      // When the ask was bigger than the composer can lay out, say both — it
      // used to report the capped number as though the reader had written it.
      parts.push(
        signals.requestedDaysPerWeek
          ? t(language, 'aiCompose.read.daysCapped', {
              asked: signals.requestedDaysPerWeek,
              count: signals.daysPerWeek,
            })
          : t(language, 'aiCompose.read.days', { count: signals.daysPerWeek }),
      );
    }
    if (signals.lifts.length) {
      parts.push(signals.lifts.map((lift) => exerciseNameLabel(language, lift)).join(', '));
    }
    if (signals.cautions.length) {
      parts.push(
        t(language, 'aiCompose.read.cautions', {
          areas: signals.cautions
            .map((area) => t(language, `aiCompose.caution.${area.replace(' ', '_')}` as I18nKey))
            .join(', '),
        }),
      );
    }
    if (signals.sessionMinutes) {
      parts.push(`~${signals.sessionMinutes} min`);
    }
    return parts.length ? parts.join(' · ') : t(language, 'aiCompose.read.nothing');
  }, [language, proposal]);

  return (
    <CutSurface size="lg" fill="transparent" stroke="transparent" strokeWidth={0} style={styles.card}>
      <Text style={styles.readEyebrow}>{t(language, 'aiCompose.read')}</Text>
      <Text style={styles.readLine}>{readLine}</Text>

      <Text style={styles.title}>{proposal.title}</Text>
      {proposal.sessions.map((session, index) => (
        <View key={`${session.name}-${index}`} style={styles.session}>
          <Text style={styles.sessionName}>{localizeSessionName(session.name, language)}</Text>
          {session.exercises.map((exercise) => (
            <View key={exercise.libraryItemId} style={styles.exerciseRow}>
              <Text style={styles.exerciseName} numberOfLines={2}>
                {exerciseNameLabel(language, exercise.name)}
              </Text>
              <Text style={styles.exerciseScheme}>
                {exercise.sets} ×{' '}
                {exercise.repsMin === exercise.repsMax
                  ? exercise.repsMin
                  : `${exercise.repsMin}–${exercise.repsMax}`}
              </Text>
            </View>
          ))}
        </View>
      ))}

      {/* What the composer could not fit or could not place. Listed, never
          hidden: a week that quietly dropped the lift you asked for is worse
          than one that says it could not find room. */}
      {proposal.unmetLifts.length ? (
        <Text style={styles.note}>
          {t(language, 'aiCompose.unmet', {
            lifts: proposal.unmetLifts.map((lift) => exerciseNameLabel(language, lift)).join(', '),
          })}
        </Text>
      ) : null}
      {proposal.unresolvedNames.length ? (
        <Text style={styles.note}>
          {t(language, 'aiCompose.unresolved', { names: proposal.unresolvedNames.join(', ') })}
        </Text>
      ) : null}
      {proposal.specialtyLeftOut?.length ? (
        <Text style={styles.note}>
          {t(language, 'aiCompose.specialtyLeftOut', {
            names: proposal.specialtyLeftOut.map((name) => exerciseNameLabel(language, name)).join(', '),
          })}
        </Text>
      ) : null}

      {/* No "compose again" here. The card lives in a conversation now, and
          asking again is what the conversation is for — a button that re-ran
          the same brief would produce the same week and say nothing. */}
      <View style={styles.actions}>
        <CutButton
          label={busy === 'saving' ? t(language, 'aiCompose.saving') : t(language, 'aiCompose.save')}
          variant={busy === 'idle' ? 'primary' : 'disabled'}
          onPress={onSave}
        />
      </View>

      <Text style={styles.source}>
        {t(language, proposal.source === 'live' ? 'aiCompose.source.live' : 'aiCompose.source.preview')}
      </Text>
    </CutSurface>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    // The surround is the caller's: the composer frames it as a panel, the
    // chat as a message. Only the contents live here.
    card: { padding: spacing.md, gap: 10 },
    readEyebrow: {
      color: theme.purple,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    readLine: { color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    title: {
      color: theme.ink,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '800',
      letterSpacing: -0.3,
      marginTop: 6,
    },
    session: { gap: 6, marginTop: 6 },
    sessionName: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    exerciseRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    exerciseName: { flex: 1, color: theme.ink, fontSize: 14, lineHeight: 19, fontWeight: '600' },
    exerciseScheme: { color: theme.muted, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    note: { color: theme.muted, fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 4 },
    actions: { gap: 10, marginTop: 8 },
    source: { color: theme.faint, fontSize: 11.5, lineHeight: 15, fontWeight: '600', marginTop: 2 },
  });
