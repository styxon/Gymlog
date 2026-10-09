# Store listing: Google Play (draft 2026-10-09)

The text for Play Console → Grow → Store presence → Main store listing, in
Finnish and English. Nothing here is entered yet: the developer account waits
on the D-U-N-S number. App Store text comes later from the same facts (§6).

Every claim below was checked against the code on 2026-10-09 (main 2601d75f).
The facts and their sources are in §5. When the app changes, change §5 first and
then the text.

Limits and numbers are checked by
`tests/storeListing.test.cjs`, which also fails if a number in the text
stops being true in the code (50+ programs, 900+ exercises, 25 questions).

## 1. Rules the text follows

From Google's metadata policy and store listing guidance (links in §7) and our
own rules:

- **Title (30), short description (80):** no price, no "free", no "no ads", no
  "best" or "#1", no emoji, no capitals for emphasis. Google lists "free" and
  "no ads" as deal words that do not belong in the title or icon. In the short
  description we leave them out as well, which keeps the price question to the
  full description.
- **Full description (4000):** the strongest point first, facts not claims, no
  keyword lists, no competitor names, no testimonials, no rankings.
- **No promised results** (no "50 kg → 80 kg", no weight lost). The text says
  what the app does, not what happens to the person.
- **Counts that age** are written as floors: "50+ programs" (71 in code),
  "900+ exercises" (958 in code).
- **No trial and no prices yet.** Billing is not live until the Play products
  exist. Play shows the prices on the listing by itself from the in-app
  products. Add the trial sentence in §4 only once the Play offer exists.
- **The programs for special groups** (prenatal, postpartum, joint-friendly)
  describe the training. They never say they treat a condition, so the listing
  does not name them.

## 2. Finnish (fi-FI): the default language

### Title (max 30)

<!-- field:fi.title -->
```text
Vinha: Treenipäiväkirja
```

Chosen by the owner on 2026-10-09. The others considered:

| Title | Characters | Note |
|---|---|---|
| Vinha: Treenipäiväkirja | 23 | The word Finns search with; Lyfta uses the same (the only well-localised competitor) |
| Vinha: Saliohjelmat & loki | 26 | Puts the programs first, but "loki" is not a search word |
| Vinha Fitness: Saliohjelmat | 27 | Keeps the full name shown under the icon |

### Short description (max 80)

<!-- field:fi.short -->
```text
Treenipäiväkirja ja 50+ valmista saliohjelmaa. Ohjatut sarjat ja lepoajastin.
```

### Full description (max 4000)

<!-- field:fi.full -->
```text
Vinha ohjaa salitreenin sarja sarjalta. Kun avaat sovelluksen, päivän treeni on valmiina: paino ja toistot viime kerran pohjalta, lepo alkaa itsestään ja jokainen sarja jää historiaan. Ei mainoksia, eikä tiliä tarvita.

VALMIIT OHJELMAT
Yli 50 valmista ohjelmaa voimaan, lihaskasvuun ja yleiskuntoon, aloittelijasta edistyneeseen. 1–6 päivää viikossa, 30–80 minuuttia kerralla, jakso 8–12 viikkoa. Salille, kotiin käsipainoilla tai pelkällä kehonpainolla. Kerro kuudessa askeleessa viikkosi, välineesi ja tavoitteesi, niin Vinha ehdottaa ohjelmaa, joka sopii viikkoosi. Valmiit ohjelmat ovat kaikki ilmaisia.

OHJATTU TREENI
• Lämmittely, työsarjat, lepo ja loppuvenyttely oikeassa järjestyksessä
• Viime kerran sarjat tämän päivän tavoitteen vieressä
• Kirjaa sarja yhdellä napautuksella, lepoajastin käynnistyy itsestään ja jatkaa taustalla
• Vaihda tai lisää liike kesken treenin, korjaa väärin kirjattu sarja
• Supersarjat, pitoliikkeet ja intervallit
• Vapaa treeni ilman ohjelmaa levylaskurin kanssa
• Cardio-ajastin juoksuun, pyörään ja soutuun
• Yli 900 liikettä, useimmissa kuva

OMAT OHJELMAT
• Rakenna päivät, liikkeet, sarjat ja supersarjat editorilla
• Kopioi valmis ohjelma pohjaksi ja muokkaa siitä omasi
• Tuo ohjelma CSV-tiedostona, vie ohjelmat ja koko loki CSV:nä
• Kiertävä rytmi, jos viikkosi ei ole seitsemän päivää

KEHITYS
• Ennätykset liikkeittäin: painavin sarja, eniten toistoja, paras treeni
• Kuvaajat volyymista, treenien kestosta ja kehonpainosta
• Tasanteen tunnistus, kun liike jää kolme kertaa samaan painoon
• Kehonpaino, BMI ja mitat
• Voimatavoitteet, virstanpylväät ja treenikalenteri
• Kotinäytön widgetit: kuukausi ja treeniputki

TOIMII ILMAN VERKKOA
Kirjaus, ohjelmat ja historia toimivat ilman verkkoa ja ilman tiliä. Verkkoa käyttävät vapaaehtoinen pilvivarmuuskopio (kirjautuminen Googlella, tallennus EU:ssa), valmentaja, liikekuvat ja nimettömät käyttötilastot, jotka voi kytkeä pois asetuksista. Ei mainoksia eikä kolmansien osapuolten analytiikkaa.

VINHA PRO
Ilmaisversiolla ei ole aikarajaa. Siinä ovat kaikki valmiit ohjelmat, kolme omaa ohjelmaa sekä kuvaajat ja ennätykset kolmen kuukauden ajalta. Pro lisää:
• Automaattisen etenemisen: kuorma nousee, kun jokainen työsarja osuu toistohaarukan kattoon
• Vinha-valmentajan: 25 kysymystä kuukaudessa omista treeneistäsi, vastattuna kirjaamiesi sarjojen pohjalta
• Ohjelman rakentajan ja ohjelman luvun valokuvasta (beta)
• Koko historian: kuvaajat ja ennätykset ensimmäisestä sarjasta asti
• Rajattomasti omia ohjelmia, viisi käynnissä rinnakkain
• Kirjallisen analyysin jokaisesta treenistä

Valmentajan vastaukset kirjoittaa tekoäly. Valmentaja ei anna lääketieteellisiä neuvoja.

Pro on kuukausi- tai vuositilaus tai kertaostona elinikäinen. Tilaus uusiutuu automaattisesti, kunnes perut sen Google Playssa.

Kielet suomi ja englanti. Painot kilogrammoina.

Vinhan tekee suomalainen Styxon Studio.
Tietosuoja: https://styxon.fi/vinha-fitness/legal/privacy.fi
Käyttöehdot: https://styxon.fi/vinha-fitness/legal/terms.fi
Tuki: support@vinha.app
```

## 3. English (en-US)

Store English says "programs": it is the word people search ("workout
programs"). The app's own English still mixes "program" and "programme"; that
is a separate cleanup.

### Title (max 30)

<!-- field:en.title -->
```text
Vinha: Gym Log & Workout Plans
```

Chosen by the owner on 2026-10-09. The others considered:

| Title | Characters | Note |
|---|---|---|
| Vinha: Gym Log & Workout Plans | 30 | Two of the most searched phrases (gym log, workout plan) |
| Vinha: Workout Tracker & Plans | 30 | "Workout tracker" is what Hevy, Strong and Lyfta compete on |
| Vinha Fitness: Gym Log & Plans | 30 | Keeps the full name shown under the icon |

### Short description (max 80)

<!-- field:en.short -->
```text
Guided gym workouts with 50+ ready programs, a rest timer and every set logged.
```

### Full description (max 4000)

<!-- field:en.full -->
```text
Vinha guides your gym session set by set. Today's workout is ready when you open the app: weight and reps filled in from last time, rest starts on its own, and every set goes into your history. No ads, and no account needed.

READY PROGRAMS
More than 50 ready programs for strength, muscle and general fitness, beginner to advanced. 1–6 days a week, 30–80 minutes a session, blocks of 8–12 weeks. For the gym, home dumbbells or bodyweight only. Six steps about your week, equipment and goal, and Vinha suggests a program that fits your week. Every ready program is free.

GUIDED WORKOUTS
• Warm-up, working sets, rest and cooldown in the right order
• Last session's sets next to today's target
• Log a set in one tap; the rest timer starts by itself and keeps running in the background
• Swap or add an exercise mid-workout, fix a set you logged wrong
• Supersets, timed holds and intervals
• Free workout without a program, with a plate calculator
• Cardio timer for running, cycling and rowing
• 900+ exercises, most with pictures and step-by-step instructions

YOUR OWN PROGRAMS
• Build days, exercises, sets and supersets in the editor
• Copy a ready program and make it yours
• Import a program from CSV; export your programs and your whole log as CSV
• A rotating cycle if your week isn't seven days

PROGRESS
• Records per exercise: heaviest set, most reps, best session
• Charts for volume, session length and bodyweight
• Plateau detection when a lift stalls at the same weight three times
• Bodyweight, BMI and body measurements
• Strength goals, milestones and a training calendar
• Home screen widgets with your month and your streak

WORKS OFFLINE
Logging, programs and history work without a connection and without an account. The network is used for the optional cloud backup (sign in with Google, stored in the EU), the coach, exercise pictures and anonymous usage statistics, which you can switch off in settings. No ads and no third-party analytics.

VINHA PRO
The free version has no time limit. It includes every ready program, three programs of your own, and charts and records for the last three months. Pro adds:
• Automatic progression: the load goes up once every working set reaches the top of its rep range
• Vinha Coach: 25 questions a month about your own training, answered from the sets you logged
• An AI program builder, and reading a program from a photo (beta)
• Your full history: charts and records from your very first set
• Unlimited programs of your own, five running at once
• A written analysis of every session

The coach's answers are written by AI. The coach doesn't give medical advice.

Pro is a monthly or yearly subscription, or a one-time lifetime purchase. Subscriptions renew automatically until you cancel them in Google Play.

English and Finnish. Weights are in kilograms.

Vinha is made in Finland by Styxon Studio.
Privacy: https://styxon.fi/vinha-fitness/legal/privacy.en
Terms: https://styxon.fi/vinha-fitness/legal/terms.en
Support: support@vinha.app
```

## 4. Waiting for something else

- **Trial sentence**, once the Play free-trial offer exists
  (`docs/store-billing.md`). Goes after the "Pro is a monthly…" line:
  - FI: `Kuukausi- ja vuositilaukseen kuuluu ilmainen kokeilu. Jos perut ennen sen loppua, mitään ei veloiteta.`
  - EN: `Monthly and yearly come with a free trial. Cancel before it ends and nothing is charged.`
  The trial length goes in only once it is set in Play, not before.
- **"No account needed"** stays true only while sign-in is optional. If Pro
  ever needs an account, change the first paragraph.
- **The in-app "billing is not live yet" lines** (`pro.sheet.fine`,
  `pro.v3.notice`) must go before the first store release, or the app
  contradicts this listing.
- **"Exercise pictures use the network."** The pictures load from a public
  image CDN (jsDelivr) when shown. The listing says so; the privacy policy does
  not yet name it.

## 5. Facts behind the text (checked 2026-10-09)

| Claim | Fact in code |
|---|---|
| 50+ ready programs | 71 in `WORKOUT_TEMPLATES_V1` (6 of them single-day focus sessions) |
| Strength / muscle / general fitness | goal types strength 12, hypertrophy 29, general 30 |
| Beginner to advanced | beginner 23, intermediate 34, advanced 14 |
| 1–6 days a week | 1 day: 6, 2: 6, 3: 22, 4: 16, 5: 16, 6: 5 |
| 30–80 minutes | `estimatedSessionDuration` range |
| 8–12 week blocks | `READY_PROGRAM_MIN/MAX_BLOCK_WEEKS` in `readyProgramDuration.ts` |
| Gym, home dumbbells, bodyweight | 50 full-gym, 21 low-equipment (`programEquipment.ts`) |
| Six steps → a program | `startPath.build.body`, recommender on the device |
| 900+ exercises | 873 generated + 85 own = 958 (`seed.ts` `createSeedExerciseLibrary`) |
| Instructions / pictures | 953 of 958 with English steps; 873 with a picture. Finnish steps only 240, so the FI text does not promise instructions |
| Warm-up, sets, rest, cooldown | guided player step order (`guidedPlayer.ts`) |
| Rest timer in the background | timestamp-based (`restSchedule.ts`) |
| Supersets, holds, intervals | `supersetGrouping.ts`, timed holds, `intervalScheme.ts` |
| Plate calculator in the free workout | `PlatePop` only in `EmptyWorkoutScreen.tsx`, not in the guided player |
| Cardio: running, cycling, rowing | six activities in `cardio.ts`, no GPS |
| Editor, copy a ready program | `CreateTemplateScreen.tsx`, `customProgramDuplication.ts` |
| CSV in and out | `csvProgramImport.ts`, `ExportPlanScreen.tsx`, `workoutLogCsvExport.ts` |
| Rotating cycle | `planRotation.ts` |
| Records, charts, plateau | `personalRecords.ts`, `historyWindow.ts`, plateau after 3 at the same weight |
| Bodyweight, BMI, measurements | `bodyweightCard.ts`, 9 kinds in `measurementKinds.ts` |
| Goals, milestones, calendar | `strengthGoals.ts`, `profileMilestones.ts` (12 families), `homeCalendar.ts` |
| Widgets: month and streak | four widgets in `plugins/withHomeWidget.js` |
| Offline, no account | `pro.v6.free.offline.b`; sign-in only for backup |
| What uses the network | backup, coach, exercise pictures (jsDelivr), usage stats (`api/events`, off in Settings); also the launch notice check and Play purchases, left out as plumbing |
| Backup in the EU | Vercel Blob, `docs/account-backup.md` |
| No ads, no third-party analytics | `legalDocuments.ts` privacy section; own `/api/events` only |
| Free: 3 own programs, 3 months of charts | `FREE_CUSTOM_PROGRAM_LIMIT = 3`, `FREE_TREND_MONTHS = 3` |
| Pro: automatic progression | `automatedProgressionEnabled = toggle && isProUnlocked` |
| Pro: double progression wording | `pro.v2.coach.progression.b` |
| Pro: 25 questions a month | `aiCoachQuota.ts` |
| Pro: builder, photo import (beta) | `proBenefits.ts`, `NewProgramSheet.tsx` (`photoLocked`) |
| Pro: five running at once | `PRO_ACTIVE_PROGRAM_CAP = 5` (free 2) |
| Pro: written analysis | `buildSessionAnalysis` |
| Monthly, yearly, lifetime | `vinha_pro` (monthly, yearly), `vinha_pro_lifetime` in `docs/store-billing.md` |
| Finnish and English | `SUPPORTED_LANGUAGES` |
| Kilograms | `formatWeight` always prints kg; no lb |

Things the text deliberately leaves out:

- **Prices and the trial.** Billing is not live; see §4.
- **The free coach's three answers.** True (`coachDemoMoments.ts`), but they
  arrive on their own at days 7, 30 and 90. Saying "AI coach" in the free
  section would read as chat, which is Pro only.
- **Light and dark theme, sounds, notifications.** True, but every competitor
  has them.
- **Hevy import.** It works (`hevyImport.ts`), but naming another app is
  against Google's guidance.
- **Model or provider names** (Anthropic, Claude). They are in the privacy
  policy; the listing says "AI".

## 6. Graphics (not made yet)

| Asset | Size | State |
|---|---|---|
| Icon | 512×512 PNG | Ready: `assets/branding/vinha-play-store-512.png` |
| Feature graphic | 1024×500, no alpha | Ready (2026-10-09, direction B of three): `assets/branding/vinha-feature-graphic-fi.png` and `-en.png`. The tagline beside three logged sets and the rest timer, no device frame, not a copy of the icon. Source: the design canvas https://claude.ai/artifact/DHfonRGakXAhdMkBEni49Q |
| Phone screenshots | 2–8, 1080×1920 recommended, at least 4 for recommendations | A set of 17 from 2026-09-14 exists (`Pictures\Vinha-kuvakaappaukset-2026-09-13\kauppakuvat-testi`), shot before many UI changes; reshoot from the release APK |

Proposed eight, in this order, with the caption above the screen:

| # | Screen | FI caption | EN caption |
|---|---|---|---|
| 1 | Home, today's workout | Päivän treeni valmiina | Today's workout, ready |
| 2 | Guided player, set with last time | Viime kerran luvut valmiina | Last time's numbers, ready |
| 3 | Rest timer | Lepo alkaa itsestään | Rest starts on its own |
| 4 | Programs tab | 50+ valmista ohjelmaa | 50+ ready programs |
| 5 | Progress tab | Näet, mikä kehittyy | See what's improving |
| 6 | Records / plateau | Jokainen sarja jää talteen | Every set is kept |
| 7 | Coach chat (PRO pill) | Kysy omasta treenistäsi | Ask about your own training |
| 8 | Widget on the home screen | Kuukausi kotinäytöllä | Your month on the home screen |

Two points from Google's screenshot guidance that differ from what we have:

- **Device frames.** Google says to avoid device imagery in screenshots ("can
  become obsolete quickly"). Our set shows the whole phone, by the owner's
  decision (2026-09-30). It is guidance, not a ban; the owner decides.
- **Caption size.** A caption may take at most 20 % of the image.

## 7. Sources

- Metadata policy: https://support.google.com/googleplay/android-developer/answer/9898842
- Store listing best practice: https://support.google.com/googleplay/android-developer/answer/13393723
- Preview assets (screenshots, feature graphic): https://support.google.com/googleplay/android-developer/answer/9866151
- Competitor listings read on 2026-10-09: Hevy, Strong, Fitbod, JEFIT, Boostcamp,
  Lyfta, Alpha Progression, StrengthLog, Liftosaur, Setgraph, and the Finnish
  Thew, Tsemppi, GymTracker and Aitofit. What we took: a plain section structure
  (Lyfta), the program library first (Boostcamp), offline and no account in
  plain words (GymTracker), a native Finnish text (the big apps' Finnish is
  machine-translated). What we did not take: user counts, press quotes,
  testimonials, "#1", award badges, before-and-after photos.
