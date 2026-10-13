import type { AppLanguage } from '../types/models';

/**
 * The catalog's progression rules, in Finnish.
 *
 * Every template carries four of these — how the anchor climbs, how the
 * secondary work climbs, what accessories are for, and what to do when the
 * reps do not come. They are the most useful prose in the whole catalog and
 * they were written in English, so the app never showed them: the detail
 * screen's answer to "this text is English" had been not to render it.
 *
 * 55 templates, but only 69 distinct sentences between them — the same shape
 * as `exerciseNameLabel`, and translated the same way. Anything unmapped falls
 * through untouched rather than disappearing, so a rule added tomorrow is
 * readable in English until it is translated, not missing.
 */

const FI: Record<string, string> = {
  // ── VITAL Walk, STRONG Guided and VITAL Home (2026-10-12) ──────────────────
  'Walk the blocks at a pace where you can still talk in short sentences. Add a minute to each block once every block feels steady.':
    'Kävele blokit vauhdilla, jolla pystyt vielä puhumaan lyhyin lausein. Lisää jokaiseen blokkiin minuutti, kun kaikki blokit tuntuvat tasaisilta.',
  'Add reps before anything else; the movements stay the same for the whole block.':
    'Lisää ensin toistoja; liikkeet pysyvät samoina koko jakson.',
  'Hold the stretches and balance work for the time written and breathe slowly through them.':
    'Pidä venytykset ja tasapainoharjoitukset merkityn ajan ja hengitä niiden aikana rauhallisesti.',
  'If a session felt hard the next day, repeat the same blocks and reps next time.':
    'Jos treeni tuntui seuraavana päivänä raskaalta, toista samat blokit ja toistot ensi kerralla.',
  'Each anchor is a machine or cable lift for six reps. When every set reaches six smooth, controlled reps, add the smallest step the stack allows next time.':
    'Jokainen ankkuriliike tehdään laitteella tai taljassa kuuden toiston sarjoina. Kun jokainen sarja yltää kuuteen sujuvaan, hallittuun toistoon, lisää ensi kerralla pienin askel, jonka painopakka sallii.',
  'Finish the reps written on every set before adding load.':
    'Tee jokaisen sarjan merkityt toistot ennen kuin lisäät painoa.',
  'Add reps before load, and keep the last rep as controlled as the first.':
    'Lisää toistoja ennen painoa, ja tee viimeinen toisto yhtä hallitusti kuin ensimmäinen.',
  'If the six reps are missed, keep the same load and build the reps back up before adding weight.':
    'Jos kuusi toistoa jää saamatta, pidä sama paino ja rakenna toistot takaisin ennen painon lisäystä.',
  'Add reps before anything else. When every set reaches the reps written with control, make the movement a little harder: a lower chair, a lower surface for the push-up.':
    'Lisää ensin toistoja. Kun jokainen sarja yltää merkittyihin toistoihin hallitusti, tee liikkeestä hieman vaikeampi: matalampi tuoli, matalampi alusta punnerrukseen.',
  'Finish the reps written on every set before changing the movement.':
    'Tee jokaisen sarjan merkityt toistot ennen kuin vaihdat liikettä.',
  'Walk the blocks at a pace where you can still talk in short sentences, and add a minute once both feel steady.':
    'Kävele blokit vauhdilla, jolla pystyt vielä puhumaan lyhyin lausein, ja lisää minuutti, kun molemmat tuntuvat tasaisilta.',
  'If the reps are missed, repeat the same version next time and build them back up.':
    'Jos toistot jäävät saamatta, toista sama versio ensi kerralla ja rakenna toistot takaisin.',
  // ── VITAL Strength and VITAL Body (2026-10-12) ────────────────────
  'Each anchor lift is a dumbbell lift for six reps. When every set reaches six smooth, controlled reps, use the next heavier dumbbells; with one pair, take three seconds to lower each rep and pause a second at the bottom first.':
    'Jokainen ankkuriliike tehdään käsipainoilla kuuden toiston sarjoina. Kun jokainen sarja yltää kuuteen sujuvaan, hallittuun toistoon, ota ensi kerralla seuraavaksi raskaammat käsipainot; yhdellä parilla käytä ensin kolme sekuntia jokaiseen laskuvaiheeseen ja pysähdy sekunniksi alas.',
  'Add reps to every set first, lowering each rep under control. When every set reaches the reps written, make the movement harder: a lower surface for the push-up, a longer pause at the top of the row.':
    'Lisää ensin toistoja jokaiseen sarjaan ja laske jokainen toisto hallitusti. Kun jokainen sarja yltää merkittyihin toistoihin, tee liikkeestä vaikeampi: matalampi alusta punnerrukseen, pidempi pysäys soudun yläasennossa.',
  'Finish the reps written on every set before changing the movement, lowering each rep under control.':
    'Tee jokaisen sarjan merkityt toistot ennen kuin vaihdat liikettä, ja laske jokainen toisto hallitusti.',
  'Add reps before changing the movement, and keep the last rep as controlled as the first.':
    'Lisää toistoja ennen kuin vaihdat liikettä, ja tee viimeinen toisto yhtä hallitusti kuin ensimmäinen.',
  'If the minimum reps are missed, repeat the same version next time and build the reps back up.':
    'Jos vähimmäistoistot jäävät saamatta, toista sama versio ensi kerralla ja rakenna toistot takaisin.',
  // ── VITAL Base (2026-10-12) ──────────────────────────────────
  'Each anchor lift is a hard version of a bodyweight lift for six reps. When every set reaches six smooth, controlled reps, make it harder next time: a higher rear foot, feet raised for the push-up, a lower table for the row, or a one-second pause at the bottom of every rep.':
    'Jokainen ankkuriliike on kehonpainoliikkeen vaativa versio kuuden toiston sarjoina. Kun jokainen sarja yltää kuuteen sujuvaan, hallittuun toistoon, tee liikkeestä ensi kerralla vaikeampi: korkeampi alusta takajalalle, jalat koholle punnerruksessa, matalampi pöytä soudussa tai sekunnin pysäys jokaisen toiston alaosassa.',
  'Finish the reps written on every set before changing the version, lowering each rep under control.':
    'Tee jokaisen sarjan merkityt toistot ennen kuin vaihdat versiota, ja laske jokainen toisto hallitusti.',
  'Add reps before changing the version, and keep the last rep as controlled as the first.':
    'Lisää toistoja ennen kuin vaihdat versiota, ja tee viimeinen toisto yhtä hallitusti kuin ensimmäinen.',
  'If the six reps are missed, keep the same version and build the reps back up before making it harder.':
    'Jos kuusi toistoa jää saamatta, pysy samassa versiossa ja rakenna toistot takaisin ennen kuin teet siitä vaikeamman.',
  // ── HUGE Guided and VITAL Muscle (2026-10-12) ──────────────────────────
  'Lower each rep under control and stop a rep or two short of failure. When every set reaches the reps written, add the smallest step the stack or the dumbbells allow next time.':
    'Laske jokainen toisto hallitusti ja lopeta sarja toisto tai kaksi ennen uupumusta. Kun jokainen sarja yltää merkittyihin toistoihin, lisää ensi kerralla pienin askel, jonka painopakka tai käsipainot sallivat.',
  'Lower each rep under control and stop a rep or two short of failure. When every set reaches the reps written, use heavier dumbbells next time; with one pair, add two reps to every set first.':
    'Laske jokainen toisto hallitusti ja lopeta sarja toisto tai kaksi ennen uupumusta. Kun jokainen sarja yltää merkittyihin toistoihin, ota ensi kerralla raskaammat käsipainot; jos sinulla on vain yksi pari, lisää ensin kaksi toistoa jokaiseen sarjaan.',
  'Finish the reps written on every set before adding load, lowering each rep under control.':
    'Tee jokaisen sarjan merkityt toistot ennen kuin lisäät painoa, ja laske jokainen toisto hallitusti.',

  // ── SHRED Guided and VITAL Burn (2026-10-12) ───────────────────
  'Go round the machines in order with short rests. When every set reaches the reps written with control, add the smallest step the stack allows next time.':
    'Kierrä laitteet järjestyksessä lyhyin lepoin. Kun jokainen sarja yltää merkittyihin toistoihin hallitusti, lisää ensi kerralla pienin askel, jonka painopakka sallii.',
  'Keep every hard interval at the same effort, and add a round or a minute before you go harder.':
    'Pidä jokainen kova intervalli samalla teholla ja lisää kierros tai minuutti ennen kuin lisäät vauhtia.',
  'Add reps before anything else. When every set reaches the reps written with control, make the movement a little harder: a lower incline for the push-up, a deeper squat.':
    'Lisää ensin toistoja. Kun jokainen sarja yltää merkittyihin toistoihin hallitusti, tee liikkeestä hieman vaikeampi: matalampi alusta punnerrukseen, syvempi kyykky.',
  'Walk each block briskly: breathing deep and quick, short sentences still possible. Add a minute to a block once every block feels steady.':
    'Kävele jokainen blokki reippaasti: hengitys on syvää ja nopeaa, mutta lyhyet lauseet onnistuvat. Lisää blokkiin minuutti, kun kaikki blokit tuntuvat tasaisilta.',

  // ── Anchor / primary ────────────────────────────────────────────────
  'Anchor lifts keep double progression so strength holds while conditioning volume climbs.':
    'Ankkuriliikkeissä pidetään tuplaprogressio, jotta voima säilyy kuntovolyymin noustessa.',
  'Anchor lifts run heavy double progression: add load only after every planned set lands at the top of the range with bar speed intact.':
    'Ankkuriliikkeissä raskas tuplaprogressio: lisää painoa vasta kun jokainen suunniteltu sarja osuu toistohaarukan yläpäähän tangon nopeuden säilyessä.',
  'Anchor the first lift of each day through the full rep range before adding weight. At this frequency, load jumps must stay small.':
    'Vie päivän ensimmäinen liike koko toistohaarukan läpi ennen painon lisäystä. Tällä tiheydellä painonnousujen on pysyttävä pieninä.',
  'Drive the main lift with lower-rep double progression. Add load only when all planned sets stay clean and inside the target range.':
    'Vedä ankkuriliikettä matalan toistomäärän tuplaprogressiolla. Lisää painoa vasta kun kaikki suunnitellut sarjat pysyvät puhtaina ja toistohaarukan sisällä.',
  'Drive the main lift with lower-rep double progression. Add load only when all planned sets stay crisp and inside the rep range.':
    'Vedä ankkuriliikettä matalan toistomäärän tuplaprogressiolla. Lisää painoa vasta kun kaikki suunnitellut sarjat pysyvät terävinä ja toistohaarukan sisällä.',
  'Progress the first compound lift of each session through the rep range before adding load.':
    'Vie treenin ensimmäinen moninivelliike toistohaarukan läpi ennen painon lisäystä.',
  'Progress the first exercise through the full rep range before adding weight. This is the highest-priority movement of the day.':
    'Vie ensimmäinen liike koko toistohaarukan läpi ennen painon lisäystä. Se on päivän tärkein liike.',
  'Push the first compound lift on each day through the rep range before adding load.':
    'Vie päivän ensimmäinen moninivelliike toistohaarukan läpi ennen painon lisäystä.',
  'Run double progression on the first two lifts each day; add load once the top of the range repeats cleanly.':
    'Käytä tuplaprogressiota päivän kahdessa ensimmäisessä liikkeessä; lisää painoa kun toistohaarukan yläpää toistuu puhtaana.',
  'Run the first lift of each day as the performance anchor. Add load after every set lands at the top of the target range with clean technique.':
    'Päivän ensimmäinen liike on suorituksen ankkuri. Lisää painoa kun jokainen sarja osuu toistohaarukan yläpäähän puhtaalla tekniikalla.',
  'Treat the first lift on each day as the performance slot and only add load once all work sets live at the top of the target range.':
    'Päivän ensimmäinen liike on se, jossa eteneminen mitataan. Lisää painoa vasta kun kaikki työsarjat osuvat toistohaarukan yläpäähän.',
  'Use double progression on anchor lifts. Add load after the top of the rep range is repeatable with clean form.':
    'Käytä ankkuriliikkeissä tuplaprogressiota. Lisää painoa kun toistohaarukan yläpää toistuu puhtaalla tekniikalla.',
  'Use double progression on anchor lifts. When every set reaches the target reps with clean form, increase load next time by the smallest practical increment.':
    'Käytä ankkuriliikkeissä tuplaprogressiota. Kun jokainen sarja yltää toistotavoitteeseen puhtaana, nosta painoa ensi kerralla pienimmällä järkevällä askeleella.',
  'Use double progression on the first two lifts each day and add load after the top of the rep range repeats with good form.':
    'Käytä tuplaprogressiota päivän kahdessa ensimmäisessä liikkeessä ja lisää painoa kun toistohaarukan yläpää toistuu hyvällä tekniikalla.',
  'Add reps before load. When the top of the range is repeatable, use a small load increase; otherwise repeat the same load.':
    'Lisää toistoja ennen painoa. Kun toistohaarukan yläpää toistuu, nosta painoa vähän; muuten toista sama paino.',
  'Add reps inside the range before adding load. When the top of the range is clean on every set, add the smallest increment you have.':
    'Lisää toistoja toistohaarukan sisällä ennen kuin lisäät painoa. Kun toistohaarukan yläpää menee puhtaasti joka sarjassa, lisää pienin korotus mikä sinulla on.',
  'Hold the load until the whole range is repeatable. A summer session should end with something left in you.':
    'Pidä paino samana kunnes koko toistohaarukka toistuu. Kesätreenin pitäisi loppua niin että jotain jää jäljelle.',
  'Run blocks progress by adding one block, never by running the same block harder. Add the block only when the last one felt easy.':
    'Juoksuosuus etenee lisäämällä yksi osuus, ei juoksemalla samaa osuutta kovempaa. Lisää osuus vasta kun edellinen tuntui helpolta.',
  'Same rule as the anchors.':
    'Sama sääntö kuin ankkureissa.',
  'Add reps before load. The conditioning finisher is not progressed by load at all - keep the effort steady and let the leg work be the hard part.':
    'Toistot ennen painoa. Kunto-osuutta ei progressoida kuormalla lainkaan – pidä teho samana ja anna jalkatreenin olla se raskas osa.',
  'Treat the run work as clean interval blocks and add total blocks only after pacing feels stable.':
    'Kohtele juoksuosuutta puhtaina intervalliblokkeina ja lisää blokkeja vasta kun vauhti tuntuu vakaalta.',
  'Keep the movement smooth and repeat the full range before adding more total rounds.':
    'Pidä liike sujuvana ja toista koko liikerata ennen kuin lisäät kierroksia.',
  'Repeat the full flow smoothly before increasing total cycles.':
    'Toista koko sarja sujuvasti ennen kuin lisäät kierroksia.',

  // ── Secondary ───────────────────────────────────────────────────────
  'Keep secondary lifts one step easier than the main lift so the week stays repeatable.':
    'Pidä tukiliikkeet askeleen ankkuriliikettä kevyempinä, jotta viikko pysyy toistettavana.',
  'Keep secondary lifts one step lighter than the main lift; they progress by the same rule.':
    'Pidä tukiliikkeet askeleen ankkuriliikettä kevyempinä; ne etenevät samalla säännöllä.',
  'Secondary compounds climb by the same rule as the anchors.':
    'Tukevat moninivelliikkeet nousevat samalla säännöllä kuin ankkurit.',
  'Progress secondary lifts by adding reps first, then load once the range is stable across working sets.':
    'Etene tukiliikkeissä lisäämällä ensin toistoja, sitten painoa kun toistohaarukka on vakaa kaikissa työsarjoissa.',
  'Secondary compounds add pressure without matching anchor fatigue; they climb by the same rule.':
    'Tukevat moninivelliikkeet lisäävät painetta ilman ankkurin väsytystä; ne nousevat samalla säännöllä.',
  'Secondary compounds add volume and rise by the same rule as the anchor of the day.':
    'Tukevat moninivelliikkeet tuovat volyymia ja nousevat samalla säännöllä kuin päivän ankkuri.',
  'Secondary compounds drive total weekly volume. Keep them technical; load rises by the same rule as the anchor.':
    'Tukevat moninivelliikkeet vastaavat viikon kokonaisvolyymista. Pidä ne teknisinä; paino nousee samalla säännöllä kuin ankkurissa.',
  'Secondary lifts add most of the weekly volume, so keep them technical and avoid forcing progress too aggressively.':
    'Tukiliikkeet tuovat suurimman osan viikon volyymista, joten pidä ne teknisinä äläkä pakota etenemistä.',
  'Secondary lifts complete the range before adding load; fatigue from finishers never excuses sloppy reps.':
    'Tukiliikkeissä täytetään toistohaarukka ennen painon lisäystä; kunto-osuuksien väsymys ei koskaan oikeuta epäpuhtaita toistoja.',
  'Secondary work follows the same rule — the goal is a repeatable hard week, not a maximal one.':
    'Tukityö etenee samalla säännöllä — tavoite on toistettava kova viikko, ei maksimaalinen.',
  'Use secondary compounds to add quality volume without matching the fatigue of the main lift.':
    'Käytä tukevia moninivelliikkeitä laadukkaan volyymin lisäämiseen ilman ankkuriliikkeen väsytystä.',
  'Use secondary exercises to add volume to the target muscle without matching the fatigue of the primary lift.':
    'Käytä tukiliikkeitä kohdelihaksen volyymin lisäämiseen ilman ankkuriliikkeen väsytystä.',
  'Use the second compound lift to build more total work without matching the fatigue of the anchor.':
    'Käytä toista moninivelliikettä kokonaistyön lisäämiseen ilman ankkurin väsytystä.',
  'Conditioning and trunk work progress by pace and reps, never at the cost of the main lifts.':
    'Kunto- ja keskivartalotyö etenee vauhdilla ja toistoilla, ei koskaan ankkuriliikkeiden kustannuksella.',
  'Conditioning finishers are effort-based: keep the work intervals honest and let pace, not load, be the progression.':
    'Kunto-osuudet menevät tuntumalla: pidä työjaksot rehellisinä ja anna vauhdin, ei painon, olla progressio.',
  'Finishers progress by pace and density — harder intervals, same honesty.':
    'Kunto-osuudet etenevät vauhdilla ja tiheydellä — kovempia intervalleja, sama rehellisyys.',
  'Treat secondary drills as clean support work, not something to grind through.':
    'Kohtele tukiharjoitteita puhtaana tukityönä, ei jauhettavana.',
  'Use secondary poses and resets to improve control, not to chase fatigue.':
    'Käytä tukiasentoja ja palautuksia hallinnan parantamiseen, älä väsymyksen hakemiseen.',

  // ── Accessory ───────────────────────────────────────────────────────
  'Accessories keep joints and trunk strong; add reps first and never let them cost the next heavy day.':
    'Lisäliikkeet pitävät nivelet ja keskivartalon vahvoina; lisää ensin toistoja äläkä anna niiden viedä seuraavaa raskasta päivää.',
  'Accessories should be smooth, high-quality sets that fill out the session without wrecking the next one.':
    'Lisäliikkeiden kuuluu olla sujuvia, laadukkaita sarjoja jotka täydentävät treenin rikkomatta seuraavaa.',
  'Accessories should chase clean reps and a pump without creating sloppy fatigue for the next session.':
    'Lisäliikkeissä haetaan puhtaita toistoja ja pumppia ilman että seuraava treeni kärsii.',
  'Accessories should help ankles, hips, and breathing recover between run days.':
    'Lisäliikkeiden tehtävä on auttaa nilkkoja, lonkkia ja hengitystä palautumaan juoksupäivien välissä.',
  'Accessories should improve breathing, range, and recovery quality from week to week.':
    'Lisäliikkeiden tehtävä on parantaa hengitystä, liikerataa ja palautumisen laatua viikosta toiseen.',
  'Accessories should improve recovery and muscle balance, not compete with the heavy work.':
    'Lisäliikkeiden tehtävä on parantaa palautumista ja lihastasapainoa, ei kilpailla raskaan työn kanssa.',
  'Accessories should restore position and help you leave the session feeling better than when you started.':
    'Lisäliikkeiden tehtävä on palauttaa asento ja saada sinut lähtemään treenistä paremmassa kunnossa kuin tulit.',
  'Accessories should support muscle gain and joint balance. Add reps first and keep them from disrupting recovery for the next heavy day.':
    'Lisäliikkeiden tehtävä on tukea lihaskasvua ja nivelten tasapainoa. Lisää ensin toistoja äläkä anna niiden häiritä seuraavan raskaan päivän palautumista.',
  'Accessory volume is the engine of growth at high frequency. Protect quality over raw numbers — sloppy sets count for less than you think.':
    'Lisäliikkeiden volyymi on kasvun moottori korkealla tiheydellä. Suojele laatua lukujen sijaan — huolimattomat sarjat merkitsevät vähemmän kuin luulet.',
  'Keep accessories controlled. Add reps before load and avoid form breakdown near fatigue.':
    'Pidä lisäliikkeet hallittuina. Lisää toistoja ennen painoa ja vältä tekniikan hajoamista väsyneenä.',
  'Keep accessory sets smooth and controlled. Add reps before load and prioritise feeling the muscle over moving weight.':
    'Pidä lisäsarjat sujuvina ja hallittuina. Lisää toistoja ennen painoa ja aseta lihaksen tuntuminen painon liikuttamisen edelle.',
  'Treat accessory lifts as easy volume that rounds the session out without making recovery harder than it needs to be.':
    'Kohtele lisäliikkeitä kevyenä volyymina joka viimeistelee treenin tekemättä palautumisesta turhan raskasta.',
  'Use accessories to keep weak links moving, but do not let them limit recovery for the next heavy day.':
    'Käytä lisäliikkeitä pitämään heikot lenkit liikkeessä, mutta älä anna niiden rajoittaa seuraavan raskaan päivän palautumista.',
  'Use accessories to support the main patterns, but keep the total workload low enough that recovery stays obvious.':
    'Käytä lisäliikkeitä päämallien tukena, mutta pidä kokonaiskuorma niin matalana että palautuminen pysyy selvänä.',
  'Use mobility drills to leave the session feeling looser, not more fatigued.':
    'Käytä liikkuvuusharjoitteita niin että treenistä lähtee notkeampana, ei väsyneempänä.',

  // ── Failure handling ────────────────────────────────────────────────
  'If the minimum reps are missed, keep the same load and build the reps back up before adding weight.':
    'Jos alaraja jää vajaaksi, pidä sama paino ja nosta toistot takaisin ennen kuin lisäät painoa.',
  'If the primary misses the minimum reps, repeat the same load and build the reps back up with clean technique before adding weight.':
    'Jos ankkuriliikkeessä jää alaraja vajaaksi, toista sama paino ja nosta toistot takaisin puhtaalla tekniikalla ennen kuin lisäät painoa.',
  'If the minimum reps are missed on the anchor, repeat the load and rebuild the reps cleanly before attempting new weight.':
    'Jos ankkurissa jää alaraja vajaaksi, toista sama paino ja rakenna toistot puhtaasti takaisin ennen uutta painoa.',
  'Missing the minimum reps repeats the load until the reps are back.':
    'Vajaaksi jäänyt alaraja toistetaan samalla painolla, kunnes toistot ovat palanneet.',
  'Missed reps on the first hard set means hold the same load and rebuild the reps cleanly before adding weight.':
    'Vajaat toistot ensimmäisessä raskaassa sarjassa tarkoittavat, että paino pysyy samana ja toistot rakennetaan puhtaasti takaisin ennen painon lisäystä.',
  'Miss the minimum reps on the anchor lift and you repeat the load until the reps are back.':
    'Jos ankkuriliikkeen alaraja jää vajaaksi, toistat saman painon, kunnes toistot ovat palanneet.',
  'If the first work set misses the minimum reps, repeat the load and rebuild with clean reps before adding weight.':
    'Jos ensimmäisessä työsarjassa jää alaraja vajaaksi, toista sama paino ja rakenna toistot puhtaasti takaisin ennen painon lisäystä.',
  'If the first hard set misses the minimum reps, repeat the same load and build the reps back up.':
    'Jos ensimmäisessä raskaassa sarjassa jää alaraja vajaaksi, toista sama paino ja nosta toistot takaisin.',
  'If the minimum reps are missed, repeat the same session next time until the reps are back.':
    'Jos alaraja jää vajaaksi, toista sama treeni, kunnes toistot ovat palanneet.',
  'If a main lift misses the minimum reps, repeat it next time and rebuild the reps at the same load.':
    'Jos ankkuriliikkeessä jää alaraja vajaaksi, toista se ensi kerralla ja rakenna toistot takaisin samalla painolla.',
  'If a main lift misses the minimum reps, hold the same load and build the reps back up.':
    'Jos ankkuriliikkeessä jää alaraja vajaaksi, pidä sama paino ja nosta toistot takaisin.',
  'A missed range repeats the load until the reps are back.':
    'Vajaaksi jäänyt toistohaarukka toistetaan samalla painolla, kunnes toistot ovat palanneet.',
  'A missed anchor set repeats the load until the reps are back.':
    'Epäonnistunut ankkurisarja toistetaan samalla painolla, kunnes toistot ovat palanneet.',
  'If a drill feels rough, repeat the same dose next time instead of adding more rounds or rushing range.':
    'Jos harjoite tuntuu kankealta, toista sama annos ensi kerralla sen sijaan että lisäisit kierroksia tai kiirehtisit liikerataa.',
  'If the flow quality drops, keep the same number of cycles next time and slow the pace down.':
    'Jos sarjan laatu laskee, pidä sama kierrosmäärä ensi kerralla ja hidasta vauhtia.',
  'If the interval work feels too heavy, repeat the same number of blocks next time and keep the pace easier.':
    'Jos intervallityö tuntuu liian raskaalta, toista sama blokkimäärä ensi kerralla ja pidä vauhti kevyempänä.',
  'Use the same rule, but keep load stable longer if fatigue rises. Prefer completing the rep range before adding weight.':
    'Käytä samaa sääntöä, mutta pidä paino pidempään vakiona jos väsymys nousee. Täytä mieluummin toistohaarukka ennen painon lisäystä.',
};

/**
 * A progression rule in the reader's language.
 *
 * Unknown strings pass through untouched: a rule added to the catalog
 * tomorrow reads in English until someone translates it, which is worse than
 * Finnish and far better than blank.
 */
export function progressionRuleLabel(language: AppLanguage, rule: string): string {
  if (language !== 'fi') {
    return rule;
  }
  return FI[rule] ?? rule;
}
