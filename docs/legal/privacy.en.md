# Privacy policy

*Updated 9 October 2026*

What Vinha stores, what leaves your phone, and what you can do about it.

## The short version

Vinha stores your training data on your phone. This policy lists what the app sends to our server, when, and why.

At present that is four things. The optional cloud backup is sent when you sign in with Google or Apple, and the AI coach’s online mode when you read a notice and then send a question, ask for a programme, or import one from a photo. Anonymous usage statistics are sent by the app itself unless you switch them off in Settings — they carry no content and no identity, and they are described in full below. Each of these requests also carries the app’s version number and whether the phone runs Android or iOS, so our server can recognise an app too old to understand and ask you to update it.

The fourth is a check the app makes by itself: when it starts, and again when you come back to it after some hours, it asks our server whether there is a notice for everyone who uses Vinha — for example about a break in service or a security incident — and shows it once. That request carries nothing but the app’s version and platform; like any request, it shows our server the phone’s internet address, and nothing about it is stored.

No ads, no trackers, no selling of data. If something in this policy is unclear, write to us — the address is in the next section.

## Who is responsible

Styxon Studio (sole trader Santeri Ylönen, business ID 3321575-3, Finland) publishes Vinha Fitness (“Vinha”) and is the data controller — the one responsible for how your data is handled — for everything described in this policy.

Questions about this policy or your data: privacy@vinha.app.

## What the app stores on your phone

Everything below is either entered by you or worked out by the app from what you entered. It is kept in the app’s own storage on your phone.

- Your profile from setup: gender, age, height, weight, goals, experience level, days per week, equipment, the areas you want to focus on, and any injuries or limitations you ticked.
- Your training log: workouts and cardio sessions with their exercises, sets, reps, weights, notes, dates, durations and how the session felt.
- Body data you add yourself: weight entries and tape measurements.
- Your programmes: the ones you build, import from a CSV file or a photo, and the exercise names you teach the app.
- Goals you set with the coach, and the milestones and seasons the app counts from your log.
- What the coach has advised you in the last three weeks: the one-sentence summary of each answer and the date it was given, at most ten of them. It is kept so the coach does not repeat advice you have already had, it is deleted as it ages past three weeks, and it stays on this phone — the cloud backup below does not carry it.
- Preferences: language, units, theme, notification and sound settings, default rest time, training breaks.
- Pro status: whether Pro is on, when it was bought or cancelled, and the dates until which a promo code or a free trial keeps it on.
- Small bookkeeping: whether the rating prompt or the online-coach notice has been shown, the summary file the home-screen widget reads, the queue of usage events waiting to be sent, a marker that the coach’s advice memory still needs erasing after a restore if a first attempt could not reach the disk, a copy of a damaged data file if the app ever finds one, and your workout in progress with the numbers remembered from earlier workouts if the app keeps crashing and you choose to put them aside — these are set aside rather than deleted, so a broken file is not a lost training log.

## Android backup

Android’s own backup is switched off for this app. Your phone does not copy Vinha’s data into your Google account’s backup, and it does not hand it to a new phone during the device-to-device transfer at setup. Nothing of your training log leaves the phone that way.

That means a new phone starts empty unless you use the cloud backup below, or export your log as CSV first. It is off so that the app’s own backup below, which you switch on yourself, is the only place your full training log is kept outside this phone.

## iPhone backup

On iPhone the app’s data is not left out of the phone’s own backup. If iCloud Backup is switched on, or you back the phone up to a computer, Vinha’s data goes into that backup together with the data of your other apps, and comes back with it when you set up a phone from it. That backup is made and kept by Apple or on your own computer, under Apple’s terms. We do not make it, cannot see it and cannot delete it.

If you would rather Vinha’s training log is not in it, you can leave Vinha out of an iCloud backup in your iPhone’s iCloud settings, or switch iCloud Backup off. The cloud backup below is separate: it is the only copy of your training log that we hold.

## Cloud backup (optional)

If you sign in with Google or Apple, a copy of everything listed under “What the app stores on your phone” — except a workout still in progress — is sent over an encrypted connection to our server and kept there, so a new phone can restore it after you sign in again. Signing in is never required; every feature works without it.

From Google we receive your Google account’s identifier, your email address and your name. These stay on your phone, so the app can show which account is signed in. On the server the backup is filed under a scrambled version of the identifier; your email and name are not stored there. When you sign out, the phone keeps only the identifiers of the accounts that signed out of it, so that if a different Google account signs in next, the app asks before backing up the data already on the phone to it; they are removed once that sign-in is settled.

On iPhone you can sign in with Apple instead. From Apple we receive an identifier for your Apple ID that only Vinha gets, and the first time only, the name and email you choose to share — the email can be a private relay address that Apple forwards. They stay on your phone like Google’s. The phone trades Apple’s sign-in once for a sign-in of our own, kept on the phone, that lasts up to 180 days and is checked on every backup request; before using it, the phone asks Apple whether you have stopped using your Apple ID with Vinha, and signs you out if you have. Deleting your account (below) does not take Vinha off the list of apps you use Sign in with Apple with; you can remove it there yourself, in your iPhone’s Apple ID settings.

A backup is sent shortly after you log training, and whenever you press Back up now. The server checks your sign-in on every request, stores the file, and hands it back only to the same account. It does not read, analyse or log the contents.

The backup is stored by Vercel, our hosting provider, in the European Union. It is kept until you delete it.

Settings → Delete cloud backup removes the server copy immediately. Signing out does not delete it, and neither does resetting the phone’s data — a reset signs you out first, precisely so that an empty backup never overwrites a full one. The copy waits until you sign in again. If you can no longer open the app, delete a Google account without it at styxon.fi/vinha-fitness/legal/delete-account.en: you sign in with Google on that page, and it deletes the server copy as Delete account does. The coach copies described below are filed under your phone, not your account, so that page cannot reach them; they are deleted automatically within 24 months. You can also sign in on any phone with the same account and delete it there.

Settings → Delete account does the same and more: it deletes the server copy, signs you out on this phone, asks our server to delete any copies the AI coach kept for you (only if you had allowed that, as described under “The AI coach”), and ends the sign-in our own server gave an Apple account: your other phones signed in with Apple are signed out at their next request to our server, and a sign-in made with Apple before the deletion can no longer be used to start a new one. The training data on this phone stays; Reset all data clears that separately. The anonymous usage statistics are not tied to your account, so deleting it does not delete them; they are kept for up to 24 months, as described under “Usage statistics”. Apart from those, our server holds nothing of yours afterwards except, for an Apple account, one scrambled marker with a date, which says that sign-ins made before it have ended, so that an old sign-in cannot be used again. It also holds a random number your phone made for that request, used only to tell that phone its deletion went through. It holds no name, email or training data.

Settings → Reset all data deletes everything on this phone and signs you out. It keeps the cloud backup, which waits for you as described above, and it keeps your answer about usage statistics: if you had switched them off, they stay off.

## The AI coach

The coach has two modes. In on-device mode, the default, answers are put together on your phone from your own log, and nothing leaves the device — not the question, not the answer.

In online mode, which a version of the app switches on, the app shows you a notice before your first question, and nothing is sent until you have read it. After that, each question you send carries three things: the question, the earlier messages of the same conversation, and a summary of your training.

The summary contains your recent workouts (exercise names, sets, reps, kilograms, dates, durations), your current programme and its week, your goals, your setup answers (goal, level, days per week, equipment, limitations), the coach’s own answers from the last three weeks in one sentence each, so it does not repeat advice you have already had, and — if you have logged them — your latest weight, tape measurements, height, age and gender.

It does not contain your name, your email, your Google account or any identifier of your phone. The question cannot be tied to you. Our server sees the phone’s internet address, which it holds briefly in memory to limit how many requests one connection can make; it is not stored.

Our server forwards the question to Anthropic, the company behind the Claude model, which writes the answer in the United States. Under Anthropic’s commercial terms the data is not used to train its models and is deleted within 30 days.

We keep no copy of our own unless you have said we may. The coach asks once, before your first question, in three separate lines: your questions and answers, the programmes you ask it to build, and the photos you import one from. Every line starts as no, each is its own answer, and none of them changes the answer you get. What you allow is kept for up to 24 months and then deleted automatically, and it is used for one thing: making the coach better at writing programmes.

You can take it back at any time in Settings, and taking it back deletes what was already kept. Turning any one line off removes every copy kept for you from our server — including those made under the lines you leave on — rather than only stopping new ones.

The programme composer works the same way: when you ask the app to build a programme from a written brief, the brief and the same summary are sent along the same route.

Importing a programme from a photo also uses this route. The photo you picked is scaled down and sent so the table in it can be read; it is used for that one import and is not kept — unless you ticked the photos line above, in which case the photo and the table read from it are kept like any other allowed copy.

Under each answer the online coach writes there is a Report link. If you use it, the answer you reported and the reason you picked are sent to us so that a person can review it — not your question, and nothing that identifies you. The report reaches us through Slack, the messaging service we review reports in, and is deleted once it has been dealt with, at the latest after 24 months.

## Usage statistics

To see whether the app works — for example whether some step of the setup is so hard that people give up there — the app sends anonymous usage events to our own server.

An event is a name and a time, plus for setup steps the step number and which path you took, and for an error report the details listed below. Never the content: no exercise name, no weight, no measurement, no question text. The full list of events is fixed in the app’s code, and the server refuses anything outside it.

If something goes wrong, the app also sends an error report, as one more of these events: a crash, an error on a screen, or a save, backup, restore, sign-in, account deletion or opening your saved data that did not work. What is sent: the type of error, where in the app’s code it happened (a position in the program, not what it was working on), which screen you were on, the app version, which operating system the phone runs and, for a failed save, backup or similar, which one failed and a short code such as “network” or “storage full”. Never sent: error messages, your training data, names, notes or anything you typed — error messages can contain exactly such things, so they are not collected at all. A crash is noted on the phone as it happens and sent the next time the app is opened. Error reports follow the same switch, go only to our own server and are kept for the same time as the other events.

Each install gets a random identifier, generated on your phone. It is not connected to your name, email, Google account or any advertising identity, and it resets if you reinstall the app.

The events go to our own server and nowhere else. They are kept for up to 24 months and then deleted automatically, and they are not shared, not sold and not used for advertising. You can switch them off at any time in Settings → Usage statistics; the app then sends nothing and throws away whatever was waiting to be sent. These are the events:

- The app was opened.
- A setup step was reached, and which one.
- Setup was finished, and whether you built a programme or picked a ready one.
- A programme was taken into use.
- A workout was started.
- A workout was saved.
- The Pro page was viewed.
- A question was sent to the coach — the fact that one was sent, never the text.
- The app failed or something did not work: an error report, as described above.

## Who helps us run this

We run no servers of our own. Five companies process data for us, under contracts that bind them to handle it only on our instructions and only for the purposes described here.

- Vercel (United States): runs our server and stores the cloud backups and the usage events. The storage is in the European Union.
- Anthropic (United States): answers coach questions, composes programmes and reads programme photos, as described above.
- Google (United States): verifies your Google sign-in and, on Android, handles Google Play payments. Your relationship with Google is covered by Google’s own privacy policy.
- Apple (United States): on iPhone, verifies your Apple sign-in and handles App Store payments. Your relationship with Apple is covered by Apple’s own privacy policy.
- RevenueCat (United States): manages your Pro purchase for us. It receives an anonymous purchase id, your Google Play or App Store purchase record and basic app and device information (app version, operating system, store country). It never receives your name, email or card details.
- Slack (United States): delivers the coach answers you report to us for review, as described above.

## Data outside the European Union

Where data goes outside the European Union — the coach traffic to Anthropic, the answers you report to Slack, your purchase record at RevenueCat, and possibly Vercel’s processing —the transfer rests on the European Commission’s standard contractual clauses, which are part of each provider’s data processing agreement with us.

## Why we may process your data

The GDPR requires a lawful basis for each kind of processing. These are ours.

- Providing the app you asked for (contract): keeping your data on your phone, running Pro, and showing you your own history.
- Your consent: the cloud backup (you sign in), the coach’s online mode (you read the notice and send a question), the programme composer and the photo import (you ask for them), and reporting an answer (you send the report). Training and body data count as health data, so whenever they leave your phone we rely on your explicit consent. You can withdraw it at any time: delete the backup and sign out, and simply stop sending questions.
- Our legitimate interest: the anonymous usage statistics, so we can see where the app fails people, the brief rate limiting that protects the server from abuse, the app version on each request, so the server can ask an outdated app to update, and, once you delete your account, the marker that stops an old sign-in from being used again. You can object by switching the statistics off in Settings, or by writing to us.
- Legal obligations: none of ours involve your personal data today. Google Play (on Android) and Apple through the App Store (on iPhone) handle the payment for Pro and keep the purchase records; the sales reports we receive from them contain no personal data.

## What the app does not do

- No third-party analytics and no crash-reporting tools from other companies. The only usage data is the anonymous statistics described above, error reports included, sent to our own server and no one else.
- No ads, no ad networks, no advertising identifier.
- No trackers and no social media components. There is no feed, no followers and no public profile.
- No access to your location, contacts, microphone, camera or files. A photo is read only when you pick one yourself, through the phone’s own picker, and only that photo.
- No advertising profile. The app does tailor programmes and suggestions from your answers and your log, but that happens on your phone, and nothing is decided about you automatically in a way that has legal or similar effects.
- No selling, renting or sharing of your data with anyone, beyond the providers named above who work for us.
- No account needed. Sign-in exists only to key the optional cloud backup.
- No cookies in the app. The app is not a web page and does not open one inside itself, so none are set and none are read. Our web pages set none either. On the page for deleting an account without the app (above), the Sign in with Google button is Google’s own, loaded from Google when the page opens, and Google can set and read its own cookies for that sign-in under Google’s privacy policy.

## Permissions the app asks for

The app asks your phone for very little. What it does use:

- Notifications: asked the first time a rest timer needs to alert you, or when you switch notifications on in Settings. Refuse, and everything else keeps working.
- Photos: the phone’s own picker hands the app the one photo you chose. No permission to your photo library is asked.
- Internet: for the server features described in this policy — at present backup, coach, statistics and notices. Logging a workout never needs a connection.
- Keeping the screen on during a workout, if you switch that on in Settings.
- Vibration, for the haptic ticks — which you can switch off.

## Notifications

Notifications come in three groups: while you train (the rest timer and the live session), wins and recaps after a workout, and reminders such as a weigh-in day or a training day. Every one of them is scheduled on your phone by the app itself. They are not push notifications: no server is involved and no device token exists.

Turn any group, or all of them, off in Settings → Notifications, or in your phone’s own notification settings.

## Payments

If you buy Pro, the payment is handled entirely by Google Play on Android and by Apple through the App Store on iPhone. We never see your card number, billing address or any payment detail. The app learns only whether Pro is active, which plan, and until when.

The free trial costs nothing: starting it writes one date on your phone, Pro runs until that date and then stops on its own. Nothing is charged when it ends, nothing is sent anywhere, and no card is asked for. If you have notifications on, the app reminds you two days before it runs out; that reminder is written and shown by your phone, not by us.

## Feedback, rating and sharing

Send feedback opens your own mail app with our address and the app version filled in. You decide what to write. We then see your email address and your message, and keep them only as long as it takes to handle the feedback.

Rate Vinha opens the app’s page on Google Play on Android, and Apple’s review prompt or the app’s page on the App Store on iPhone. The app itself sends nothing.

Exporting a programme or your training log as CSV, and inviting a friend, go through your phone’s share menu to the app you pick. We never see where they go.

## Security

Everything that leaves your phone travels over an encrypted connection. On the server, every backup request is checked against your sign-in before anything is read or written, backups are filed under a scrambled identifier in private storage, training data is never written to logs, and request rates are limited.

On your phone, the app’s data is protected by the phone’s own lock and the separation Android and iOS keep between apps; the app adds no encryption of its own. Anyone who can unlock your phone can open Vinha and see your training data, so keep the phone locked.

## How long we keep it

- On your phone: until you reset the app’s data or uninstall it.
- Android backup: nothing to keep — Android’s own backup is switched off for this app.
- iPhone backup: if iCloud Backup or a computer backup is switched on, the app’s data is kept in it for as long as Apple, or you, keep that backup — under Apple’s terms, not ours.
- Cloud backup: until you delete it in Settings, or ask us to.
- The marker left by Delete account on an Apple account: one scrambled marker with a date and a random number your phone made for the deletion request (used only to tell that phone its deletion went through), with no name, email or training data. The server’s routine clean-up removes it once 180 days have passed and it can no longer end anything. That clean-up runs when someone signs in with Apple, so it can take a little longer.
- Coach questions, briefs and photos: not kept by us unless you allowed it, and then for up to 24 months or until you take the permission back, whichever comes first. Anthropic deletes its own copy within 30 days either way.
- Usage statistics, error reports included: up to 24 months, then deleted automatically.
- Feedback emails: as long as it takes to handle them.

## Your rights

Under the GDPR you have the right to see the data we hold about you, to correct it, to delete it, to take it with you, to withdraw a consent you gave, and to object to processing based on our legitimate interest.

Most of these you exercise yourself, inside the app, without asking anyone. For the rest, write to us — we answer within a month.

- See it: Settings → My data shows your profile, and Progress shows your log. The cloud backup is the same data, so there is nothing more on our side to show.
- Correct it: edit your profile, or any logged session or entry.
- Delete it: Settings → Reset all data clears the phone, Settings → Delete cloud backup clears the server copy, and Settings → Delete account clears the server copy and any coach copies you had allowed us to keep, and signs you out. Uninstalling the app removes the phone copy too. Usage statistics cannot be traced back to you, so there is nothing of yours to find in them.
- Take it with you: Settings → Export plan (CSV) sends your programme, or every logged set, as CSV text to any app you choose.
- Withdraw consent or object: delete the cloud backup and sign out; stop sending questions to the coach; switch usage statistics off in Settings.
- Complain: write to privacy@vinha.app first, so we can put it right. You also have the right to complain to the data protection authority — in Finland, the Office of the Data Protection Ombudsman, tietosuoja.fi or tietosuoja@om.fi.

## Children

Vinha is not intended for children under 16, and we do not knowingly process their data. Because nothing reaches us with a name attached, we cannot tell a child’s data from anyone else’s — if you believe a child has signed in for the cloud backup, write to us and we will delete it.

## Changes to this policy

If this policy changes in a way that affects you, the app shows the change before it takes effect. The date at the top always tells you which version you are reading, and earlier versions are available on request.
