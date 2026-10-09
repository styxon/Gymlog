import { AppLanguage } from '../types/models';
import type { StorePlatform } from './storeLinks';

/**
 * The privacy policy and terms, as data.
 *
 * Two rules govern this file:
 *
 * 1. Every factual claim here is checked against the code. The app has exactly
 *    three outbound request sites — src/lib/aiCoachClient.ts (the coach, the
 *    programme composer and the photo import, only when
 *    EXPO_PUBLIC_AI_COACH_API_URL is set), src/features/account/backupApi.ts
 *    (the optional cloud backup, keyed by Google sign-in) and
 *    src/features/analytics/analyticsClient.ts (anonymous usage events) — and
 *    no analytics or ad SDKs. If any of that changes, this file changes in the
 *    same commit; tests/lib/legalDocuments.test.cjs fails otherwise. The
 *    online-coach notice in i18n.ts (coachChat.online.body) is held to the
 *    same standard by the same test: what App.tsx hands
 *    buildAiTrainingContext, the reader is told about.
 *
 * 2. The prose lives here rather than in i18n.ts on purpose. These are ~150
 *    paragraph-length strings that are read as whole documents, never
 *    interpolated, and must be diffable as documents when the policy is
 *    revised. Splitting them into flat keys would make a legal change
 *    unreviewable.
 *
 * The writing rule, from the 2026-09-04 rewrite: a reader who is not a
 * developer has to be able to follow every sentence. No storage keys, no
 * endpoints, no tokens, no SDKs — say what happens, where it goes, and how to
 * stop it. The two languages are kept structurally parallel (same sections,
 * same paragraph and bullet counts) so a clause cannot exist in one only.
 *
 * scripts/export-legal.cjs renders the same data to Markdown for hosting, so
 * the published policy and the in-app policy cannot drift.
 *
 * 3. Which store, which backup, which platform's settings: a reader on an
 *    iPhone is not told about Google Play or Android's backup, and a reader on
 *    Android is not told about the App Store. The app asks for its own
 *    platform (LegalDocumentScreen passes Platform.OS); the published
 *    Markdown is for both and names both stores ("both"). Every wording that
 *    differs lives in one place, next to the others it differs from, picked
 *    with `pick` — never as a second copy of a paragraph — and
 *    tests/lib/legalDocuments.test.cjs holds each platform's document to
 *    saying nothing about the other's store.
 */

/**
 * The one place the publisher's identity is defined. Change it here and the
 * app, the exported Markdown and the Play Console listing all agree.
 *
 * Styxon Studio is a sole trader's trade name (toiminimi), not a company: in
 * law the controller is still the individual who holds it, so the documents
 * name both, with the business ID. If this ever becomes an Oy, the controller
 * changes — switch `name`, drop `holder`, new `businessId`, bump
 * LEGAL_LAST_UPDATED; users are entitled to see that change.
 *
 * `email` is the address for the documents (data requests, complaints);
 * `supportEmail` is where Send feedback drafts go. Both are aliases of the
 * same Workspace inbox, filtered apart there.
 */
export const LEGAL_ENTITY = {
  name: 'Styxon Studio',
  /** The individual behind the trade name — the controller in law. */
  holder: 'Santeri Ylönen',
  /** Y-tunnus. */
  businessId: '3321575-3',
  email: 'privacy@vinha.app',
  supportEmail: 'support@vinha.app',
  country: 'Finland',
  countryFi: 'Suomi',
} as const;

/** "Styxon Studio (sole trader …, business ID …, Finland)" in the reader's language. */
function publisher(language: AppLanguage): string {
  const { name, holder, businessId, country, countryFi } = LEGAL_ENTITY;
  return language === 'fi'
    ? `${name} (toiminimi, haltija ${holder}, Y-tunnus ${businessId}, ${countryFi})`
    : `${name} (sole trader ${holder}, business ID ${businessId}, ${country})`;
}

/**
 * The day the wording last changed, as the documents and the consent sheet
 * show it. A real date, never ahead of the calendar (tests/lib/legalDocuments
 * holds it there).
 */
export const LEGAL_LAST_UPDATED = '2026-10-09';

/**
 * What an acceptance is stored against: a string that only ever grows, so a
 * phone that accepted an earlier wording is asked again (legalAcceptance).
 *
 * It used to be the date above. But two changes on one day must both be asked
 * about, and a date cannot grow twice in a day, so it was bumped a day ahead
 * each time — four changes on 2–3 October put it at 6 October, and on the 5th
 * the sheet told readers the terms "changed on 6.10.2026" (bug hunt,
 * 2026-10-05). Lowering it would stop asking the phones that accepted the
 * older wordings, so it stays, and the date shown is its own constant now.
 *
 * A new wording: LEGAL_LAST_UPDATED becomes the day it ships, and this
 * becomes that day too — or, while that is not past the current value, the
 * current value with a suffix ('2026-10-06.1', '.2', …), which still compares
 * as later.
 */
export const LEGAL_VERSION = '2026-10-09';

export type LegalDocumentId = 'privacy' | 'terms';

/**
 * Whose phone is reading. The app passes its own; the published documents are
 * 'both', which names Google Play and the App Store side by side.
 */
export type LegalPlatform = StorePlatform | 'both';

/** One wording per audience. The three are written together so they stay the same claim. */
function pick(platform: LegalPlatform, words: { android: string; ios: string; both: string }): string {
  return words[platform];
}

export interface LegalSection {
  heading: string;
  /** Paragraphs, rendered in order. */
  body?: string[];
  /** Bulleted lines, rendered after the paragraphs. */
  bullets?: string[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  /** One sentence under the title: what this document is for. */
  summary: string;
  updatedLabel: string;
  sections: LegalSection[];
}

const privacyEn = (p: LegalPlatform): LegalSection[] => [
  {
    heading: 'The short version',
    body: [
      'Vinha stores your training data on your phone. This policy lists what the app sends to our server, when, and why.',
      'At present that is four things. The optional cloud backup is sent when you sign in with Google or Apple, and the AI coach’s online mode when you read a notice and then send a question, ask for a programme, or import one from a photo. Anonymous usage statistics are sent by the app itself unless you switch them off in Settings — they carry no content and no identity, and they are described in full below. Each of these requests also carries the app’s version number and whether the phone runs Android or iOS, so our server can recognise an app too old to understand and ask you to update it.',
      'The fourth is a check the app makes by itself: when it starts, and again when you come back to it after some hours, it asks our server whether there is a notice for everyone who uses Vinha — for example about a break in service or a security incident — and shows it once. That request carries nothing but the app’s version and platform; like any request, it shows our server the phone’s internet address, and nothing about it is stored.',
      'No ads, no trackers, no selling of data. If something in this policy is unclear, write to us — the address is in the next section.',
    ],
  },
  {
    heading: 'Who is responsible',
    body: [
      `${publisher('en')} publishes Vinha Fitness (“Vinha”) and is the data controller — the one responsible for how your data is handled — for everything described in this policy.`,
      `Questions about this policy or your data: ${LEGAL_ENTITY.email}.`,
    ],
  },
  {
    heading: 'What the app stores on your phone',
    body: [
      'Everything below is either entered by you or worked out by the app from what you entered. It is kept in the app’s own storage on your phone.',
    ],
    bullets: [
      'Your profile from setup: gender, age, height, weight, goals, experience level, days per week, equipment, the areas you want to focus on, and any injuries or limitations you ticked.',
      'Your training log: workouts and cardio sessions with their exercises, sets, reps, weights, notes, dates, durations and how the session felt.',
      'Body data you add yourself: weight entries and tape measurements.',
      'Your programmes: the ones you build, import from a CSV file or a photo, and the exercise names you teach the app.',
      'Goals you set with the coach, and the milestones and seasons the app counts from your log.',
      'What the coach has advised you in the last three weeks: the one-sentence summary of each answer and the date it was given, at most ten of them. It is kept so the coach does not repeat advice you have already had, it is deleted as it ages past three weeks, and it stays on this phone — the cloud backup below does not carry it.',
      'Preferences: language, units, theme, notification and sound settings, default rest time, training breaks.',
      'Pro status: whether Pro is on, when it was bought or cancelled, and the dates until which a promo code or a free trial keeps it on.',
      'Small bookkeeping: whether the rating prompt or the online-coach notice has been shown, the summary file the home-screen widget reads, the queue of usage events waiting to be sent, a marker that the coach’s advice memory still needs erasing after a restore if a first attempt could not reach the disk, a copy of a damaged data file if the app ever finds one, and your workout in progress with the numbers remembered from earlier workouts if the app keeps crashing and you choose to put them aside — these are set aside rather than deleted, so a broken file is not a lost training log.',
    ],
  },
  ...(p !== 'ios'
    ? [
        {
          heading: 'Android backup',
          body: [
            'Android’s own backup is switched off for this app. Your phone does not copy Vinha’s data into your Google account’s backup, and it does not hand it to a new phone during the device-to-device transfer at setup. Nothing of your training log leaves the phone that way.',
            'That means a new phone starts empty unless you use the cloud backup below, or export your log as CSV first. It is off so that the app’s own backup below, which you switch on yourself, is the only place your full training log is kept outside this phone.',
          ],
        },
      ]
    : []),
  ...(p !== 'android'
    ? [
        {
          heading: 'iPhone backup',
          body: [
            'On iPhone the app’s data is not left out of the phone’s own backup. If iCloud Backup is switched on, or you back the phone up to a computer, Vinha’s data goes into that backup together with the data of your other apps, and comes back with it when you set up a phone from it. That backup is made and kept by Apple or on your own computer, under Apple’s terms. We do not make it, cannot see it and cannot delete it.',
            'If you would rather Vinha’s training log is not in it, you can leave Vinha out of an iCloud backup in your iPhone’s iCloud settings, or switch iCloud Backup off. The cloud backup below is separate: it is the only copy of your training log that we hold.',
          ],
        },
      ]
    : []),
  {
    heading: 'Cloud backup (optional)',
    body: [
      'If you sign in with Google or Apple, a copy of everything listed under “What the app stores on your phone” — except a workout still in progress — is sent over an encrypted connection to our server and kept there, so a new phone can restore it after you sign in again. Signing in is never required; every feature works without it.',
      'From Google we receive your Google account’s identifier, your email address and your name. These stay on your phone, so the app can show which account is signed in. On the server the backup is filed under a scrambled version of the identifier; your email and name are not stored there. When you sign out, the phone keeps only the identifiers of the accounts that signed out of it, so that if a different Google account signs in next, the app asks before backing up the data already on the phone to it; they are removed once that sign-in is settled.',
      'On iPhone you can sign in with Apple instead. From Apple we receive an identifier for your Apple ID that only Vinha gets, and the first time only, the name and email you choose to share — the email can be a private relay address that Apple forwards. They stay on your phone like Google’s. The phone trades Apple’s sign-in once for a sign-in of our own, kept on the phone, that lasts up to 180 days and is checked on every backup request; before using it, the phone asks Apple whether you have stopped using your Apple ID with Vinha, and signs you out if you have. Deleting your account (below) does not take Vinha off the list of apps you use Sign in with Apple with; you can remove it there yourself, in your iPhone’s Apple ID settings.',
      'A backup is sent shortly after you log training, and whenever you press Back up now. The server checks your sign-in on every request, stores the file, and hands it back only to the same account. It does not read, analyse or log the contents.',
      'The backup is stored by Vercel, our hosting provider, in the European Union. It is kept until you delete it.',
      'Settings → Delete cloud backup removes the server copy immediately. Signing out does not delete it, and neither does resetting the phone’s data — a reset signs you out first, precisely so that an empty backup never overwrites a full one. The copy waits until you sign in again. If you can no longer open the app, delete a Google account without it at styxon.fi/vinha-fitness/legal/delete-account.en: you sign in with Google on that page, and it deletes the server copy as Delete account does. The coach copies described below are filed under your phone, not your account, so that page cannot reach them; they are deleted automatically within 24 months. You can also sign in on any phone with the same account and delete it there.',
      'Settings → Delete account does the same and more: it deletes the server copy, signs you out on this phone, asks our server to delete any copies the AI coach kept for you (only if you had allowed that, as described under “The AI coach”), and ends the sign-in our own server gave an Apple account: your other phones signed in with Apple are signed out at their next request to our server, and a sign-in made with Apple before the deletion can no longer be used to start a new one. The training data on this phone stays; Reset all data clears that separately. The anonymous usage statistics are not tied to your account, so deleting it does not delete them; they are kept for up to 24 months, as described under “Usage statistics”. Apart from those, our server holds nothing of yours afterwards except, for an Apple account, one scrambled marker with a date, which says that sign-ins made before it have ended, so that an old sign-in cannot be used again. It also holds a random number your phone made for that request, used only to tell that phone its deletion went through. It holds no name, email or training data.',
      'Settings → Reset all data deletes everything on this phone and signs you out. It keeps the cloud backup, which waits for you as described above, and it keeps your answer about usage statistics: if you had switched them off, they stay off.',
    ],
  },
  {
    heading: 'The AI coach',
    body: [
      'The coach has two modes. In on-device mode, the default, answers are put together on your phone from your own log, and nothing leaves the device — not the question, not the answer.',
      'In online mode, which a version of the app switches on, the app shows you a notice before your first question, and nothing is sent until you have read it. After that, each question you send carries three things: the question, the earlier messages of the same conversation, and a summary of your training.',
      'The summary contains your recent workouts (exercise names, sets, reps, kilograms, dates, durations), your current programme and its week, your goals, your setup answers (goal, level, days per week, equipment, limitations), the coach’s own answers from the last three weeks in one sentence each, so it does not repeat advice you have already had, and — if you have logged them — your latest weight, tape measurements, height, age and gender.',
      'It does not contain your name, your email, your Google account or any identifier of your phone. The question cannot be tied to you. Our server sees the phone’s internet address, which it holds briefly in memory to limit how many requests one connection can make; it is not stored.',
      'Our server forwards the question to Anthropic, the company behind the Claude model, which writes the answer in the United States. Under Anthropic’s commercial terms the data is not used to train its models and is deleted within 30 days.',
      'We keep no copy of our own unless you have said we may. The coach asks once, before your first question, in three separate lines: your questions and answers, the programmes you ask it to build, and the photos you import one from. Every line starts as no, each is its own answer, and none of them changes the answer you get. What you allow is kept for up to 24 months and then deleted automatically, and it is used for one thing: making the coach better at writing programmes.',
      'You can take it back at any time in Settings, and taking it back deletes what was already kept. Turning any one line off removes every copy kept for you from our server — including those made under the lines you leave on — rather than only stopping new ones.',
      'The programme composer works the same way: when you ask the app to build a programme from a written brief, the brief and the same summary are sent along the same route.',
      'Importing a programme from a photo also uses this route. The photo you picked is scaled down and sent so the table in it can be read; it is used for that one import and is not kept — unless you ticked the photos line above, in which case the photo and the table read from it are kept like any other allowed copy.',
      'Under each answer the online coach writes there is a Report link. If you use it, the answer you reported and the reason you picked are sent to us so that a person can review it — not your question, and nothing that identifies you. The report reaches us through Slack, the messaging service we review reports in, and is deleted once it has been dealt with, at the latest after 24 months.',
    ],
  },
  {
    heading: 'Usage statistics',
    body: [
      'To see whether the app works — for example whether some step of the setup is so hard that people give up there — the app sends anonymous usage events to our own server.',
      'An event is a name and a time, plus for setup steps the step number and which path you took, and for an error report the details listed below. Never the content: no exercise name, no weight, no measurement, no question text. The full list of events is fixed in the app’s code, and the server refuses anything outside it.',
      'If something goes wrong, the app also sends an error report, as one more of these events: a crash, an error on a screen, or a save, backup, restore, sign-in, account deletion or opening your saved data that did not work. What is sent: the type of error, where in the app’s code it happened (a position in the program, not what it was working on), which screen you were on, the app version, which operating system the phone runs and, for a failed save, backup or similar, which one failed and a short code such as “network” or “storage full”. Never sent: error messages, your training data, names, notes or anything you typed — error messages can contain exactly such things, so they are not collected at all. A crash is noted on the phone as it happens and sent the next time the app is opened. Error reports follow the same switch, go only to our own server and are kept for the same time as the other events.',
      'Each install gets a random identifier, generated on your phone. It is not connected to your name, email, Google account or any advertising identity, and it resets if you reinstall the app.',
      'The events go to our own server and nowhere else. They are kept for up to 24 months and then deleted automatically, and they are not shared, not sold and not used for advertising. You can switch them off at any time in Settings → Usage statistics; the app then sends nothing and throws away whatever was waiting to be sent. These are the events:',
    ],
    bullets: [
      'The app was opened.',
      'A setup step was reached, and which one.',
      'Setup was finished, and whether you built a programme or picked a ready one.',
      'A programme was taken into use.',
      'A workout was started.',
      'A workout was saved.',
      'The Pro page was viewed.',
      'A question was sent to the coach — the fact that one was sent, never the text.',
      'The app failed or something did not work: an error report, as described above.',
    ],
  },
  {
    heading: 'Who helps us run this',
    body: [
      'We run no servers of our own. Six companies process data for us, under contracts that bind them to handle it only on our instructions and only for the purposes described here.',
    ],
    bullets: [
      'Vercel (United States): runs our server and stores the cloud backups and the usage events. The storage is in the European Union.',
      'Anthropic (United States): answers coach questions, composes programmes and reads programme photos, as described above.',
      pick(p, {
        android: 'Google (United States): verifies your Google sign-in and handles Google Play payments. Your relationship with Google is covered by Google’s own privacy policy.',
        ios: 'Google (United States): verifies your Google sign-in. Your relationship with Google is covered by Google’s own privacy policy.',
        both: 'Google (United States): verifies your Google sign-in and, on Android, handles Google Play payments. Your relationship with Google is covered by Google’s own privacy policy.',
      }),
      pick(p, {
        android: 'Apple (United States): verifies your Apple sign-in on iPhone. Your relationship with Apple is covered by Apple’s own privacy policy.',
        ios: 'Apple (United States): verifies your Apple sign-in and handles App Store payments. Your relationship with Apple is covered by Apple’s own privacy policy.',
        both: 'Apple (United States): on iPhone, verifies your Apple sign-in and handles App Store payments. Your relationship with Apple is covered by Apple’s own privacy policy.',
      }),
      pick(p, {
        android: 'RevenueCat (United States): manages your Pro purchase for us. It receives an anonymous purchase id, your Google Play purchase record and basic app and device information (app version, operating system, store country). It never receives your name, email or card details.',
        ios: 'RevenueCat (United States): manages your Pro purchase for us. It receives an anonymous purchase id, your App Store purchase record and basic app and device information (app version, operating system, store country). It never receives your name, email or card details.',
        both: 'RevenueCat (United States): manages your Pro purchase for us. It receives an anonymous purchase id, your Google Play or App Store purchase record and basic app and device information (app version, operating system, store country). It never receives your name, email or card details.',
      }),
      'Slack (United States): delivers the coach answers you report to us for review, as described above.',
    ],
  },
  {
    heading: 'Data outside the European Union',
    body: [
      'Where data goes outside the European Union — the coach traffic to Anthropic, the answers you report to Slack, your purchase record at RevenueCat, and possibly Vercel’s processing — the transfer rests on the European Commission’s standard contractual clauses, which are part of each provider’s data processing agreement with us.',
    ],
  },
  {
    heading: 'Why we may process your data',
    body: [
      'The GDPR requires a lawful basis for each kind of processing. These are ours.',
    ],
    bullets: [
      'Providing the app you asked for (contract): keeping your data on your phone, running Pro, and showing you your own history.',
      'Your consent: the cloud backup (you sign in), the coach’s online mode (you read the notice and send a question), the programme composer and the photo import (you ask for them), and reporting an answer (you send the report). Training and body data count as health data, so whenever they leave your phone we rely on your explicit consent. You can withdraw it at any time: delete the backup and sign out, and simply stop sending questions.',
      'Our legitimate interest: the anonymous usage statistics, so we can see where the app fails people, the brief rate limiting that protects the server from abuse, the app version on each request, so the server can ask an outdated app to update, and, once you delete your account, the marker that stops an old sign-in from being used again. You can object by switching the statistics off in Settings, or by writing to us.',
      pick(p, {
        android: 'Legal obligations: none of ours involve your personal data today. Google Play is the seller of record for Pro and keeps the purchase records; the sales reports we receive from Google contain no personal data.',
        ios: 'Legal obligations: none of ours involve your personal data today. Apple handles the payment for Pro through the App Store and keeps the purchase records; the sales reports we receive from Apple contain no personal data.',
        both: 'Legal obligations: none of ours involve your personal data today. Google Play (on Android) and Apple through the App Store (on iPhone) handle the payment for Pro and keep the purchase records; the sales reports we receive from them contain no personal data.',
      }),
    ],
  },
  {
    heading: 'What the app does not do',
    bullets: [
      'No third-party analytics and no crash-reporting tools from other companies. The only usage data is the anonymous statistics described above, error reports included, sent to our own server and no one else.',
      'No ads, no ad networks, no advertising identifier.',
      'No trackers and no social media components. There is no feed, no followers and no public profile.',
      'No access to your location, contacts, microphone, camera or files. A photo is read only when you pick one yourself, through the phone’s own picker, and only that photo.',
      'No advertising profile. The app does tailor programmes and suggestions from your answers and your log, but that happens on your phone, and nothing is decided about you automatically in a way that has legal or similar effects.',
      'No selling, renting or sharing of your data with anyone, beyond the providers named above who work for us.',
      'No account needed. Sign-in exists only to key the optional cloud backup.',
      'No cookies in the app. The app is not a web page and does not open one inside itself, so none are set and none are read. Our web pages set none either. On the page for deleting an account without the app (above), the Sign in with Google button is Google’s own, loaded from Google when the page opens, and Google can set and read its own cookies for that sign-in under Google’s privacy policy.',
    ],
  },
  {
    heading: 'Permissions the app asks for',
    body: [
      'The app asks your phone for very little. What it does use:',
    ],
    bullets: [
      'Notifications: asked the first time a rest timer needs to alert you, or when you switch notifications on in Settings. Refuse, and everything else keeps working.',
      'Photos: the phone’s own picker hands the app the one photo you chose. No permission to your photo library is asked.',
      'Internet: for the server features described in this policy — at present backup, coach, statistics and notices. Logging a workout never needs a connection.',
      'Keeping the screen on during a workout, if you switch that on in Settings.',
      'Vibration, for the haptic ticks — which you can switch off.',
    ],
  },
  {
    heading: 'Notifications',
    body: [
      'Notifications come in three groups: while you train (the rest timer and the live session), wins and recaps after a workout, and reminders such as a weigh-in day or a training day. Every one of them is scheduled on your phone by the app itself. They are not push notifications: no server is involved and no device token exists.',
      pick(p, {
        android: 'Turn any group, or all of them, off in Settings → Notifications, or in Android’s own notification settings.',
        ios: 'Turn any group, or all of them, off in Settings → Notifications, or in the iPhone’s own notification settings.',
        both: 'Turn any group, or all of them, off in Settings → Notifications, or in your phone’s own notification settings.',
      }),
    ],
  },
  {
    heading: 'Payments',
    body: [
      `If you buy Pro, the payment is handled entirely by ${pick(p, {
        android: 'Google Play',
        ios: 'Apple, through the App Store',
        both: 'Google Play on Android and by Apple through the App Store on iPhone',
      })}. We never see your card number, billing address or any payment detail. The app learns only whether Pro is active, which plan, and until when.`,
      'The free trial costs nothing: starting it writes one date on your phone, Pro runs until that date and then stops on its own. Nothing is charged when it ends, nothing is sent anywhere, and no card is asked for. If you have notifications on, the app reminds you two days before it runs out; that reminder is written and shown by your phone, not by us.',
    ],
  },
  {
    heading: 'Feedback, rating and sharing',
    body: [
      'Send feedback opens your own mail app with our address and the app version filled in. You decide what to write. We then see your email address and your message, and keep them only as long as it takes to handle the feedback.',
      pick(p, {
        android: 'Rate Vinha opens the app’s page on Google Play. The app itself sends nothing.',
        ios: 'Rate Vinha opens Apple’s review prompt, or the app’s page on the App Store. The app itself sends nothing.',
        both: 'Rate Vinha opens the app’s page on Google Play on Android, and Apple’s review prompt or the app’s page on the App Store on iPhone. The app itself sends nothing.',
      }),
      'Exporting a programme or your training log as CSV, and inviting a friend, go through your phone’s share menu to the app you pick. We never see where they go.',
    ],
  },
  {
    heading: 'Security',
    body: [
      'Everything that leaves your phone travels over an encrypted connection. On the server, every backup request is checked against your sign-in before anything is read or written, backups are filed under a scrambled identifier in private storage, training data is never written to logs, and request rates are limited.',
      `On your phone, the app’s data is protected by the phone’s own lock and the separation ${pick(p, {
        android: 'Android keeps',
        ios: 'iOS keeps',
        both: 'Android and iOS keep',
      })} between apps; the app adds no encryption of its own. Anyone who can unlock your phone can open Vinha and see your training data, so keep the phone locked.`,
    ],
  },
  {
    heading: 'How long we keep it',
    bullets: [
      'On your phone: until you reset the app’s data or uninstall it.',
      ...(p !== 'ios' ? ['Android backup: nothing to keep — Android’s own backup is switched off for this app.'] : []),
      ...(p !== 'android'
        ? [
            'iPhone backup: if iCloud Backup or a computer backup is switched on, the app’s data is kept in it for as long as Apple, or you, keep that backup — under Apple’s terms, not ours.',
          ]
        : []),
      'Cloud backup: until you delete it in Settings, or ask us to.',
      'The marker left by Delete account on an Apple account: one scrambled marker with a date and a random number your phone made for the deletion request (used only to tell that phone its deletion went through), with no name, email or training data. The server’s routine clean-up removes it once 180 days have passed and it can no longer end anything. That clean-up runs when someone signs in with Apple, so it can take a little longer.',
      'Coach questions, briefs and photos: not kept by us unless you allowed it, and then for up to 24 months or until you take the permission back, whichever comes first. Anthropic deletes its own copy within 30 days either way.',
      'Usage statistics, error reports included: up to 24 months, then deleted automatically.',
      'Feedback emails: as long as it takes to handle them.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'Under the GDPR you have the right to see the data we hold about you, to correct it, to delete it, to take it with you, to withdraw a consent you gave, and to object to processing based on our legitimate interest.',
      'Most of these you exercise yourself, inside the app, without asking anyone. For the rest, write to us — we answer within a month.',
    ],
    bullets: [
      'See it: Settings → My data shows your profile, and Progress shows your log. The cloud backup is the same data, so there is nothing more on our side to show.',
      'Correct it: edit your profile, or any logged session or entry.',
      'Delete it: Settings → Reset all data clears the phone, Settings → Delete cloud backup clears the server copy, and Settings → Delete account clears the server copy and any coach copies you had allowed us to keep, and signs you out. Uninstalling the app removes the phone copy too. Usage statistics cannot be traced back to you, so there is nothing of yours to find in them.',
      'Take it with you: Settings → Export plan (CSV) sends your programme, or every logged set, as CSV text to any app you choose.',
      'Withdraw consent or object: delete the cloud backup and sign out; stop sending questions to the coach; switch usage statistics off in Settings.',
      `Complain: write to ${LEGAL_ENTITY.email} first, so we can put it right. You also have the right to complain to the data protection authority — in Finland, the Office of the Data Protection Ombudsman, tietosuoja.fi or tietosuoja@om.fi.`,
    ],
  },
  {
    heading: 'Children',
    body: [
      'Vinha is not intended for children under 16, and we do not knowingly process their data. Because nothing reaches us with a name attached, we cannot tell a child’s data from anyone else’s — if you believe a child has signed in for the cloud backup, write to us and we will delete it.',
    ],
  },
  {
    heading: 'Changes to this policy',
    body: [
      'If this policy changes in a way that affects you, the app shows the change before it takes effect. The date at the top always tells you which version you are reading, and earlier versions are available on request.',
    ],
  },
];

const privacyFi = (p: LegalPlatform): LegalSection[] => [
  {
    heading: 'Lyhyesti',
    body: [
      'Vinha tallentaa treenitietosi puhelimeesi. Tämä seloste kertoo, mitä sovellus lähettää palvelimellemme, milloin ja miksi.',
      'Tällä hetkellä asioita on neljä. Vapaaehtoinen pilvivarmuuskopio lähtee, kun kirjaudut Googlella tai Applella, ja AI-valmentajan verkkotila, kun luet ilmoituksen ja lähetät sen jälkeen kysymyksen, pyydät ohjelman tai tuot sellaisen valokuvasta. Nimettömät käyttötilastot sovellus lähettää itse, ellet kytke niitä pois asetuksista — niissä ei ole sisältöä eikä henkilöllisyyttä, ja ne kuvataan kokonaan alla. Jokaisessa näistä pyynnöistä kulkee lisäksi sovelluksen versionumero ja tieto siitä, onko puhelin Android vai iOS, jotta palvelimemme tunnistaa liian vanhan sovelluksen ja voi pyytää sinua päivittämään sen.',
      'Neljäs on tarkistus, jonka sovellus tekee itse: käynnistyessään ja palatessasi siihen muutaman tunnin jälkeen se kysyy palvelimeltamme, onko kaikille Vinhan käyttäjille tiedotetta — esimerkiksi palvelukatkosta tai tietoturvaongelmasta — ja näyttää sen kerran. Pyynnössä ei kulje muuta kuin sovelluksen versio ja alusta; kuten mikä tahansa pyyntö, se näyttää palvelimellemme puhelimen internet-osoitteen, eikä siitä tallenneta mitään.',
      'Ei mainoksia, ei seurantaa, ei tietojen myyntiä. Jos jokin tässä selosteessa on epäselvää, kirjoita meille — osoite on seuraavassa kohdassa.',
    ],
  },
  {
    heading: 'Kuka vastaa',
    body: [
      `${publisher('fi')} julkaisee Vinha Fitness -sovelluksen (”Vinha”) ja on rekisterinpitäjä eli se, joka vastaa tietojesi käsittelystä kaikessa, mitä tässä selosteessa kuvataan.`,
      `Kysymykset tästä selosteesta tai tiedoistasi: ${LEGAL_ENTITY.email}.`,
    ],
  },
  {
    heading: 'Mitä sovellus tallentaa puhelimeesi',
    body: [
      'Kaikki alla oleva on joko sinun syöttämääsi tai sovelluksen laskemaa siitä, mitä syötit. Se säilyy sovelluksen omassa tallennustilassa puhelimessasi.',
    ],
    bullets: [
      'Profiilisi käyttöönotosta: sukupuoli, ikä, pituus, paino, tavoitteet, kokemustaso, treenipäivät viikossa, välineet, painotettavat alueet sekä vammat tai rajoitteet, jotka merkitsit.',
      'Treenilokisi: treenit ja cardio-suoritukset liikkeineen, sarjoineen, toistoineen, painoineen, muistiinpanoineen, päivämäärineen ja kestoineen sekä se, miltä treeni tuntui.',
      'Kehon tiedot, jotka itse lisäät: painomerkinnät ja mittanauhalla otetut mitat.',
      'Ohjelmasi: ne, jotka rakennat, tuot CSV-tiedostosta tai valokuvasta, sekä liikenimet, jotka opetat sovellukselle.',
      'Valmentajan kanssa asettamasi tavoitteet sekä virstanpylväät ja kaudet, jotka sovellus laskee lokistasi.',
      'Mitä valmentaja on neuvonut sinulle viimeisten kolmen viikon aikana: kunkin vastauksen yhden lauseen tiivistelmä ja päivä, jona se annettiin, enintään kymmenen kappaletta. Se säilytetään, jottei valmentaja toista jo antamaansa neuvoa, se poistuu kolmea viikkoa vanhetessaan, ja se pysyy tässä puhelimessa — alla kuvattu pilvivarmuuskopio ei kanna sitä mukanaan.',
      'Asetukset: kieli, yksiköt, teema, ilmoitus- ja ääniasetukset, oletuslepoaika, treenitauot.',
      'Pro-tila: onko Pro päällä, milloin se ostettiin tai peruttiin, ja päivät, joihin asti kampanjakoodi tai ilmainen kokeilu pitää sen päällä.',
      'Pientä kirjanpitoa: onko arviointipyyntö tai verkkovalmentajan ilmoitus jo näytetty, tiivistelmätiedosto, jota kotinäytön widget lukee, jono lähetystä odottavia käyttötapahtumia, merkintä siitä, että valmentajan muisti pitää yhä tyhjentää palautuksen jälkeen, jos ensimmäinen yritys ei tavoittanut levyä, kopio vaurioituneesta datatiedostosta, jos sovellus sellaisen joskus löytää, sekä käynnissä oleva treeni ja aiemmista treeneistä muistetut luvut, jos sovellus kaatuilee ja valitset niiden siirtämisen sivuun — ne siirretään sivuun eikä poisteta, jotta rikkoutunut tiedosto ei ole menetetty treeniloki.',
    ],
  },
  ...(p !== 'ios'
    ? [
        {
          heading: 'Androidin oma varmuuskopio',
          body: [
            'Androidin oma varmuuskopiointi on tälle sovellukselle pois päältä. Puhelimesi ei kopioi Vinhan tietoja Google-tilisi varmuuskopioon eikä anna niitä uudelle puhelimelle käyttöönoton laitesiirrossa. Treenilokistasi ei lähde tätä kautta mitään.',
            'Uusi puhelin aloittaa siis tyhjästä, ellet käytä alla kuvattua pilvivarmuuskopiota tai vie lokiasi ensin CSV-tiedostona. Se on pois päältä siksi, että alla kuvattu sovelluksen oma varmuuskopio, jonka kytket itse päälle, on ainoa paikka, jossa koko treenilokiasi säilytetään tämän puhelimen ulkopuolella.',
          ],
        },
      ]
    : []),
  ...(p !== 'android'
    ? [
        {
          heading: 'iPhonen varmuuskopio',
          body: [
            'iPhonella sovelluksen tietoja ei jätetä puhelimen oman varmuuskopion ulkopuolelle. Jos iCloud-varmuuskopiointi on päällä tai varmuuskopioit puhelimen tietokoneelle, Vinhan tiedot menevät siihen muiden sovellustesi tietojen mukana ja palautuvat sen mukana, kun otat puhelimen käyttöön siitä. Sen varmuuskopion tekee ja säilyttää Apple tai oma tietokoneesi Applen ehtojen mukaisesti. Emme tee sitä, emme näe sitä emmekä voi poistaa sitä.',
            'Jos et halua treenilokiasi siihen, voit jättää Vinhan pois iCloud-varmuuskopiosta iPhonen iCloud-asetuksissa tai kytkeä iCloud-varmuuskopioinnin pois. Alla kuvattu pilvivarmuuskopio on erillinen: se on ainoa treenilokistasi meillä oleva kopio.',
          ],
        },
      ]
    : []),
  {
    heading: 'Pilvivarmuuskopio (vapaaehtoinen)',
    body: [
      'Jos kirjaudut Googlella tai Applella, kopio kaikesta kohdassa ”Mitä sovellus tallentaa puhelimeesi” luetellusta — paitsi kesken olevasta treenistä — lähetetään salattua yhteyttä pitkin palvelimellemme ja säilytetään siellä, jotta uusi puhelin voi palauttaa sen, kun kirjaudut uudelleen. Kirjautumista ei koskaan vaadita; jokainen toiminto toimii ilman sitä.',
      'Googlelta saamme Google-tilisi tunnisteen, sähköpostiosoitteesi ja nimesi. Ne säilyvät puhelimessasi, jotta sovellus voi näyttää, mikä tili on kirjautuneena. Palvelimella varmuuskopio tallennetaan tunnisteen sekoitetun muodon alle; sähköpostiasi ja nimeäsi ei tallenneta sinne. Kun kirjaudut ulos, puhelin säilyttää vain niiden tilien tunnisteet, jotka ovat kirjautuneet siitä ulos, jotta sovellus kysyy ennen kuin se varmuuskopioi puhelimen tiedot seuraavaksi kirjautuvalle toiselle Google-tilille; tunnisteet poistetaan, kun tämä kirjautuminen on ratkaistu.',
      'iPhonella voit kirjautua Googlen sijaan Applella. Applelta saamme Apple ID:llesi tunnisteen, jonka vain Vinha saa, ja vain ensimmäisellä kerralla nimen ja sähköpostin, jotka päätät jakaa — sähköposti voi olla Applen välittämä yksityinen osoite. Ne säilyvät puhelimessasi kuten Googlen tiedot. Puhelin vaihtaa Applen kirjautumisen kerran omaksi kirjautumiseksemme, joka säilytetään puhelimessa ja on voimassa enintään 180 päivää ja joka tarkistetaan joka varmuuskopiopyynnöllä; ennen käyttöä puhelin kysyy Applelta, oletko lopettanut Apple ID:si käytön Vinhassa, ja kirjaa sinut ulos, jos olet. Tilin poistaminen (alla) ei poista Vinhaa luettelosta sovelluksista, joissa käytät Apple-kirjautumista; voit poistaa sen sieltä itse iPhonen Apple ID -asetuksissa.',
      'Varmuuskopio lähetetään hetki sen jälkeen, kun kirjaat treenin, ja aina kun painat Varmuuskopioi nyt. Palvelin tarkistaa kirjautumisesi joka pyynnöllä, tallentaa tiedoston ja luovuttaa sen vain samalle tilille. Se ei lue, analysoi eikä lokita sisältöä.',
      'Varmuuskopion säilyttää Vercel, palvelintarjoajamme, Euroopan unionin alueella. Se säilyy, kunnes poistat sen.',
      'Asetukset → Poista pilvivarmuuskopio poistaa palvelinkopion heti. Uloskirjautuminen ei poista sitä, eikä puhelimen tietojen nollaus — nollaus kirjaa sinut ensin ulos juuri siksi, ettei tyhjä varmuuskopio koskaan korvaisi täyttä. Kopio odottaa, kunnes kirjaudut uudelleen. Jos et enää pääse sovellukseen, Google-tilin voi poistaa ilman sitä osoitteessa styxon.fi/vinha-fitness/legal/delete-account.fi: kirjaudut sivulla Googlella, ja se poistaa palvelinkopion kuten Poista tili. Alla kuvatut valmentajan kopiot on tallennettu puhelimesi eikä tilisi alle, joten sivu ei tavoita niitä; ne poistuvat automaattisesti 24 kuukauden kuluessa. Voit myös kirjautua samalla tilillä millä tahansa puhelimella ja poistaa sen sieltä.',
      'Asetukset → Poista tili tekee saman ja enemmän: se poistaa palvelinkopion, kirjaa sinut ulos tästä puhelimesta, pyytää palvelintamme poistamaan kaikki kopiot, jotka AI-valmentaja on säilyttänyt sinusta (vain jos olit sallinut sen, kuten kohdassa ”AI-valmentaja” kerrotaan), ja päättää oman palvelimemme Apple-tilille antaman kirjautumisen: muut Applella kirjautuneet puhelimesi kirjautuvat ulos seuraavalla pyynnöllään palvelimellemme, eikä ennen poistoa Applella tehdyllä kirjautumisella voi enää aloittaa uutta. Treenitiedot tässä puhelimessa säilyvät; Nollaa kaikki tiedot tyhjentää ne erikseen. Nimettömät käyttötilastot eivät ole sidottu tiliisi, joten tilin poistaminen ei poista niitä; ne säilyvät enintään 24 kuukautta, kuten kohdassa ”Käyttötilastot” kerrotaan. Näiden lisäksi palvelimellamme ei sen jälkeen ole sinusta mitään, paitsi Apple-tilillä yksi sekoitettu merkintä päivämäärineen, joka kertoo, että sitä ennen tehdyt kirjautumiset ovat päättyneet, jottei vanhaa kirjautumista voi käyttää uudelleen. Siinä on myös satunnainen luku, jonka puhelimesi teki tätä pyyntöä varten ja jota käytetään vain kertomaan sille puhelimelle, että poisto onnistui. Siinä ei ole nimeä, sähköpostia eikä treenitietoja.',
      'Asetukset → Nollaa kaikki tiedot poistaa kaiken tästä puhelimesta ja kirjaa sinut ulos. Se säilyttää pilvivarmuuskopion, joka odottaa sinua yllä kerrotulla tavalla, ja säilyttää valintasi käyttötilastoista: jos olit kytkenyt ne pois, ne pysyvät poissa.',
    ],
  },
  {
    heading: 'AI-valmentaja',
    body: [
      'Valmentajalla on kaksi tilaa. Laitetilassa, joka on oletus, vastaukset kootaan puhelimessasi omasta lokistasi, eikä mitään lähde laitteelta — ei kysymys eikä vastaus.',
      'Verkkotilassa, jonka sovelluksen versio kytkee päälle, sovellus näyttää sinulle ilmoituksen ennen ensimmäistä kysymystä, eikä mitään lähetetä ennen kuin olet lukenut sen. Sen jälkeen jokainen lähettämäsi kysymys kantaa mukanaan kolme asiaa: kysymyksen, saman keskustelun aiemmat viestit ja yhteenvedon treenistäsi.',
      'Yhteenvedossa ovat viimeaikaiset treenisi (liikkeiden nimet, sarjat, toistot, kilot, päivämäärät, kestot), nykyinen ohjelmasi ja sen viikko, tavoitteesi, käyttöönoton vastauksesi (tavoite, taso, treenipäivät viikossa, välineet, rajoitteet), valmentajan omat vastaukset viimeisiltä kolmelta viikolta yhtenä lauseena kukin, jottei se toista jo antamaansa neuvoa, sekä — jos olet kirjannut ne — viimeisin painosi, mittasi, pituutesi, ikäsi ja sukupuolesi.',
      'Siinä ei ole nimeäsi, sähköpostiasi, Google-tiliäsi eikä mitään puhelimesi tunnistetta. Kysymystä ei voi yhdistää sinuun. Palvelimemme näkee puhelimen internet-osoitteen, jota se pitää hetken muistissa rajoittaakseen, montako pyyntöä yksi yhteys voi tehdä; sitä ei tallenneta.',
      'Palvelimemme välittää kysymyksen Anthropicille, Claude-mallin kehittäjälle, joka kirjoittaa vastauksen Yhdysvalloissa. Anthropicin kaupallisten ehtojen mukaan tietoja ei käytetä sen mallien opettamiseen, ja ne poistetaan 30 päivän kuluessa.',
      'Me emme säilytä omaa kopiotamme, ellet ole antanut siihen lupaa. Valmentaja kysyy sen kerran, ennen ensimmäistä kysymystäsi, kolmena erillisenä rivinä: kysymyksesi ja vastaukset, ohjelmat joita pyydät sen rakentamaan, ja valokuvat joista tuot ohjelman. Jokainen rivi alkaa ei-vastauksesta, jokainen on oma vastauksensa, eikä mikään niistä muuta sitä vastausta jonka saat. Sallimasi säilytetään enintään 24 kuukautta ja poistetaan sitten automaattisesti, ja sitä käytetään yhteen asiaan: valmentajan parantamiseen ohjelmien kirjoittajana.',
      'Voit peruuttaa luvan milloin tahansa asetuksista, ja peruutus poistaa myös jo säilytetyn. Kun kytket yhdenkin rivin pois, jokainen sinulle säilytetty kopio poistetaan palvelimeltamme — myös päälle jätettyjen rivien nojalla tehdyt — eikä vain uusien kertyminen lopu.',
      'Ohjelmakoostaja toimii samalla tavalla: kun pyydät sovellusta rakentamaan ohjelman kirjoittamasi kuvauksen pohjalta, kuvaus ja sama yhteenveto lähetetään samaa reittiä.',
      'Myös ohjelman tuonti valokuvasta käyttää tätä reittiä. Valitsemasi kuva pienennetään ja lähetetään, jotta siinä oleva taulukko voidaan lukea; sitä käytetään siihen yhteen tuontiin, eikä sitä säilytetä — paitsi jos rastitit yllä valokuvien rivin, jolloin kuva ja siitä luettu taulukko säilytetään kuten muutkin sallimasi kopiot.',
      'Jokaisen verkkotilan valmentajan kirjoittaman vastauksen alla on Ilmoita-linkki. Jos käytät sitä, ilmoittamasi vastaus ja valitsemasi syy lähetetään meille, jotta ihminen voi tarkistaa sen — ei kysymystäsi eikä mitään, mikä yksilöisi sinut. Ilmoitus tulee meille Slackin kautta, viestipalvelun jossa käsittelemme ilmoitukset, ja se poistetaan, kun asia on käsitelty, viimeistään 24 kuukauden kuluttua.',
    ],
  },
  {
    heading: 'Käyttötilastot',
    body: [
      'Jotta näemme, toimiiko sovellus — esimerkiksi onko jokin käyttöönoton vaihe niin vaikea, että siihen jäädään — sovellus lähettää nimettömiä käyttötapahtumia omalle palvelimellemme.',
      'Tapahtuma on nimi ja aika sekä käyttöönoton vaiheissa vaiheen numero ja se, kumman polun valitsit, ja virheraportissa jäljempänä luetellut tiedot. Ei koskaan sisältöä: ei liikkeen nimeä, ei painoa, ei mittaa, ei kysymyksen tekstiä. Tapahtumien lista on kiinnitetty sovelluksen koodiin, ja palvelin hylkää kaiken sen ulkopuolisen.',
      'Jos jokin menee pieleen, sovellus lähettää myös virheraportin, yhtenä näistä tapahtumista: kaatumisen, virheen jollakin ruudulla tai tallennuksen, varmuuskopion, palautuksen, kirjautumisen, tilin poiston tai tallennettujen tietojesi avaamisen, joka ei onnistunut. Lähetetään: virheen tyyppi, kohta sovelluksen koodissa, jossa se tapahtui (paikka ohjelmassa, ei se, mitä sillä hetkellä käsiteltiin), mikä ruutu oli auki, sovelluksen versio, puhelimen käyttöjärjestelmä ja epäonnistuneen tallennuksen, varmuuskopion tai vastaavan kohdalla mikä niistä epäonnistui sekä lyhyt koodi, kuten ”verkko” tai ”tallennustila täynnä”. Ei koskaan lähetetä: virheilmoitusten tekstejä, treenitietojasi, nimiä, muistiinpanoja tai mitään kirjoittamaasi — virheilmoitukset voivat sisältää juuri tällaista, joten niitä ei kerätä lainkaan. Kaatuminen merkitään puhelimeen heti, kun se tapahtuu, ja lähetetään, kun sovellus seuraavan kerran avataan. Virheraportit seuraavat samaa kytkintä, menevät vain omalle palvelimellemme ja säilyvät yhtä kauan kuin muut tapahtumat.',
      'Jokainen asennus saa satunnaisen tunnisteen, joka luodaan puhelimessasi. Sitä ei ole kytketty nimeesi, sähköpostiisi, Google-tiliisi eikä mihinkään mainostunnisteeseen, ja se nollautuu, jos asennat sovelluksen uudelleen.',
      'Tapahtumat menevät omalle palvelimellemme eivätkä mihinkään muualle. Niitä säilytetään enintään 24 kuukautta, minkä jälkeen ne poistetaan automaattisesti, eikä niitä jaeta, myydä tai käytetä mainontaan. Voit kytkeä ne pois milloin tahansa kohdasta Asetukset → Käyttötilastot; sen jälkeen sovellus ei lähetä mitään ja hävittää lähetystä odottaneet tapahtumat. Tapahtumat ovat nämä:',
    ],
    bullets: [
      'Sovellus avattiin.',
      'Käyttöönoton vaihe saavutettiin, ja mikä vaihe.',
      'Käyttöönotto valmistui, ja rakensitko ohjelman vai valitsitko valmiin.',
      'Ohjelma otettiin käyttöön.',
      'Treeni aloitettiin.',
      'Treeni tallennettiin.',
      'Pro-sivu avattiin.',
      'Valmentajalle lähetettiin kysymys — se, että kysymys lähti, ei koskaan sen tekstiä.',
      'Sovellus kaatui tai jokin ei onnistunut: virheraportti, kuten edellä kerrotaan.',
    ],
  },
  {
    heading: 'Ketkä auttavat meitä',
    body: [
      'Meillä ei ole omia palvelimia. Kuusi yritystä käsittelee tietoja puolestamme sopimuksilla, jotka velvoittavat ne käsittelemään tietoja vain meidän ohjeidemme mukaan ja vain tässä kuvattuihin tarkoituksiin.',
    ],
    bullets: [
      'Vercel (Yhdysvallat): ajaa palvelimemme ja säilyttää pilvivarmuuskopiot ja käyttötapahtumat. Tallennustila on Euroopan unionin alueella.',
      'Anthropic (Yhdysvallat): vastaa valmentajan kysymyksiin, koostaa ohjelmia ja lukee ohjelmakuvia, kuten yllä kuvattiin.',
      pick(p, {
        android: 'Google (Yhdysvallat): vahvistaa Google-kirjautumisesi ja hoitaa Google Playn maksut. Suhdettasi Googleen koskee Googlen oma tietosuojakäytäntö.',
        ios: 'Google (Yhdysvallat): vahvistaa Google-kirjautumisesi. Suhdettasi Googleen koskee Googlen oma tietosuojakäytäntö.',
        both: 'Google (Yhdysvallat): vahvistaa Google-kirjautumisesi ja hoitaa Androidilla Google Playn maksut. Suhdettasi Googleen koskee Googlen oma tietosuojakäytäntö.',
      }),
      pick(p, {
        android: 'Apple (Yhdysvallat): vahvistaa Apple-kirjautumisesi iPhonella. Suhdettasi Appleen koskee Applen oma tietosuojakäytäntö.',
        ios: 'Apple (Yhdysvallat): vahvistaa Apple-kirjautumisesi ja hoitaa App Storen maksut. Suhdettasi Appleen koskee Applen oma tietosuojakäytäntö.',
        both: 'Apple (Yhdysvallat): vahvistaa iPhonella Apple-kirjautumisesi ja hoitaa App Storen maksut. Suhdettasi Appleen koskee Applen oma tietosuojakäytäntö.',
      }),
      pick(p, {
        android: 'RevenueCat (Yhdysvallat): hallinnoi Pro-ostoasi puolestamme. Se saa nimettömän ostotunnisteen, Google Playn ostotietosi sekä perustiedot sovelluksesta ja laitteesta (sovellusversio, käyttöjärjestelmä, kaupan maa). Se ei koskaan saa nimeäsi, sähköpostiasi eikä korttitietojasi.',
        ios: 'RevenueCat (Yhdysvallat): hallinnoi Pro-ostoasi puolestamme. Se saa nimettömän ostotunnisteen, App Storen ostotietosi sekä perustiedot sovelluksesta ja laitteesta (sovellusversio, käyttöjärjestelmä, kaupan maa). Se ei koskaan saa nimeäsi, sähköpostiasi eikä korttitietojasi.',
        both: 'RevenueCat (Yhdysvallat): hallinnoi Pro-ostoasi puolestamme. Se saa nimettömän ostotunnisteen, Google Playn tai App Storen ostotietosi sekä perustiedot sovelluksesta ja laitteesta (sovellusversio, käyttöjärjestelmä, kaupan maa). Se ei koskaan saa nimeäsi, sähköpostiasi eikä korttitietojasi.',
      }),
      'Slack (Yhdysvallat): toimittaa meille tarkistettaviksi valmentajan vastaukset, joista ilmoitat, kuten yllä kuvattiin.',
    ],
  },
  {
    heading: 'Tiedot Euroopan unionin ulkopuolella',
    body: [
      'Siltä osin kuin tietoja siirtyy Euroopan unionin ulkopuolelle — valmentajan liikenne Anthropicille, ilmoittamasi vastaukset Slackiin, ostotietosi RevenueCatilla ja mahdollisesti Vercelin käsittely — siirto perustuu Euroopan komission vakiosopimuslausekkeisiin, jotka ovat osa kunkin palveluntarjoajan kanssamme tekemää tietojenkäsittelysopimusta.',
    ],
  },
  {
    heading: 'Millä perusteella käsittelemme tietojasi',
    body: [
      'Tietosuoja-asetus (GDPR) vaatii jokaiselle käsittelylle laillisen perusteen. Meidän perusteemme ovat nämä.',
    ],
    bullets: [
      'Sovelluksen tarjoaminen sinulle (sopimus): tietojesi säilyttäminen puhelimessasi, Pron toimittaminen ja oman historiasi näyttäminen.',
      'Suostumuksesi: pilvivarmuuskopio (kirjaudut sisään), valmentajan verkkotila (luet ilmoituksen ja lähetät kysymyksen), ohjelmakoostaja ja kuvatuonti (pyydät niitä) sekä vastauksesta ilmoittaminen (lähetät ilmoituksen). Treeni- ja kehontiedot ovat terveystietoja, joten aina kun niitä lähtee puhelimestasi, nojaamme nimenomaiseen suostumukseesi. Voit peruuttaa sen milloin tahansa: poista varmuuskopio ja kirjaudu ulos, ja lakkaa lähettämästä kysymyksiä.',
      'Oikeutettu etumme: nimettömät käyttötilastot, jotta näemme, missä sovellus pettää käyttäjät, lyhytaikainen pyyntöjen rajoitus, joka suojaa palvelinta väärinkäytöltä, sovelluksen versio jokaisessa pyynnössä, jotta palvelin voi pyytää vanhentunutta sovellusta päivittymään, sekä — kun poistat tilisi — merkintä, joka estää vanhan kirjautumisen käyttämisen uudelleen. Voit vastustaa tätä kytkemällä tilastot pois asetuksista tai kirjoittamalla meille.',
      pick(p, {
        android: 'Lakisääteiset velvoitteet: mikään meidän velvoitteistamme ei tänään koske henkilötietojasi. Google Play on Pron myyjä ja säilyttää ostotiedot; Googlelta saamamme myyntiraportit eivät sisällä henkilötietoja.',
        ios: 'Lakisääteiset velvoitteet: mikään meidän velvoitteistamme ei tänään koske henkilötietojasi. Apple hoitaa Pron maksun App Storen kautta ja säilyttää ostotiedot; Applelta saamamme myyntiraportit eivät sisällä henkilötietoja.',
        both: 'Lakisääteiset velvoitteet: mikään meidän velvoitteistamme ei tänään koske henkilötietojasi. Google Play (Androidilla) ja Apple App Storen kautta (iPhonella) hoitavat Pron maksun ja säilyttävät ostotiedot; niiltä saamamme myyntiraportit eivät sisällä henkilötietoja.',
      }),
    ],
  },
  {
    heading: 'Mitä sovellus ei tee',
    bullets: [
      'Ei kolmannen osapuolen analytiikkaa eikä muiden yritysten kaatumisraportointityökaluja. Ainoa käyttödata on yllä kuvatut nimettömät tilastot, virheraportit mukaan lukien, jotka menevät omalle palvelimellemme eikä kenellekään muulle.',
      'Ei mainoksia, ei mainosverkostoja, ei mainostunnistetta.',
      'Ei seurantaa eikä sosiaalisen median osia. Ei syötettä, ei seuraajia, ei julkista profiilia.',
      'Ei pääsyä sijaintiisi, yhteystietoihisi, mikrofoniin, kameraan tai tiedostoihisi. Kuva luetaan vain, kun itse valitset sen puhelimen omalla valitsimella, ja vain se kuva.',
      'Ei mainosprofiilia. Sovellus kyllä räätälöi ohjelmia ja ehdotuksia vastaustesi ja lokisi perusteella, mutta se tapahtuu puhelimessasi, eikä sinusta päätetä automaattisesti mitään, millä olisi oikeudellisia tai vastaavia vaikutuksia.',
      'Ei tietojesi myyntiä, vuokrausta eikä jakamista kenellekään — lukuun ottamatta yllä nimettyjä palveluntarjoajia, jotka työskentelevät meille.',
      'Ei tilipakkoa. Kirjautuminen on olemassa vain vapaaehtoista pilvivarmuuskopiota varten.',
      'Ei evästeitä sovelluksessa. Sovellus ei ole verkkosivu eikä avaa sellaista sisäänsä, joten evästeitä ei aseteta eikä lueta. Myöskään verkkosivumme eivät aseta niitä. Yllä mainitulla sivulla, jolla tilin voi poistaa ilman sovellusta, Kirjaudu Googlella -painike on Googlen oma ja ladataan Googlelta, kun sivu avautuu, ja Google voi asettaa ja lukea kirjautumista varten omia evästeitään Googlen tietosuojakäytännön mukaisesti.',
    ],
  },
  {
    heading: 'Luvat, joita sovellus pyytää',
    body: [
      'Sovellus pyytää puhelimeltasi hyvin vähän. Tätä se käyttää:',
    ],
    bullets: [
      'Ilmoitukset: kysytään, kun lepoajastin ensimmäisen kerran tarvitsee hälyttää, tai kun kytket ilmoitukset päälle asetuksista. Kieltäydy, ja kaikki muu toimii silti.',
      'Kuvat: puhelimen oma valitsin antaa sovellukselle sen yhden kuvan, jonka valitsit. Lupaa kuvakirjastoosi ei pyydetä.',
      'Internet: tässä selosteessa kuvattuja palvelintoimintoja varten — tällä hetkellä varmuuskopio, valmentaja, tilastot ja tiedotteet. Treenin kirjaaminen ei koskaan tarvitse yhteyttä.',
      'Näytön pitäminen päällä treenin aikana, jos kytket sen päälle asetuksista.',
      'Värinä, haptisia napsautuksia varten — ne voi kytkeä pois.',
    ],
  },
  {
    heading: 'Ilmoitukset',
    body: [
      'Ilmoituksia on kolmea ryhmää: treenin aikana (lepoajastin ja käynnissä oleva treeni), voitot ja koosteet treenin jälkeen sekä muistutukset, kuten punnituspäivä tai treenipäivä. Jokaisen niistä ajastaa sovellus itse puhelimessasi. Ne eivät ole push-ilmoituksia: palvelinta ei ole mukana eikä laitetunnistetta ole olemassa.',
      pick(p, {
        android: 'Kytke mikä tahansa ryhmä tai kaikki pois kohdasta Asetukset → Ilmoitukset tai Androidin omista ilmoitusasetuksista.',
        ios: 'Kytke mikä tahansa ryhmä tai kaikki pois kohdasta Asetukset → Ilmoitukset tai iPhonen omista ilmoitusasetuksista.',
        both: 'Kytke mikä tahansa ryhmä tai kaikki pois kohdasta Asetukset → Ilmoitukset tai puhelimesi omista ilmoitusasetuksista.',
      }),
    ],
  },
  {
    heading: 'Maksut',
    body: [
      `Jos ostat Pron, maksun hoitaa kokonaan ${pick(p, {
        android: 'Google Play',
        ios: 'Apple App Storen kautta',
        both: 'Androidilla Google Play ja iPhonella Apple App Storen kautta',
      })}. Emme koskaan näe korttinumeroasi, laskutusosoitettasi emmekä mitään maksutietoa. Sovellus saa tietää vain, onko Pro voimassa, mikä tilaus ja mihin asti.`,
      'Ilmainen kokeilu ei maksa mitään: sen aloittaminen kirjoittaa puhelimeesi yhden päivämäärän, Pro on voimassa siihen asti ja päättyy sitten itsestään. Päättyminen ei veloita mitään, mitään ei lähetetä minnekään, eikä korttia kysytä. Jos ilmoitukset ovat päällä, sovellus muistuttaa kaksi päivää ennen loppua; sen muistutuksen kirjoittaa ja näyttää puhelimesi, emme me.',
    ],
  },
  {
    heading: 'Palaute, arviointi ja jakaminen',
    body: [
      'Lähetä palautetta avaa oman sähköpostisovelluksesi, johon on valmiiksi täytetty osoitteemme ja sovelluksen versio. Sinä päätät, mitä kirjoitat. Me näemme sitten sähköpostiosoitteesi ja viestisi, ja säilytämme ne vain niin kauan kuin palautteen käsittely vaatii.',
      pick(p, {
        android: 'Arvioi Vinha avaa sovelluksen sivun Google Playssä. Sovellus itse ei lähetä mitään.',
        ios: 'Arvioi Vinha avaa Applen arviointikehotteen tai sovelluksen sivun App Storessa. Sovellus itse ei lähetä mitään.',
        both: 'Arvioi Vinha avaa Androidilla sovelluksen sivun Google Playssä ja iPhonella Applen arviointikehotteen tai sovelluksen sivun App Storessa. Sovellus itse ei lähetä mitään.',
      }),
      'Ohjelman tai treenilokin vienti CSV-muodossa sekä kaverin kutsuminen kulkevat puhelimesi jakovalikon kautta valitsemaasi sovellukseen. Me emme koskaan näe, minne ne menevät.',
    ],
  },
  {
    heading: 'Tietoturva',
    body: [
      'Kaikki puhelimestasi lähtevä kulkee salattua yhteyttä pitkin. Palvelimella jokainen varmuuskopiopyyntö tarkistetaan kirjautumistasi vasten ennen kuin mitään luetaan tai kirjoitetaan, varmuuskopiot tallennetaan sekoitetun tunnisteen alle yksityiseen tallennustilaan, treenitietoja ei koskaan kirjoiteta lokeihin, ja pyyntöjen määrää rajoitetaan.',
      `Puhelimessasi sovelluksen tietoja suojaavat puhelimen oma lukitus ja ${pick(p, {
        android: 'Androidin',
        ios: 'iOS:n',
        both: 'Androidin ja iOS:n',
      })} sovellusten välinen eristys; sovellus ei lisää omaa salaustaan. Kuka tahansa, joka saa puhelimesi auki, voi avata Vinhan ja nähdä treenitietosi — pidä siis puhelin lukittuna.`,
    ],
  },
  {
    heading: 'Kuinka kauan säilytämme tiedot',
    bullets: [
      'Puhelimessasi: kunnes nollaat sovelluksen tiedot tai poistat sovelluksen.',
      ...(p !== 'ios' ? ['Android-varmuuskopio: ei mitään säilytettävää — Androidin oma varmuuskopiointi on tälle sovellukselle pois päältä.'] : []),
      ...(p !== 'android'
        ? [
            'iPhonen varmuuskopio: jos iCloud-varmuuskopiointi tai tietokoneelle tehtävä varmuuskopio on päällä, sovelluksen tiedot säilyvät siinä niin kauan kuin Apple tai sinä säilytätte sitä varmuuskopiota — Applen ehtojen mukaan, ei meidän.',
          ]
        : []),
      'Pilvivarmuuskopio: kunnes poistat sen asetuksista tai pyydät meitä poistamaan sen.',
      'Tilin poiston jättämä merkintä Apple-tilillä: yksi sekoitettu merkintä päivämäärineen sekä satunnainen luku, jonka puhelimesi teki poistopyyntöä varten (käytetään vain kertomaan sille puhelimelle, että poisto onnistui); nimeä, sähköpostia tai treenitietoja siinä ei ole. Palvelimen rutiinisiivous poistaa sen, kun 180 päivää on kulunut eikä se enää voi päättää mitään. Siivous ajetaan, kun joku kirjautuu Applella, joten siinä voi mennä hieman pidempään.',
      'Valmentajan kysymykset, kuvaukset ja kuvat: emme säilytä niitä, ellet ole antanut lupaa. Luvan kanssa enintään 24 kuukautta tai siihen asti kun peruutat luvan, kumpi tulee ensin. Anthropic poistaa oman kopionsa 30 päivän kuluessa joka tapauksessa.',
      'Käyttötilastot, virheraportit mukaan lukien: enintään 24 kuukautta, sen jälkeen automaattinen poisto.',
      'Palautesähköpostit: niin kauan kuin niiden käsittely vaatii.',
    ],
  },
  {
    heading: 'Oikeutesi',
    body: [
      'Tietosuoja-asetuksen mukaan sinulla on oikeus nähdä sinusta säilyttämämme tiedot, korjata ne, poistaa ne, ottaa ne mukaasi, peruuttaa antamasi suostumus ja vastustaa oikeutettuun etuumme perustuvaa käsittelyä.',
      'Suurimman osan näistä teet itse sovelluksessa keneltäkään kysymättä. Muissa kirjoita meille — vastaamme kuukauden kuluessa.',
    ],
    bullets: [
      'Näe ne: Asetukset → Omat tiedot näyttää profiilisi ja Kehitys lokisi. Pilvivarmuuskopio on sama data, joten meidän puolellamme ei ole mitään lisää näytettävää.',
      'Korjaa ne: muokkaa profiiliasi tai mitä tahansa kirjattua treeniä tai merkintää.',
      'Poista ne: Asetukset → Nollaa kaikki tiedot tyhjentää puhelimen, Asetukset → Poista pilvivarmuuskopio tyhjentää palvelinkopion ja Asetukset → Poista tili tyhjentää palvelinkopion ja ne valmentajan kopiot, joiden säilyttämisen olit sallinut, ja kirjaa sinut ulos. Sovelluksen poistaminen poistaa myös puhelimen kopion. Käyttötilastoja ei voi jäljittää sinuun, joten niistä ei löydy mitään sinun.',
      'Ota ne mukaasi: Asetukset → Vie ohjelma (CSV) lähettää ohjelmasi tai jokaisen kirjatun sarjan CSV-tekstinä valitsemaasi sovellukseen.',
      'Peruuta suostumus tai vastusta: poista pilvivarmuuskopio ja kirjaudu ulos; lakkaa lähettämästä kysymyksiä valmentajalle; kytke käyttötilastot pois asetuksista.',
      `Valita: kirjoita ensin osoitteeseen ${LEGAL_ENTITY.email}, jotta voimme korjata asian. Sinulla on myös oikeus tehdä valitus tietosuojaviranomaiselle — Suomessa tietosuojavaltuutetun toimistolle, tietosuoja.fi tai tietosuoja@om.fi.`,
    ],
  },
  {
    heading: 'Lapset',
    body: [
      'Vinhaa ei ole tarkoitettu alle 16-vuotiaille, emmekä tietoisesti käsittele heidän tietojaan. Koska meille ei tule mitään nimen kanssa, emme voi erottaa lapsen tietoja kenenkään muun tiedoista — jos uskot lapsen kirjautuneen pilvivarmuuskopioon, kirjoita meille, niin poistamme sen.',
    ],
  },
  {
    heading: 'Muutokset tähän selosteeseen',
    body: [
      'Jos tämä seloste muuttuu tavalla, joka vaikuttaa sinuun, sovellus näyttää muutoksen ennen kuin se astuu voimaan. Yläreunan päiväys kertoo aina, minkä version luet, ja aiemmat versiot saa pyynnöstä.',
    ],
  },
];

const termsEn = (p: LegalPlatform): LegalSection[] => [
  {
    heading: 'The short version',
    body: [
      'Vinha is a training app. It suggests programmes, tracks what you lift, and has a coach that reads your numbers. It is not a doctor, a physiotherapist or a personal trainer standing next to you, and it cannot see your form or how you feel today. You decide what is safe to lift.',
      'By installing or using Vinha you accept these terms. If you do not accept them, do not use the app.',
    ],
  },
  {
    heading: 'Who provides the service',
    body: [
      `Vinha is provided by ${publisher('en')}. Contact: ${LEGAL_ENTITY.email}. How we handle your data is described in the privacy policy, which is part of these terms.`,
    ],
  },
  {
    heading: 'Age',
    body: [
      'You must be at least 16 years old to use Vinha. The app is built around adult strength training and is not designed for children.',
    ],
  },
  {
    heading: 'Your licence to use the app',
    body: [
      'You get a personal, non-exclusive, non-transferable right to use Vinha for your own training, on devices you control. That right lasts as long as you follow these terms.',
    ],
  },
  {
    heading: 'Health and safety — read this one',
    body: [
      'Vinha gives general fitness information. It is not medical advice, and nothing in it diagnoses, treats or prevents any condition.',
      'Talk to a doctor before starting a training programme, especially if you are pregnant, recovering from an injury or illness, have a heart, joint or blood-pressure condition, or have not trained in a long time.',
      'Stop immediately if you feel pain, dizziness, chest tightness or shortness of breath, and get medical help.',
      'Weights are dangerous. You are responsible for your own technique, your warm-up, the equipment you use and the weight you choose. A weight the app suggests is a suggestion drawn from numbers you logged — it knows nothing about how you slept, what hurts today, or whether the bar is loaded correctly.',
      'The coach, in both of its modes, reads your logged numbers and writes about them. It is not a clinician, it does not know your medical history, and — especially in online mode, where a language model writes the answer — it can be confidently wrong. Treat it as a well-read training partner, not as a professional opinion, and check anything that matters.',
      'You train at your own risk.',
    ],
  },
  {
    heading: 'Your responsibilities',
    bullets: [
      'Enter your data honestly — the recommendations are only as good as what you log.',
      'Use the app for your own personal, non-commercial training.',
      'Do not rely on the app as your only source of health information.',
      'Keep your device secure. Anyone who can open your phone can see your training data.',
      'Only import programmes — as CSV or as a photo — that you have the right to use. What you import stays on your phone, and you are responsible for it.',
    ],
  },
  {
    heading: 'Your data, and the backups',
    body: [
      'Your training data lives on your phone. If you do not sign in, there is no copy of it anywhere we can reach, which means we cannot recover it for you if you lose your phone, uninstall the app or reset your data. Export your log as CSV from Settings whenever you want a copy of your own.',
      `If you sign in with ${pick(p, { android: 'Google', ios: 'Google or Apple', both: 'Google or Apple' })}, the optional cloud backup keeps one copy on our server so that a new phone can restore it. It is a convenience, not a guarantee: keep your own export of anything you cannot afford to lose. The backup can only be restored by signing in with the same account, so keep access to that account.`,
      'You own your data. We claim no rights to anything you log, build or import, and we use the backup for nothing except giving it back to you.',
    ],
  },
  {
    heading: 'Pro',
    bullets: [
      'The free version is a complete app: every ready-made programme, the full exercise library, unlimited logging, your progress, and export. It has limits on building — three programmes of your own, two in use at a time — and it shows trends and records over the most recent three months.',
      'Pro unlocks the features listed on the Pro page in the app at the time you buy it, including the coach’s online mode up to the monthly number of questions shown in the app. Pro can be a monthly subscription, a yearly subscription, or a one-time lifetime purchase.',
      `Payment is charged through ${pick(p, {
        android: 'Google Play',
        ios: 'the App Store',
        both: 'Google Play on Android and through the App Store on iPhone',
      })} at the price shown there when you confirm the purchase. We do not handle payments ourselves.`,
      `Subscriptions renew automatically unless you cancel at least 24 hours before the period ends. Cancel ${pick(p, {
        android: 'in Google Play',
        ios: 'in your Apple ID’s subscriptions',
        both: 'in Google Play on Android, or in your Apple ID’s subscriptions on iPhone',
      })} — the End membership screen in the app takes you there. Cancelling stops the next renewal; Pro stays on until the paid period ends.`,
      'Lifetime means use of the service for as long as Vinha is offered commercially and maintained. If the service is discontinued for good, the lifetime licence ends with it. It is a single payment with nothing to renew or cancel.',
      'When Pro ends, nothing you logged is lost. Your data, your programmes and your history stay; only the Pro features lock until Pro is on again.',
      `Refunds follow ${pick(p, {
        android: 'Google Play’s refund policy',
        ios: 'Apple’s refund policy, and are requested from Apple',
        both: 'the refund policy of the store you bought from — Google Play’s on Android, Apple’s on iPhone, where they are requested from Apple —',
      })} and your statutory consumer rights, including a right of withdrawal where the law gives you one. Pro starts the moment the purchase is confirmed, and by using it straight away you agree that the service begins at once.`,
      'Promo codes may be limited in time or number, can expire, and have no cash value.',
      `If a price changes, you will be told in advance through ${pick(p, {
        android: 'Google Play',
        ios: 'Apple',
        both: 'Google Play or Apple, whichever you bought from',
      })}, and the change never applies to a period you have already paid for.`,
    ],
  },
  {
    heading: 'Features that need our server',
    body: [
      'The coach’s online mode, the programme composer, the photo import and the cloud backup need our server, and the coach also needs Anthropic’s service. They may be slow, unavailable or withdrawn, and we may change the model or the provider behind them. When the server cannot answer, the app falls back to on-device answers or tells you it could not.',
      'To keep these features affordable for everyone, we may limit how often they can be used — for example the monthly number of coach questions, the size of an imported photo, or how many backups an account can send in a short time.',
      'The coach never changes your programme by itself. Every change to what you train is a change you make.',
    ],
  },
  {
    heading: 'What we promise, and what we do not',
    body: [
      'The app is provided as it is. We work to keep it accurate and available, but we do not promise it will be uninterrupted or error-free, or that it will produce any particular result. Strength, weight loss and muscle growth depend on far more than an app: sleep, food, consistency, genetics, stress and time.',
      'To the extent the law allows, our liability for any claim connected to the app is limited to what you paid for it in the twelve months before the claim. Nothing here limits liability that cannot be limited by law — including liability for death or personal injury caused by negligence, for fraud, or your mandatory rights as a consumer.',
      'We are not liable for delays or outages caused by things outside our control, such as power failures, network faults, problems at our service providers, or the actions of authorities.',
    ],
  },
  {
    heading: 'What belongs to whom',
    body: [
      'The app, its design, its ready-made programmes and its exercise library belong to us and are protected by copyright. You may not copy, resell, redistribute or reverse-engineer them.',
      'Your training data, the programmes you build and the notes you write are yours. We claim no ownership of anything you log.',
    ],
  },
  {
    heading: 'Things you may not do',
    bullets: [
      'Reverse-engineer, decompile or modify the app, or work around Pro.',
      'Resell, republish or redistribute the ready-made programmes or exercise content.',
      'Use automated tools to extract content from the app or to flood our server.',
      'Send the coach content that is unlawful, or that belongs to someone else without their permission.',
      'Use the app in any way that breaks the law.',
    ],
  },
  {
    heading: 'Changes and ending',
    body: [
      `We may update these terms as the app changes. Material changes are shown in the app before they take effect, and continuing to use Vinha after that means you accept them. If you do not, stop using the app — and if you have an active subscription, cancel it ${pick(p, {
        android: 'in Google Play',
        ios: 'in your Apple ID’s subscriptions',
        both: 'in the store you bought it from',
      })}.`,
      'You can stop at any time by uninstalling the app. Your data on the phone goes with it; the cloud backup stays until you delete it in Settings, where Delete account removes it and signs you out.',
      'We may end your access to the server features, or to the app, if you seriously breach these terms. We may also discontinue Vinha or its server features; if that happens, we will say so in the app in advance, and your data stays on your phone and exportable.',
    ],
  },
  {
    heading: 'Governing law and disputes',
    body: [
      'These terms are governed by Finnish law. This does not remove the mandatory consumer protection rights of the country where you live. If a dispute cannot be settled between us, a consumer in Finland can take it to the Consumer Disputes Board (kuluttajariita.fi) after first contacting the Consumer Advisory Service (kkv.fi).',
    ],
  },
];

const termsFi = (p: LegalPlatform): LegalSection[] => [
  {
    heading: 'Lyhyesti',
    body: [
      'Vinha on treenisovellus. Se ehdottaa ohjelmia, seuraa mitä nostat, ja siinä on valmentaja, joka lukee numeroitasi. Se ei ole lääkäri, fysioterapeutti eikä vieressä seisova personal trainer, eikä se näe tekniikkaasi tai sitä, miltä sinusta tänään tuntuu. Sinä päätät, mikä on turvallista nostaa.',
      'Asentamalla Vinhan tai käyttämällä sitä hyväksyt nämä ehdot. Jos et hyväksy niitä, älä käytä sovellusta.',
    ],
  },
  {
    heading: 'Kuka palvelun tarjoaa',
    body: [
      `Vinhan tarjoaa ${publisher('fi')}. Yhteystieto: ${LEGAL_ENTITY.email}. Se, miten käsittelemme tietojasi, kuvataan tietosuojaselosteessa, joka on osa näitä ehtoja.`,
    ],
  },
  {
    heading: 'Ikäraja',
    body: [
      'Sinun on oltava vähintään 16-vuotias käyttääksesi Vinhaa. Sovellus on rakennettu aikuisten voimaharjoittelun ympärille, eikä sitä ole suunniteltu lapsille.',
    ],
  },
  {
    heading: 'Käyttöoikeutesi',
    body: [
      'Saat henkilökohtaisen, ei-yksinomaisen ja siirtokelvottoman oikeuden käyttää Vinhaa omaan treenaamiseesi laitteilla, jotka ovat hallinnassasi. Oikeus on voimassa niin kauan kuin noudatat näitä ehtoja.',
    ],
  },
  {
    heading: 'Terveys ja turvallisuus — lue tämä',
    body: [
      'Vinha antaa yleistä kuntoilutietoa. Se ei ole lääketieteellistä neuvontaa, eikä mikään siinä diagnosoi, hoida tai ehkäise mitään sairautta.',
      'Keskustele lääkärin kanssa ennen treeniohjelman aloittamista, erityisesti jos olet raskaana, toivut vammasta tai sairaudesta, sinulla on sydän-, nivel- tai verenpaineongelma tai et ole treenannut pitkään aikaan.',
      'Lopeta heti, jos tunnet kipua, huimausta, puristusta rinnassa tai hengenahdistusta, ja hakeudu lääkäriin.',
      'Painot ovat vaarallisia. Vastaat itse tekniikastasi, lämmittelystäsi, käyttämistäsi välineistä ja valitsemastasi painosta. Sovelluksen ehdottama paino on ehdotus, joka perustuu kirjaamiisi numeroihin — se ei tiedä mitään siitä, miten nukuit, mihin sattuu tänään tai onko tanko ladattu oikein.',
      'Valmentaja lukee kummassakin tilassaan kirjaamiasi numeroita ja kirjoittaa niistä. Se ei ole terveydenhuollon ammattilainen, se ei tunne sairaushistoriaasi, ja — erityisesti verkkotilassa, jossa vastauksen kirjoittaa kielimalli — se voi olla varmalla äänellä väärässä. Suhtaudu siihen lukeneena treenikaverina, älä ammattilaisen lausuntona, ja tarkista kaikki, millä on merkitystä.',
      'Treenaat omalla vastuullasi.',
    ],
  },
  {
    heading: 'Sinun vastuusi',
    bullets: [
      'Syötä tietosi rehellisesti — suositukset ovat vain niin hyviä kuin se, mitä kirjaat.',
      'Käytä sovellusta omaan henkilökohtaiseen, ei-kaupalliseen treenaamiseen.',
      'Älä käytä sovellusta ainoana terveystiedon lähteenäsi.',
      'Pidä laitteesi turvassa. Kuka tahansa, joka saa puhelimesi auki, näkee treenitietosi.',
      'Tuo sovellukseen — CSV:nä tai valokuvana — vain ohjelmia, joihin sinulla on käyttöoikeus. Tuomasi sisältö pysyy puhelimessasi, ja vastaat siitä itse.',
    ],
  },
  {
    heading: 'Tietosi ja varmuuskopiot',
    body: [
      'Treenitietosi ovat puhelimessasi. Jos et kirjaudu sisään, niistä ei ole missään kopiota, johon me pääsisimme käsiksi — emme siis voi palauttaa niitä sinulle, jos hukkaat puhelimesi, poistat sovelluksen tai nollaat tietosi. Vie lokisi CSV-muodossa asetuksista aina, kun haluat oman kopion.',
      `Jos kirjaudut ${pick(p, { android: 'Googlella', ios: 'Googlella tai Applella', both: 'Googlella tai Applella' })}, vapaaehtoinen pilvivarmuuskopio pitää yhden kopion palvelimellamme, jotta uusi puhelin voi palauttaa sen. Se on apu, ei takuu: pidä oma vientisi kaikesta, mitä et voi menettää. Varmuuskopion voi palauttaa vain kirjautumalla samalla tilillä, joten pidä pääsy siihen tiliin tallessa.`,
      'Tietosi ovat sinun. Emme vaadi oikeuksia mihinkään, mitä kirjaat, rakennat tai tuot, emmekä käytä varmuuskopiota mihinkään muuhun kuin sen palauttamiseen sinulle.',
    ],
  },
  {
    heading: 'Pro',
    bullets: [
      'Ilmainen versio on kokonainen sovellus: jokainen valmis ohjelma, koko liikekirjasto, rajaton kirjaus, kehityksesi ja vienti. Rakentamisella on rajat — kolme omaa ohjelmaa, kaksi käytössä kerrallaan — ja trendit ja ennätykset näytetään viimeisimmän kolmen kuukauden ajalta.',
      'Pro avaa ne ominaisuudet, jotka on lueteltu sovelluksen Pro-sivulla ostohetkellä, mukaan lukien valmentajan verkkotilan sovelluksessa näytettyyn kuukausittaiseen kysymysmäärään asti. Pro voi olla kuukausitilaus, vuositilaus tai kertaostona elinikäinen.',
      `Maksu veloitetaan ${pick(p, {
        android: 'Google Playn kautta',
        ios: 'App Storen kautta',
        both: 'Androidilla Google Playn kautta ja iPhonella App Storen kautta',
      })} siellä ostoa vahvistettaessa näkyvällä hinnalla. Emme käsittele maksuja itse.`,
      `Tilaus uusiutuu automaattisesti, ellet peruuta sitä vähintään 24 tuntia ennen kauden päättymistä. Peruuta ${pick(p, {
        android: 'Google Playssä',
        ios: 'Apple ID:si tilauksissa',
        both: 'Androidilla Google Playssä tai iPhonella Apple ID:si tilauksissa',
      })} — sovelluksen Lopeta jäsenyys -ruutu vie sinut sinne. Peruutus lopettaa seuraavan uusiutumisen; Pro pysyy päällä maksetun kauden loppuun.`,
      'Elinikäinen tarkoittaa palvelun käyttöä niin kauan kuin Vinhaa tarjotaan kaupallisesti ja sitä ylläpidetään. Jos palvelu lopetetaan pysyvästi, elinikäinen käyttöoikeus päättyy samalla. Se on kertamaksu, jossa ei ole mitään uusittavaa tai peruttavaa.',
      'Kun Pro päättyy, mitään kirjaamaasi ei menetetä. Tietosi, ohjelmasi ja historiasi säilyvät; vain Pro-ominaisuudet menevät lukkoon, kunnes Pro on taas päällä.',
      `Palautukset noudattavat ${pick(p, {
        android: 'Google Playn palautuskäytäntöä',
        ios: 'Applen palautuskäytäntöä, ja ne pyydetään Applelta',
        both: 'sen sovelluskaupan palautuskäytäntöä, josta ostit — Androidilla Google Playn ja iPhonella Applen, jolta palautukset pyydetään —',
      })} ja lakisääteisiä kuluttajaoikeuksiasi, mukaan lukien peruuttamisoikeus silloin, kun laki sen sinulle antaa. Pro alkaa heti, kun osto on vahvistettu, ja ottamalla sen heti käyttöön hyväksyt, että palvelu alkaa välittömästi.`,
      'Kampanjakoodit voivat olla aika- tai määrärajattuja, ne voivat vanheta, eikä niillä ole rahallista arvoa.',
      `Jos hinta muuttuu, saat siitä tiedon etukäteen ${pick(p, {
        android: 'Google Playn kautta',
        ios: 'Applen kautta',
        both: 'sovelluskaupan kautta, josta ostit (Google Play tai App Store)',
      })}, eikä muutos koskaan koske jo maksamaasi kautta.`,
    ],
  },
  {
    heading: 'Toiminnot, jotka tarvitsevat palvelimemme',
    body: [
      'Valmentajan verkkotila, ohjelmakoostaja, kuvatuonti ja pilvivarmuuskopio tarvitsevat palvelimemme, ja valmentaja tarvitsee lisäksi Anthropicin palvelua. Ne voivat olla hitaita, poissa käytöstä tai ne voidaan lopettaa, ja voimme vaihtaa niiden takana olevaa mallia tai palveluntarjoajaa. Kun palvelin ei voi vastata, sovellus palaa laitteella muodostettuihin vastauksiin tai kertoo, ettei se onnistunut.',
      'Jotta nämä toiminnot pysyvät kohtuuhintaisina kaikille, voimme rajoittaa niiden käyttötiheyttä — esimerkiksi valmentajan kysymysten kuukausimäärää, tuotavan kuvan kokoa tai sitä, montako varmuuskopiota tili voi lähettää lyhyessä ajassa.',
      'Valmentaja ei koskaan muuta ohjelmaasi itse. Jokainen muutos siihen, mitä treenaat, on sinun tekemäsi.',
    ],
  },
  {
    heading: 'Mitä lupaamme ja mitä emme',
    body: [
      'Sovellus tarjotaan sellaisena kuin se on. Teemme työtä pitääksemme sen paikkansapitävänä ja saatavilla, mutta emme lupaa, että se toimii keskeytyksettä tai virheettömästi, emmekä lupaa mitään tiettyä tulosta. Voima, painonpudotus ja lihaskasvu riippuvat paljon muustakin kuin sovelluksesta: unesta, ruoasta, säännöllisyydestä, perimästä, stressistä ja ajasta.',
      'Siinä määrin kuin laki sallii, vastuumme sovellukseen liittyvistä vaatimuksista rajoittuu siihen, mitä olet siitä maksanut vaatimusta edeltäneiden 12 kuukauden aikana. Mikään tässä ei rajoita vastuuta, jota ei lain mukaan voi rajoittaa — mukaan lukien vastuu huolimattomuudesta aiheutuneesta kuolemasta tai henkilövahingosta, petoksesta tai pakottavista kuluttajaoikeuksistasi.',
      'Emme vastaa viivästyksistä tai palvelukatkoista, jotka johtuvat vaikutusmahdollisuuksiemme ulkopuolella olevista syistä, kuten sähkökatkoista, verkkohäiriöistä, palveluntarjoajien ongelmista tai viranomaistoimista.',
    ],
  },
  {
    heading: 'Kenelle mikäkin kuuluu',
    body: [
      'Sovellus, sen ulkoasu, valmiit ohjelmat ja liikekirjasto kuuluvat meille ja ovat tekijänoikeuden suojaamia. Niitä ei saa kopioida, jälleenmyydä, levittää eikä purkaa takaisinmallinnuksella.',
      'Treenitietosi, rakentamasi ohjelmat ja kirjoittamasi muistiinpanot ovat sinun. Emme väitä omistavamme mitään, mitä kirjaat.',
    ],
  },
  {
    heading: 'Mitä et saa tehdä',
    bullets: [
      'Takaisinmallintaa, purkaa tai muokata sovellusta tai kiertää Pro-lukkoa.',
      'Jälleenmyydä, julkaista uudelleen tai levittää valmiita ohjelmia tai liikesisältöä.',
      'Käyttää automaattisia työkaluja sisällön poimimiseen sovelluksesta tai palvelimemme kuormittamiseen.',
      'Lähettää valmentajalle sisältöä, joka on lainvastaista tai kuuluu jollekulle muulle ilman tämän lupaa.',
      'Käyttää sovellusta lainvastaisella tavalla.',
    ],
  },
  {
    heading: 'Muutokset ja päättyminen',
    body: [
      `Voimme päivittää näitä ehtoja sovelluksen muuttuessa. Olennaiset muutokset näytetään sovelluksessa ennen voimaantuloa, ja käytön jatkaminen sen jälkeen tarkoittaa, että hyväksyt ne. Jos et hyväksy, lopeta sovelluksen käyttö — ja jos sinulla on voimassa oleva tilaus, peruuta se ${pick(p, {
        android: 'Google Playssä',
        ios: 'Apple ID:si tilauksissa',
        both: 'siinä sovelluskaupassa, josta ostit',
      })}.`,
      'Voit lopettaa milloin tahansa poistamalla sovelluksen. Puhelimessa olevat tietosi lähtevät sen mukana; pilvivarmuuskopio säilyy, kunnes poistat sen asetuksista (Poista tili poistaa sen ja kirjaa sinut ulos).',
      'Voimme päättää pääsysi palvelintoimintoihin tai sovellukseen, jos rikot näitä ehtoja vakavasti. Voimme myös lopettaa Vinhan tai sen palvelintoiminnot; jos niin käy, kerromme siitä sovelluksessa etukäteen, ja tietosi säilyvät puhelimessasi ja vietävissä.',
    ],
  },
  {
    heading: 'Sovellettava laki ja riidat',
    body: [
      'Näihin ehtoihin sovelletaan Suomen lakia. Tämä ei poista asuinmaasi pakottavia kuluttajansuojaoikeuksia. Jos riitaa ei saada sovittua keskenämme, Suomessa asuva kuluttaja voi viedä sen kuluttajariitalautakuntaan (kuluttajariita.fi) oltuaan ensin yhteydessä kuluttajaneuvontaan (kkv.fi).',
    ],
  },
];

const TITLES: Record<LegalDocumentId, Record<AppLanguage, { title: string; summary: string }>> = {
  privacy: {
    en: {
      title: 'Privacy policy',
      summary: 'What Vinha stores, what leaves your phone, and what you can do about it.',
    },
    fi: {
      title: 'Tietosuojaseloste',
      summary: 'Mitä Vinha tallentaa, mikä lähtee puhelimestasi ja mitä voit sille tehdä.',
    },
  },
  terms: {
    en: {
      title: 'Terms of service',
      summary: 'The rules for using Vinha: the health warning, how Pro billing works, and what we promise.',
    },
    fi: {
      title: 'Käyttöehdot',
      summary: 'Vinhan käytön säännöt: terveysvaroitus, miten Pro-laskutus toimii ja mitä lupaamme.',
    },
  },
};

/**
 * The documents' date as a reader writes it: 16.9.2026, or 16 September 2026.
 * Shared with the consent sheet, which names the date the documents changed.
 */
export function formatLegalDate(language: AppLanguage): string {
  const [year, month, day] = LEGAL_LAST_UPDATED.split('-');
  if (language === 'fi') return `${Number(day)}.${Number(month)}.${year}`;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}

/** dd.mm.yyyy in Finnish, ISO-ish long form in English. */
function formatUpdated(language: AppLanguage): string {
  return language === 'fi' ? `Päivitetty ${formatLegalDate(language)}` : `Updated ${formatLegalDate(language)}`;
}

/**
 * The document for one reader's phone. Without a platform it is the
 * published one, which covers both stores.
 */
export function buildLegalDocument(
  id: LegalDocumentId,
  language: AppLanguage,
  platform: LegalPlatform = 'both',
): LegalDocument {
  const sections =
    id === 'privacy'
      ? language === 'fi'
        ? privacyFi(platform)
        : privacyEn(platform)
      : language === 'fi'
        ? termsFi(platform)
        : termsEn(platform);
  const meta = TITLES[id][language];
  return {
    id,
    title: meta.title,
    summary: meta.summary,
    updatedLabel: formatUpdated(language),
    sections,
  };
}

/** Markdown rendering, shared by the in-app screen's source of truth and the web export. */
export function renderLegalDocumentMarkdown(document: LegalDocument): string {
  const lines: string[] = [`# ${document.title}`, '', `*${document.updatedLabel}*`, '', document.summary, ''];
  for (const section of document.sections) {
    lines.push(`## ${section.heading}`, '');
    for (const paragraph of section.body ?? []) lines.push(paragraph, '');
    for (const bullet of section.bullets ?? []) lines.push(`- ${bullet}`);
    if (section.bullets?.length) lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
