import React, { useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CutSurface } from '../components/CutSurface';
import { ScreenHeaderTitle } from '../components/ScreenHeaderTitle';
import { CARD_SHADOW, SectionLabel } from '../components/SettingsUi';
import { SubscriptionSheet } from '../components/SubscriptionSheet';
import { formatDate } from '../lib/format';
import { t } from '../lib/i18n';
import { manageSubscriptionsUrl, paymentMethodsUrl, storePlatformOf, storeTextKey } from '../lib/storeLinks';

const STORE = storePlatformOf(Platform.OS);
import { PRO_LIVE_BENEFITS } from '../lib/proBenefits';
import { ProEntitlement } from '../lib/proEntitlement';
import {
  MOCK_BILLING,
  SUBSCRIPTION_TERMS,
  SUBSCRIPTION_TERM_ORDER,
  SubscriptionTermKey,
  resolveSubscriptionView,
  showsMockBilling,
} from '../lib/subscriptionView';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { AppLanguage } from '../types/models';

interface SubscriptionScreenProps {
  entitlement: ProEntitlement;
  /** A promoProUntil that has already passed — the only honest "lapsed" signal. */
  lapsedPromoUntil: string | null;
  mockTerm: SubscriptionTermKey;
  mockCancelled: boolean;
  /** When Pro was turned on, ISO. The renewal date is counted from it. */
  purchasedAt: string | null;
  onChangeMockTerm: (term: SubscriptionTermKey) => void;
  onChangeMockCancelled: (cancelled: boolean) => void;
  /** False in a real release: every invented billing row disappears. */
  demoBuild: boolean;
  /**
   * Asks the store for the reader's purchases. Absent when this build has no
   * store, and the Restore row then opens the store's subscription page.
   */
  onRestorePurchases?: () => Promise<void>;
  language?: AppLanguage;
  onBack: () => void;
  /** Opens the end-membership page. */
  onManageMembership: () => void;
  /** Opens the paywall — the one route to Pro, and the same one everyone uses. */
  onOpenPremium: () => void;
}

const ICONS: Record<string, string> = {
  shield: 'M12 3l8 3v6c0 4.5-3.4 7.5-8 9-4.6-1.5-8-4.5-8-9V6z',
  shieldCheck: 'M12 3l8 3v6c0 4.5-3.4 7.5-8 9-4.6-1.5-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-4.5',
  swap: 'M7 8h11l-3-3M17 16H6l3 3',
  external: 'M14 4h6v6M20 4l-9 9M18 13v6H5V6h6',
  list: 'M4 7h16M4 12h11M4 17h7',
  warn: 'M12 4L2.6 20h18.8zM12 10v4.5M12 17.6v.4',
  restore: 'M4 12a8 8 0 108-8M4 12V6M4 12h6',
  chevron: 'M9 6l6 6-6 6',
  card: 'M3 7h18v10H3zM3 11h18',
  wallet: 'M4 7h13a3 3 0 013 3v4a3 3 0 01-3 3H4zM16 12h2',
  receipt: 'M6 4h12v16l-3-2-3 2-3-2-3 2zM9 9h6M9 13h4',
  settings: 'M4 7h16M4 12h16M4 17h16M9 5v4M15 10v4M11 15v4',
  check: 'M5 13l4 4L19 7',
};

function Glyph({ name, color, size = 19 }: { name: string; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={ICONS[name] ?? ''}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Manage subscription (design: "Vinha Tilaus - hallinta").
 *
 * The rule this screen follows, from the design's own note: there is no price
 * list here. A price list on a management screen is half a paywall in the wrong
 * place — it sells without being able to close, and it duplicates the one page
 * that can. Everything that costs money routes to the paywall instead.
 *
 * Three states, and which one you see is decided by resolveSubscriptionView:
 *
 *   active  — Pro is on. The card describes it and the rows manage it.
 *   lapsed  — Pro was on and ran out. The card says the data is still here.
 *   none    — never subscribed. One route to Pro and two helper rows.
 *
 * `none` is not a dead state, which is worth writing down because it looks like
 * one: Home's PRO pill does send a free reader to the paywall rather than here
 * (HomeScreen). But Settings → Account → Subscription is an unconditional row,
 * so a reader who has never paid arrives from there — and that is exactly who
 * the old version showed a price list to.
 *
 * The billing rows (payment method, billing period, receipts) are invented; see
 * MOCK_BILLING. showsMockBilling gates them on the demo build, so clearing
 * extra.demoBuild takes them off the screen without anyone editing this file.
 */
export function SubscriptionScreen({
  entitlement,
  lapsedPromoUntil,
  mockTerm,
  mockCancelled,
  purchasedAt,
  onChangeMockTerm,
  onChangeMockCancelled,
  demoBuild,
  onRestorePurchases,
  language = 'en',
  onBack,
  onManageMembership,
  onOpenPremium,
}: SubscriptionScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Read here and handed to each sheet: inside their Modal it measures zero.
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<'subs' | 'membership'>('subs');
  const [sheet, setSheet] = useState<'term' | 'pay' | 'receipts' | 'includes' | null>(null);
  const [payMethod, setPayMethod] = useState<string>(MOCK_BILLING.defaultMethodId);
  const [termDraft, setTermDraft] = useState<SubscriptionTermKey>(mockTerm);
  // One store round-trip at a time: a second tap while the first is out is
  // ignored, as the Pro page ignores a second Buy.
  const restoring = useRef(false);
  const restore = onRestorePurchases
    ? async () => {
        if (restoring.current) {
          return;
        }
        restoring.current = true;
        try {
          await onRestorePurchases();
        } finally {
          restoring.current = false;
        }
      }
    : null;

  const model = resolveSubscriptionView({
    entitlement,
    mockTerm,
    mockCancelled,
    purchasedAt,
    lapsedPromoUntil,
  });
  const billing = showsMockBilling(model, demoBuild);
  const term = model.term ? SUBSCRIPTION_TERMS[model.term] : null;
  const lifetime = model.term === 'lifetime';
  const date = (iso: string | null) => (iso ? formatDate(iso, language) : '—');

  const goBack = () => {
    if (view === 'membership') {
      setView('subs');
      return;
    }
    onBack();
  };

  const openTermSheet = () => {
    setTermDraft(mockTerm);
    setSheet('term');
  };

  /** The status line under "Vinha Pro" — one sentence, five possible truths. */
  const statusLine = () => {
    if (model.state === 'lapsed') {
      return t(language, 'subs.status.lapsed', { date: date(model.endsAt) });
    }
    if (model.state === 'none') {
      return t(language, 'subs.none');
    }
    if (model.grant === 'promo') {
      return t(language, 'subs.status.promo', { date: date(model.endsAt) });
    }
    if (model.grant === 'trial') {
      return t(language, 'subs.status.trial', { date: date(model.endsAt) });
    }
    if (model.cancelled) {
      return t(language, 'subs.status.cancelled', { date: date(model.endsAt) });
    }
    return t(language, 'subs.status.activeOn', { term: t(language, term!.labelKey) });
  };

  const statusAccent =
    model.state !== 'active' ? theme.faint : model.cancelled ? theme.amber : theme.green;
  const statusTile =
    model.state !== 'active'
      ? theme.surfaceSoft
      : model.cancelled
        ? theme.amberSoft
        : theme.greenSoft;

  const MetaRow = ({
    label,
    value,
    valueColor,
    onPress,
    last,
  }: {
    label: string;
    value: string;
    valueColor?: string;
    onPress?: () => void;
    last?: boolean;
  }) => (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.metaRow,
        !last && styles.metaRowDivider,
        pressed && onPress ? { opacity: 0.7 } : null,
      ]}
    >
      <Text style={styles.metaKey}>{label}</Text>
      <View style={styles.metaValueRow}>
        <Text style={[styles.metaValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
        {onPress ? <Glyph name="chevron" color={theme.faint} size={15} /> : null}
      </View>
    </Pressable>
  );

  /**
   * The facts under the status line, as a list so the last one closes the
   * card whatever was left out.
   *
   * And things are left out. The card, the charge amount and the join date
   * are MOCK_BILLING, and outside a demo build (`billing`) none of them may
   * appear, whatever Pro runs on. They used to be drawn in every build with
   * only their tap gated, so a release would have shown a Visa ending 4242 to
   * a reader who can look in Google Play and find none. What stays is known:
   * when a grant or a cancelled term ends, and that nothing is scheduled.
   */
  const metaRows = () => {
    type Meta = { key: string; label: string; value: string; valueColor?: string; onPress?: () => void };
    const proEnds: Meta = {
      key: 'ends',
      label: t(language, 'subs.meta.proEnds'),
      value: date(model.endsAt),
      valueColor: statusAccent,
    };
    const nothingScheduled: Meta = {
      key: 'charge',
      label: t(language, 'subs.meta.nextCharge'),
      value: t(language, 'subs.meta.nextChargeNone'),
    };
    const method: Meta[] = billing
      ? [
          {
            key: 'method',
            label: t(language, 'subs.meta.method'),
            value: t(language, storeTextKey(MOCK_BILLING.methods[0].titleKey, STORE)),
            onPress: () => setSheet('pay'),
          },
        ]
      : [];

    if (model.grant) {
      return [proEnds, nothingScheduled];
    }
    if (model.cancelled) {
      return [proEnds, { ...nothingScheduled, valueColor: statusAccent }, ...method];
    }
    if (lifetime) {
      const paid: Meta[] = billing
        ? [
            {
              key: 'paid',
              label: t(language, 'subs.meta.paid'),
              value: t(language, 'subs.meta.paidValue', {
                date: date(MOCK_BILLING.lastChargedAt),
                price: t(language, term!.priceKey),
              }),
            },
          ]
        : [];
      return [
        { key: 'charge', label: t(language, 'subs.meta.nextCharge'), value: t(language, 'subs.meta.noRenewal') },
        ...paid,
        ...method,
      ];
    }
    // A renewing store subscription: the date is counted from the store's
    // own period start (lib/storePurchase), and the price is the plan's. No
    // tap behind it — a plan change is made in the store.
    if (!billing) {
      return [
        {
          key: 'charge',
          label: t(language, 'subs.meta.nextCharge'),
          value: t(language, 'subs.meta.nextChargeValue', {
            date: date(model.nextChargeAt),
            price: t(language, term!.priceKey),
          }),
        },
      ];
    }
    return [
      {
        key: 'charge',
        label: t(language, 'subs.meta.nextCharge'),
        value: t(language, 'subs.meta.nextChargeValue', {
          date: date(model.nextChargeAt),
          price: t(language, term!.priceKey),
        }),
        onPress: openTermSheet,
      },
      ...method,
      {
        key: 'since',
        label: t(language, 'subs.meta.memberSince'),
        value: t(language, 'subs.meta.memberSinceValue', { date: date(MOCK_BILLING.memberSince) }),
      },
    ];
  };

  const Row = ({
    icon,
    title,
    sub,
    onPress,
    danger,
    divider,
  }: {
    icon: string;
    title: string;
    sub?: string;
    onPress?: () => void;
    danger?: boolean;
    divider?: boolean;
  }) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider && styles.rowDivider,
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={[styles.rowTile, danger && { backgroundColor: theme.dangerSoft }]}>
        <Glyph name={icon} color={danger ? theme.danger : theme.purple} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, danger && { color: theme.danger }]}>{title}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Glyph name="chevron" color={theme.faint} size={16} />
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.back')}
          onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.75 }]}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 5l-7 7 7 7"
              stroke={theme.ink}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
        <ScreenHeaderTitle
          title={t(language, view === 'membership' ? 'subs.header.membership' : 'subs.header.subs')}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {view === 'membership' ? (
          <>
            {billing ? (
              <>
                <SectionLabel label={t(language, 'subs.section.paying')} />
                <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
                  <Row
                    icon="card"
                    title={t(language, 'subs.row.changeMethod')}
                    sub={t(language, storeTextKey(MOCK_BILLING.methods[0].titleKey, STORE))}
                    onPress={() => setSheet('pay')}
                    divider
                  />
                  <Row
                    icon="swap"
                    title={t(language, 'subs.row.changeTerm')}
                    sub={t(language, 'subs.row.changeTermSub', {
                      name: t(language, term!.nameKey),
                      price: t(language, term!.priceKey),
                      per: t(language, term!.perKey),
                    })}
                    onPress={openTermSheet}
                    divider
                  />
                  <Row
                    icon="receipt"
                    title={t(language, 'subs.row.receipts')}
                    sub={t(language, 'subs.row.receiptsSub')}
                    onPress={() => setSheet('receipts')}
                  />
                </CutSurface>
              </>
            ) : null}

            <SectionLabel label={t(language, 'subs.section.membership')} />
            {lifetime ? (
              <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={[styles.card, styles.notePad]}>
                <Text style={styles.noteTitle}>{t(language, 'subs.lifetime.title')}</Text>
                <Text style={styles.noteBody}>{t(language, 'subs.lifetime.body')}</Text>
              </CutSurface>
            ) : model.grant ? (
              <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={[styles.card, styles.notePad]}>
                <Text style={styles.noteBody}>
                  {model.grant === 'trial'
                    ? t(language, 'subs.trialNote', { date: date(model.endsAt) })
                    : t(language, 'subs.promoNote')}
                </Text>
              </CutSurface>
            ) : lifetime ? null : model.cancelled ? (
              <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
                <Row
                  icon="restore"
                  title={t(language, 'subs.row.resume')}
                  sub={t(language, 'subs.row.resumeSub', { date: date(model.endsAt) })}
                  onPress={() => onChangeMockCancelled(false)}
                />
              </CutSurface>
            ) : (
              <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
                <Row
                  icon="warn"
                  title={t(language, 'subs.row.end')}
                  sub={t(language, 'subs.row.endSub', { date: date(model.endsAt) })}
                  onPress={onManageMembership}
                  danger
                />
              </CutSurface>
            )}

            {/* The promo or trial card above already says there is nothing to
                manage. Repeating it as a footer put the same sentence twice on
                an otherwise empty page. */}
            {model.grant ? null : (
              <Text style={styles.footer}>
                {t(language, lifetime ? 'subs.foot.lifetime' : storeTextKey('subs.foot.play', STORE))}
              </Text>
            )}
          </>
        ) : (
          <>
            {/* status */}
            <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={[styles.card, styles.statusCard]}>
              <View style={styles.statusTopRow}>
                <View style={[styles.shieldTile, { backgroundColor: statusTile }]}>
                  <Glyph
                    name={model.state === 'active' && !model.cancelled ? 'shieldCheck' : 'shield'}
                    color={statusAccent}
                    size={22}
                  />
                </View>
                <View style={styles.statusCopy}>
                  <Text style={styles.statusName}>Vinha Pro</Text>
                  <Text style={[styles.statusSub, { color: statusAccent }]}>{statusLine()}</Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: statusAccent }]} />
              </View>

              <View style={styles.divider} />

              {model.state !== 'active' ? (
                <Text style={styles.freeNote}>
                  {t(language, model.state === 'lapsed' ? 'subs.lapsedNote' : 'subs.noneNote')}
                </Text>
              ) : (
                <>
                  {metaRows().map((row, index, rows) => (
                    <MetaRow
                      key={row.key}
                      label={row.label}
                      value={row.value}
                      valueColor={row.valueColor}
                      onPress={row.onPress}
                      last={index === rows.length - 1}
                    />
                  ))}
                  {model.cancelled ? (
                    <View style={styles.warnBanner}>
                      <Glyph name="warn" color={theme.amberInk} size={16} />
                      <Text style={styles.warnText}>{t(language, 'subs.cancelledNote')}</Text>
                    </View>
                  ) : null}
                </>
              )}
            </CutSurface>

            {model.state === 'active' ? (
              <>
                <SectionLabel label={t(language, 'subs.section.yours')} />
                <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
                  {model.cancelled && billing ? (
                    <Row
                      icon="restore"
                      title={t(language, 'subs.row.resume')}
                      sub={t(language, 'subs.row.resumeSub', { date: date(model.endsAt) })}
                      onPress={() => onChangeMockCancelled(false)}
                      divider
                    />
                  ) : null}
                  {/* Shown for a promo too (user decision 2026-08-18). The
                      page behind it is not empty — it states that a promo has
                      nothing to manage and runs out on its own, which is the
                      answer someone opening this row came for. The subtitle
                      changes with it, because a promo has no payment method,
                      no billing period and no receipts to name. */}
                  <Row
                    icon="settings"
                    title={t(language, 'subs.row.manageMembership')}
                    sub={t(
                      language,
                      model.grant === 'promo'
                        ? 'subs.row.manageMembershipSubPromo'
                        : model.grant === 'trial'
                          ? 'subs.row.manageMembershipSubTrial'
                          : 'subs.row.manageMembershipSub',
                    )}
                    onPress={() => setView('membership')}
                    divider
                  />
                  <Row
                    icon="list"
                    title={t(language, 'subs.row.whatsIn')}
                    sub={t(language, 'subs.row.whatsInSub')}
                    onPress={() => setSheet('includes')}
                    divider
                  />
                  <Row
                    icon="external"
                    title={t(language, storeTextKey('subs.row.play', STORE))}
                    sub={t(language, storeTextKey('subs.row.playSub', STORE))}
                    onPress={() =>
                      void Linking.openURL(manageSubscriptionsUrl(STORE))
                    }
                  />
                </CutSurface>
              </>
            ) : (
              <>
                <SectionLabel label={t(language, 'subs.section.pro')} />
                <Pressable
                  accessibilityRole="button"
                  onPress={onOpenPremium}
                  style={({ pressed }) => [styles.proCard, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.proTitle}>
                    {t(
                      language,
                      model.state === 'lapsed' ? 'subs.cta.resumeTitle' : 'subs.cta.exploreTitle',
                    )}
                  </Text>
                  <Text style={styles.proBody}>{t(language, 'subs.cta.body')}</Text>
                  <View style={styles.proCta}>
                    <Text style={styles.proCtaText}>{t(language, 'subs.cta.seePro')}</Text>
                  </View>
                </Pressable>

                <SectionLabel label={t(language, 'subs.section.other')} />
                <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
                  <Row
                    icon="restore"
                    title={t(language, 'subs.row.restore')}
                    sub={t(language, 'subs.row.restoreSub')}
                    onPress={
                      restore ? () => void restore() : () => void Linking.openURL(manageSubscriptionsUrl(STORE))
                    }
                    divider
                  />
                  <Row
                    icon="external"
                    title={t(language, storeTextKey('subs.row.play', STORE))}
                    sub={t(language, storeTextKey('subs.row.playSub', STORE))}
                    onPress={() =>
                      void Linking.openURL(manageSubscriptionsUrl(STORE))
                    }
                  />
                </CutSurface>
              </>
            )}

            <Text style={styles.footer}>
              {t(
                language,
                model.state === 'active' && model.grant === 'promo'
                  ? 'subs.foot.promo'
                  : model.state === 'active' && model.grant === 'trial'
                    ? 'subs.foot.trial'
                    : lifetime
                    ? 'subs.foot.lifetime'
                    : storeTextKey('subs.foot.play', STORE),
              )}
            </Text>
          </>
        )}
      </ScrollView>

      {/* ── change billing period ── */}
      <SubscriptionSheet
        visible={sheet === 'term'}
        title={t(language, 'subs.term.title')}
        bottomInset={insets.bottom}
        onClose={() => setSheet(null)}
      >
        <View style={styles.sheetList}>
          {SUBSCRIPTION_TERM_ORDER.map((key) => {
            const option = SUBSCRIPTION_TERMS[key];
            const picked = termDraft === key;
            const current = mockTerm === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() => setTermDraft(key)}
                style={[styles.optionRow, picked && styles.optionRowPicked]}
              >
                <View style={styles.optionCopy}>
                  <View style={styles.optionNameRow}>
                    <Text style={styles.optionName}>{t(language, option.nameKey)}</Text>
                    {current ? (
                      <View style={styles.currentBadge}>
                        <Text style={styles.currentBadgeText}>{t(language, 'subs.term.current')}</Text>
                      </View>
                    ) : null}
                    {option.badgeKey && !current ? (
                      <View style={styles.saveBadge}>
                        <Text style={styles.saveBadgeText}>{t(language, option.badgeKey)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.optionPrice}>
                    {t(language, option.priceKey)}{' '}
                    <Text style={styles.optionPer}>{t(language, option.perKey)}</Text>
                  </Text>
                </View>
                {picked ? (
                  <View style={styles.checkCircle}>
                    <Glyph name="check" color={theme.onHighlight} size={15} />
                  </View>
                ) : (
                  <View style={styles.emptyCircle} />
                )}
              </Pressable>
            );
          })}
        </View>
        {/* Only when a different period is picked, where it says when the
            change lands. "This is your current billing period" under a list
            with a NYKYINEN badge said it twice (#bugs 2026-09-23). */}
        {termDraft !== mockTerm ? (
          <Text style={styles.sheetNote}>{t(language, SUBSCRIPTION_TERMS[termDraft].noteKey)}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (termDraft !== mockTerm) {
              onChangeMockTerm(termDraft);
            }
            setSheet(null);
          }}
          style={({ pressed }) => [
            styles.sheetCta,
            termDraft === mockTerm && styles.sheetCtaQuiet,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text
            style={[styles.sheetCtaText, termDraft === mockTerm && styles.sheetCtaTextQuiet]}
          >
            {t(
              language,
              termDraft === mockTerm ? 'subs.term.close' : SUBSCRIPTION_TERMS[termDraft].ctaKey,
            )}
          </Text>
        </Pressable>
      </SubscriptionSheet>

      {/* ── payment method ── */}
      <SubscriptionSheet
        visible={sheet === 'pay'}
        title={t(language, 'subs.pay.title')}
        bottomInset={insets.bottom}
        onClose={() => setSheet(null)}
      >
        <View style={styles.sheetList}>
          {MOCK_BILLING.methods.map((method) => {
            const picked = payMethod === method.id;
            return (
              <Pressable
                key={method.id}
                accessibilityRole="button"
                onPress={() => setPayMethod(method.id)}
                style={[styles.optionRow, picked && styles.optionRowPicked]}
              >
                <View style={styles.methodTile}>
                  <Glyph name={method.icon} color={theme.purple} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionName}>{t(language, storeTextKey(method.titleKey, STORE))}</Text>
                  <Text style={styles.optionPrice}>{t(language, method.subKey)}</Text>
                </View>
                {picked ? (
                  <View style={styles.checkCircle}>
                    <Glyph name="check" color={theme.onHighlight} size={15} />
                  </View>
                ) : (
                  <View style={styles.emptyCircle} />
                )}
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void Linking.openURL(paymentMethodsUrl(STORE))
            }
            style={({ pressed }) => [styles.addMethodRow, pressed && { opacity: 0.75 }]}
          >
            <View style={styles.methodTileQuiet}>
              <Glyph name="card" color={theme.faint} />
            </View>
            <Text style={styles.addMethodText}>{t(language, 'subs.pay.add')}</Text>
            <Glyph name="external" color={theme.faint} size={16} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSheet(null)}
          style={({ pressed }) => [styles.sheetCta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.sheetCtaText}>{t(language, 'subs.pay.save')}</Text>
        </Pressable>
      </SubscriptionSheet>

      {/* ── past payments ── */}
      <SubscriptionSheet
        visible={sheet === 'receipts'}
        title={t(language, 'subs.receipts.title')}
        sub={t(language, storeTextKey('subs.receipts.sub', STORE))}
        bottomInset={insets.bottom}
        onClose={() => setSheet(null)}
      >
        <View style={styles.receiptCard}>
          {(MOCK_BILLING.receipts[mockTerm] ?? []).map((receipt, index) => (
            <View
              key={receipt.paidAt}
              style={[styles.receiptRow, index > 0 && styles.receiptRowDivider]}
            >
              <View style={styles.methodTile}>
                <Glyph name="receipt" color={theme.purple} size={17} />
              </View>
              <View style={styles.optionCopy}>
                <Text style={styles.receiptDate}>{date(receipt.paidAt)}</Text>
                <Text style={styles.optionPrice}>
                  {t(language, 'subs.receipts.line', {
                    term: t(language, SUBSCRIPTION_TERMS[receipt.termKey].labelKey),
                  })}
                </Text>
              </View>
              <Text style={styles.receiptAmount}>{t(language, receipt.priceKey)}</Text>
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSheet(null)}
          style={({ pressed }) => [styles.sheetCtaQuietOnly, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.sheetCtaTextQuiet}>{t(language, 'subs.receipts.close')}</Text>
        </Pressable>
      </SubscriptionSheet>

      {/* ── what Pro includes ──
          The design left this row without a destination. It gets one from
          PRO_LIVE_BENEFITS, which is the same list the end-membership page
          strikes through — so what Pro is said to include and what it is said
          to take away cannot drift apart. */}
      <SubscriptionSheet
        visible={sheet === 'includes'}
        title={t(language, 'subs.row.whatsIn')}
        sub={t(language, 'subs.row.whatsInSub')}
        bottomInset={insets.bottom}
        onClose={() => setSheet(null)}
      >
        <View style={styles.receiptCard}>
          {PRO_LIVE_BENEFITS.map((benefit, index) => (
            <View
              key={benefit.titleKey}
              style={[styles.receiptRow, index > 0 && styles.receiptRowDivider]}
            >
              <View style={styles.checkTile}>
                <Glyph name="check" color={theme.greenInk} size={14} />
              </View>
              <Text style={styles.includeTitle}>{t(language, benefit.titleKey)}</Text>
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSheet(null)}
          style={({ pressed }) => [styles.sheetCtaQuietOnly, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.sheetCtaTextQuiet}>{t(language, 'subs.receipts.close')}</Text>
        </Pressable>
      </SubscriptionSheet>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: {
      paddingTop: 4,
      paddingHorizontal: 18,
      paddingBottom: layout.bottomTabBarReserve,
    },
    // Shape, fill and border belong to CutSurface now; the shadow is the
    // only thing the wrapper still carries.
    card: {
      ...CARD_SHADOW,
    },
    statusCard: {
      padding: 16,
      marginTop: 4,
    },
    statusTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
    },
    shieldTile: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusCopy: {
      flex: 1,
      minWidth: 0,
    },
    statusName: {
      color: theme.ink,
      fontSize: 17.5,
      fontWeight: '800',
      letterSpacing: -0.35,
    },
    statusSub: {
      fontSize: 12.5,
      fontWeight: '700',
      marginTop: 3,
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    divider: {
      height: 1,
      backgroundColor: theme.border,
      marginTop: 14,
      marginBottom: 2,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 11,
    },
    metaRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    metaKey: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '600',
    },
    metaValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 1,
    },
    metaValue: {
      color: theme.ink,
      fontSize: 13,
      fontWeight: '800',
      textAlign: 'right',
    },
    warnBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
      backgroundColor: theme.amberSoft,
      borderWidth: 1,
      borderColor: theme.amberBorder,
      borderRadius: 13,
      paddingVertical: 11,
      paddingHorizontal: 12,
      marginTop: 12,
    },
    warnText: {
      flex: 1,
      color: theme.amberInk,
      fontSize: 12.5,
      fontWeight: '700',
      lineHeight: 18,
    },
    freeNote: {
      color: theme.muted,
      fontSize: 12.5,
      fontWeight: '600',
      lineHeight: 19,
      marginTop: 12,
    },
    notePad: {
      paddingVertical: 15,
      paddingHorizontal: 16,
    },
    noteTitle: {
      color: theme.ink,
      fontSize: 14.5,
      fontWeight: '800',
    },
    noteBody: {
      color: theme.muted,
      fontSize: 12.5,
      fontWeight: '600',
      lineHeight: 19,
      marginTop: 5,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingVertical: 14,
      paddingHorizontal: 15,
    },
    rowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    rowTile: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: theme.purpleSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: theme.ink,
      fontSize: 14.5,
      fontWeight: '800',
      letterSpacing: -0.15,
    },
    rowSub: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17,
      marginTop: 2,
    },
    proCard: {
      backgroundColor: theme.purpleSoft,
      borderWidth: 1,
      borderColor: theme.purpleLight,
      borderRadius: 20,
      padding: 16,
    },
    proTitle: {
      color: theme.ink,
      fontSize: 16,
      fontWeight: '800',
      letterSpacing: -0.32,
    },
    proBody: {
      color: theme.muted,
      fontSize: 12.5,
      fontWeight: '600',
      lineHeight: 19,
      marginTop: 6,
    },
    proCta: {
      height: 48,
      borderRadius: 14,
      backgroundColor: theme.purple,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 13,
    },
    proCtaText: {
      color: theme.onHighlight,
      fontSize: 15.5,
      fontWeight: '800',
    },
    footer: {
      color: theme.faint,
      fontSize: 11.5,
      fontWeight: '600',
      textAlign: 'center',
      lineHeight: 18,
      marginTop: 20,
      paddingHorizontal: 6,
    },
    sheetList: {
      gap: 9,
      marginTop: 15,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    optionRowPicked: {
      backgroundColor: theme.purpleSoft,
      borderColor: theme.purple,
    },
    optionCopy: {
      flex: 1,
      minWidth: 0,
    },
    optionNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      flexWrap: 'wrap',
    },
    optionName: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '800',
    },
    optionPrice: {
      color: theme.muted,
      fontSize: 12.5,
      fontWeight: '700',
      marginTop: 4,
    },
    optionPer: {
      color: theme.faint,
      fontWeight: '600',
    },
    currentBadge: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 5,
      paddingVertical: 2,
      paddingHorizontal: 6,
    },
    currentBadgeText: {
      color: theme.faint,
      fontSize: 9.5,
      fontWeight: '800',
      letterSpacing: 0.85,
    },
    saveBadge: {
      backgroundColor: theme.gold,
      borderRadius: 5,
      paddingVertical: 2,
      paddingHorizontal: 6,
    },
    saveBadgeText: {
      color: '#241743',
      fontSize: 9.5,
      fontWeight: '800',
      letterSpacing: 0.85,
    },
    checkCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: theme.purple,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    methodTile: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    methodTileQuiet: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: theme.surfaceSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkTile: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: theme.greenSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    includeTitle: {
      flex: 1,
      color: theme.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    addMethodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderRadius: 16,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: theme.border,
    },
    addMethodText: {
      flex: 1,
      color: theme.muted,
      fontSize: 14.5,
      fontWeight: '800',
    },
    sheetNote: {
      color: theme.muted,
      fontSize: 12.5,
      fontWeight: '600',
      lineHeight: 19,
      marginTop: 12,
    },
    sheetCta: {
      height: 52,
      borderRadius: 16,
      backgroundColor: theme.purple,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
    },
    sheetCtaQuiet: {
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1,
      borderColor: theme.border,
    },
    sheetCtaQuietOnly: {
      height: 50,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
    },
    sheetCtaText: {
      color: theme.onHighlight,
      fontSize: 16,
      fontWeight: '800',
    },
    sheetCtaTextQuiet: {
      color: theme.muted,
      fontSize: 15.5,
      fontWeight: '800',
    },
    receiptCard: {
      backgroundColor: theme.surfaceSoft,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 16,
      overflow: 'hidden',
      marginTop: 15,
    },
    receiptRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      paddingHorizontal: 14,
    },
    receiptRowDivider: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    receiptDate: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
    },
    receiptAmount: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
    },
  });
