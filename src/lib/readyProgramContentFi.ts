import { ReadyProgramContent } from './readyProgramContent';

/**
 * Finnish mirror of READY_PROGRAM_CONTENT. Kept in its own file because the
 * English map is long-form coaching copy, not UI strings — interleaving the two
 * languages in one object would make either one hard to read or edit.
 *
 * Every key here must exist in the English map; the English side stays the
 * source of truth, and a missing Finnish entry falls back to it rather than
 * showing a gap.
 */
export const READY_PROGRAM_CONTENT_FI: Record<string, ReadyProgramContent> = {
  // ── Vinha programs, written against what each one actually contains ──
  tpl_gainer_dream_body_man_v1: {
    summary:
      'Viisi salipäivää viikossa, jokaisella oma alue: rinta ja ojentajat, selkä ja hauikset, jalat, olkapäät ja vatsa sekä kädet. Neljä päivää alkaa raskaalla perusliikkeellä ja jatkuu eristävillä, käsipäivä on eristäviä alusta asti.',
    audience:
      'Keskitason treenaajille, jotka osaavat penkin, kyykyn ja leuanvedon ja haluavat kasvattaa lihasta koko kehoon viitenä päivänä viikossa.',
    equipmentProfile:
      'Täysi sali: tanko, käsipainot, taljat, laitteet sekä dippi- ja leuanvetotanko.',
    whyItWorks:
      'Jokainen lihasryhmä saa oman päivänsä ja seitsemän liikettä, ja ankkuriliike nousee vasta kun toistohaarukan yläpää täyttyy joka sarjassa.',
  },
  tpl_gainer_beginner_bro_split_v1: {
    summary:
      'Neljä salipäivää, yksi lihasryhmä kerrallaan: rinta, selkä, jalat sekä olkapäät ja kädet. Viisi tai kuusi liikettä päivässä, joten päivän oppii nopeasti.',
    audience:
      'Aloittelijalle, joka haluaa oppia salin perusliikkeet yksi lihasryhmä kerrallaan ja treenata neljänä päivänä viikossa.',
    equipmentProfile:
      'Tavallinen sali: tanko, käsipainot, taljat ja laitteet.',
    whyItWorks:
      'Kun päivässä on vain yksi lihasryhmä, tekniikkaan ehtii keskittyä ja lihas saa viikon palautua ennen seuraavaa kertaa. Paino nousee, kun toistohaarukan yläpää täyttyy.',
  },
  tpl_gainer_advanced_ppl_v1: {
    summary:
      'Kuusi salipäivää: työntö, veto ja jalat kahdesti viikossa, kummallakin kierroksella eri painotus. Ensimmäinen kierros painottaa rintaa, selän leveyttä ja etureisiä, toinen olkapäitä, selän paksuutta ja takaketjua.',
    audience:
      'Edistyneille treenaajille, jotka palautuvat kuudesta salipäivästä ja seitsemästä liikkeestä päivässä ja haluavat mahdollisimman paljon lihasta.',
    equipmentProfile:
      'Täysi sali: tanko ja teline raskaisiin kyykkyihin ja maastavetoihin, käsipainot, taljat ja laitteet.',
    whyItWorks:
      'Jokainen lihasryhmä treenataan kahdesti viikossa kahdesta eri kulmasta, joten viikkovolyymi on suuri ilman että yksikään treeni venyy.',
  },
  tpl_gainer_expert_powerbuilding_v1: {
    summary:
      'Viisi salipäivää voimanoston kilpailuliikkeiden ympärillä: penkki-, kyykky- ja maastavetopäivä viiden sarjan ankkuriliikkeellä, vetopäivä sekä punnerrus- ja pumppipäivä.',
    audience:
      'Kokeneille nostajille, jotka haluavat kilpailuliikkeisiin lisää kiloja ja samaan viikkoon kehonrakennustyötä.',
    equipmentProfile:
      'Hyvin varustettu sali: kyykkyteline, penkkipaikka, tanko ja levyt, käsipainot, taljat ja laitteet.',
    whyItWorks:
      'Kilpailuliike tehdään ensin tuoreena viidellä sarjalla, sen jälkeen sen variaatio ja lopuksi kehonrakennusliikkeet, joten voima nousee ja lihas kasvaa samassa treenissä.',
  },
  tpl_gainer_lean_shred_v1: {
    summary:
      'Viisi päivää viikossa: kolme nostopäivää, jotka päättyvät intervalleihin matolla, pyörällä tai soutulaitteella, yksi koko kehon kiertoharjoittelu ja yksi kunto- ja keskivartalopäivä.',
    audience:
      'Keskitason treenaajille, jotka pudottavat rasvaa ja haluavat pitää penkin, kyykyn ja leuanvedon painot rasvanpolton ajan.',
    equipmentProfile:
      'Tavallinen sali sekä juoksumatto, kuntopyörä tai soutulaite intervalleihin.',
    whyItWorks:
      'Raskaat perusliikkeet pitävät lihaksen kalorivajeessa, ja intervallit lisäävät kulutusta samalla salikäynnillä, joten kunto ei jää tekemättä.',
  },
  tpl_gainer_dream_body_female_v1: {
    summary:
      'Viisi salipäivää: pakarat ja takareidet, ylävartalo, etureidet ja cardio, selkä ja keskivartalo sekä koko kehon päivä. Pakarat ja ylävartalo treenataan kumpikin kahdesti viikossa.',
    audience:
      'Keskitason treenaajille, jotka haluavat kasvattaa pakaroita ja jalkoja ja pitää ylävartalon vahvana viidellä salipäivällä viikossa.',
    equipmentProfile:
      'Täysi sali: tanko lantionnostoon, käsipainot, taljat, laitteet ja porraslaite.',
    whyItWorks:
      'Lantionnosto ja romanialainen maastaveto kuormittavat pakaroita raskaasti kerran viikossa, ja lantionnosto toistuu kevyempänä koko kehon päivässä, joten pakaroiden ärsyke tulee kahdesti ilman että jalat ovat koko ajan kipeät.',
  },
  tpl_gainer_glute_foundations_v1: {
    summary:
      'Kolme päivää viikossa: aktivointipäivä kuminauhalla, alavartalon voimapäivä ja pakaroiden kasvupäivä. Painot ovat kevyitä, ja liikkeet opitaan ennen kuormaa.',
    audience:
      'Aloittelijalle tai tauolta palaavalle, joka haluaa oppia käyttämään pakaroita ja saada kyykyn, saranan ja lantionnoston tekniikan kuntoon.',
    equipmentProfile:
      'Peruskuntosalin välineet: kuminauha, käsipainot tai kahvakuula, talja ja kevyt tanko.',
    whyItWorks:
      'Ensin opitaan tuntemaan pakarat kuminauhalla, sitten kuorma tulee kyykkyyn ja saranaan ja vasta kolmantena päivänä lantionnostoon, joten voima rakentuu oikean liikemallin päälle.',
  },
  tpl_gainer_advanced_glutes_v1: {
    summary:
      'Viisi päivää viikossa, joista kolme on pakarapäiviä: raskas päivä tangolla, volyymipäivä kuminauhalla ja taljalla sekä yhden jalan päivä. Lisäksi yksi etu- ja takareisipäivä ja yksi ylävartalopäivä.',
    audience:
      'Kokeneille treenaajille, joille pakarat ovat seuraavan jakson ykkösprioriteetti ja jotka palautuvat kolmesta pakarapäivästä viikossa.',
    equipmentProfile:
      'Täysi sali: tanko ja lantionnostopaikka, taljat, laitteet, kuminauhat ja käänteinen selkäpenkki.',
    whyItWorks:
      'Raskas viiden sarjan lantionnosto, kevyt kahdenkymmenen toiston pumppi ja yhden jalan työ antavat pakaroille kolme erilaista ärsykettä viikossa, ja ylävartalo- ja reisipäivät pitävät muun kehon mukana.',
  },
  tpl_gainer_hourglass_shape_v1: {
    summary:
      'Neljä salipäivää: pakarat ja jalat, olkapäät ja selän leveys, pakarat ja keskivartalo sekä ylävartalon kiinteytys. Pakarat kahdesti, olkapäät kahdesti.',
    audience:
      'Keskitason treenaajille, jotka haluavat leveämmät hartiat, isommat pakarat ja tiukan keskivartalon neljällä salipäivällä.',
    equipmentProfile:
      'Tavallinen sali: tanko lantionnostoon, käsipainot, taljat, laitteet ja kuminauha.',
    whyItWorks:
      'Hartioiden leveys tulee sivunostoista ja leveästä ylätaljasta, pakaroiden muoto lantionnostosta ja saranasta, ja keskivartalo pidetään tiukkana staattisilla liikkeillä. Kaksi kertaa viikossa kumpaakin riittää kasvuun.',
  },
  tpl_gainer_fat_burn_hiit_v1: {
    summary:
      'Neljä päivää intervalleja: ylävartalo, alavartalo, koko keho ja tabata. Liikkeet ovat enimmäkseen kehonpainoliikkeitä ja kevyitä käsipaino- ja kahvakuulaliikkeitä, sarjat lyhyitä ja tauot lyhyempiä.',
    audience:
      'Aloittelijalle, joka haluaa kuntoa ja kulutusta neljällä lyhyellä intervallitreenillä viikossa.',
    equipmentProfile:
      'Käsipainot ja kahvakuula, koko kehon päivänä myös laatikko ja köydet. Muut liikkeet tehdään kehonpainolla.',
    whyItWorks:
      'Lyhyet kovat työjaksot nostavat sykkeen nopeasti, ja kun päivät jakautuvat ylä- ja alavartaloon, koko kehoon ja tabataan, yksikään treeni ei toista edellistä.',
  },
  tpl_gainer_mobility_flow_v1: {
    summary:
      'Viisi lyhyttä liikkuvuustreeniä viikossa: aamun koko kehon avaus, lonkat, olkapäät, selkäranka ja palauttava venyttely. Pidot ovat 30 sekunnista puoleentoista minuuttiin, ja viimeisen päivän päättävä lepoasento kestää 3–5 minuuttia.',
    audience:
      'Aloittelijalle ja kenelle tahansa, joka on jäykkä muun treenin tai istumisen jäljiltä ja haluaa liikkuvuuden kuntoon lyhyillä päivittäisillä treeneillä.',
    equipmentProfile:
      'Ei kuntosalilaitteita. Kuminauha ja jumppamatto riittävät lähes kaikkeen, ja yhteen selkäliikkeeseen tarvitaan putkirulla.',
    whyItWorks:
      'Jokainen alue saa oman päivänsä ja pidot ovat pitkiä, joten liikelaajuus kasvaa siellä, missä se on jumissa, eikä yksikään treeni vie tuntia.',
  },
  tpl_gainer_at_home_beginner_v1: {
    summary:
      'Kolme kehonpainotreeniä viikossa kotona: ylävartalo, alavartalo ja koko kehon kierto. Punnerruksia, kyykkyjä, askelkyykkyjä ja lankkuja, pöytä soutuun ja tuoli dippeihin.',
    audience:
      'Aloittelijalle, joka haluaa aloittaa voimatreenin kotona ilman välineitä kolmella treenillä viikossa.',
    equipmentProfile:
      'Ei välineitä. Tukeva pöytä soutuun ja tuoli dippeihin riittävät.',
    whyItWorks:
      'Kyykky, punnerrus, veto ja lankku toistuvat joka viikko, ja eteneminen tulee toistoista, joten voima ja kunto kasvavat ilman kilon painoja.',
  },
  tpl_home_dumbbell_upper_lower_v1: {
    summary:
      'Neljä treeniä viikossa kotona käsipainoparilla: kaksi ylävartalopäivää ja kaksi alavartalopäivää, kummastakin raskaampi ja toistoisampi versio.',
    audience:
      'Kotona käsipainoilla treenaavalle, joka haluaa neljä treeniä viikossa lihasmassaan ja voimaan.',
    equipmentProfile:
      'Käsipainopari, mieluiten säädettävä, ja lattiatilaa. Penkkiä ei tarvita: punnerrukset tehdään lattialla.',
    whyItWorks:
      'Jokainen lihas treenataan kahdesti viikossa, kerran raskaammin ja kerran useammalla toistolla, ja eteneminen tulee ensin toistoista ja sitten painosta.',
  },
  tpl_home_dumbbell_ppl_v1: {
    summary:
      'Kuusi treeniä viikossa kotona käsipainoparilla: työntö, veto ja jalat kumpikin kahdesti, kerran raskaammin ja kerran useammalla toistolla.',
    audience:
      'Kokeneelle treenaajalle, joka treenaa kotona käsipainoilla ja haluaa kuusi treeniä viikossa.',
    equipmentProfile:
      'Käsipainopari, mieluiten säädettävä, tukeva pöytä soutuun ja tuoli dippeihin. Penkkiä ei tarvita.',
    whyItWorks:
      'Jokainen lihas treenataan kahdesti viikossa kahdella eri tavalla, ja yksittäinen treeni on niin lyhyt, että se mahtuu kiireiseenkin päivään.',
  },
  tpl_home_bodyweight_upper_lower_v1: {
    summary:
      'Neljä kehonpainotreeniä viikossa: kaksi ylävartalopäivää ja kaksi alavartalopäivää. Punnerruksia, soutua pöydän alla, bulgarialaisia askelkyykkyjä ja yhden jalan liikkeitä.',
    audience:
      'Kotona ilman välineitä treenaavalle, joka on aloittelijavaiheen ohi ja haluaa neljä treeniä viikossa.',
    equipmentProfile:
      'Ei välineitä. Tukeva pöytä soutuun ja tuoli dippeihin ja askelkyykkyihin.',
    whyItWorks:
      'Lisäpainon korvaavat vaikeammat versiot: yksi jalka kahden sijaan, jalat korotettuina, hitaammat toistot. Eteneminen tulee ensin toistoista.',
  },
  tpl_home_athletic_5_day_v1: {
    summary:
      'Viisi kehonpainotreeniä viikossa kotona: työntö ja keskivartalo, jalat, koko kehon kiertoharjoitus, veto ja kunto sekä tasapainopäivä.',
    audience:
      'Kotona ilman välineitä treenaavalle, joka haluaa viisi treeniä viikossa voimaan ja kuntoon yhdessä.',
    equipmentProfile:
      'Ei välineitä. Tukeva pöytä soutuun ja tuoli dippeihin ja askelkyykkyihin.',
    whyItWorks:
      'Voima- ja kuntopäivät vuorottelevat, joten samoille lihaksille ei tule kahta raskasta treeniä peräkkäin.',
  },
  tpl_gainer_calisthenics_mastery_v1: {
    summary:
      'Neljä päivää viikossa taitoliikkeiden ympärillä: käsinseisonta ja planche, muscle-up ja front lever, pistoolikyykky ja hypyt sekä taito- ja keskivartalopäivä.',
    audience:
      'Kokeneille kehonpainotreenaajille, jotka tekevät leuanvedot ja dipit jo lisäpainolla ja haluavat seuraavaksi taidot.',
    equipmentProfile:
      'Leuanvetotanko ja dippitangot, seinä käsinseisontaan ja mielellään renkaat.',
    whyItWorks:
      'Viikossa on pitkiä pitoja, räjähtäviä liikkeitä ja voimaliikkeitä lisäpainolla, joten taito, voima ja kehonhallinta kehittyvät rinnakkain.',
  },
  tpl_gainer_strength_5x5_v1: {
    summary:
      'Kolme treeniä viikossa vuorotellen A ja B: kyykky joka kerta, A-päivänä penkki ja kulmasoutu, B-päivänä pystypunnerrus ja maastaveto. Viisi viiden toiston sarjaa, maastavedossa yksi.',
    audience:
      'Aloittelijalle, joka haluaa oppia viisi tankoliikettä ja nähdä painon nousevan joka viikko.',
    equipmentProfile:
      'Tanko, levyt, kyykkyteline ja penkki.',
    whyItWorks:
      'Kolme liikettä ja sama paino kaikissa sarjoissa on helppo kirjata ja toistaa, ja kun viisi kertaa viisi menee puhtaasti, tankoon lisätään pienin levy.',
  },
  tpl_gainer_athlete_conditioning_v1: {
    summary:
      'Viisi päivää viikossa: räjähtävä alavartalo, urheilullinen ylävartalo, nopeus ja ketteryys, voimakierto sekä kestävyys. Rinnallevetoja, hyppyjä, sprinttejä, soutuintervalleja ja kelkantyöntöä.',
    audience:
      'Kokeneille treenaajille ja urheilijoille, jotka haluavat tehoa, nopeutta ja kestävyyttä pelkän lihasmassan sijaan.',
    equipmentProfile:
      'Hyvin varustettu sali sekä tilaa sprinteille ja ketteryysradoille: tanko, kelkka, laatikko, kuntopallo, köydet, soutulaite ja kuntopyörä.',
    whyItWorks:
      'Voima, nopeus ja kestävyys ovat omilla päivillään, joten jokaista voi treenata tuoreena, ja viikon aikana kaikki kolme kehittyvät.',
  },
  tpl_gainer_strong_lean_female_v1: {
    summary:
      'Neljä salipäivää: ylävartalon voima, alavartalon voima, työntö ja keskivartalo sekä veto ja kunto. Penkki, kyykky, vinopenkin käsipainopunnerrus ja kulmasoutu ovat päivien ankkuriliikkeet.',
    audience:
      'Keskitason treenaajille, jotka haluavat lisää voimaa perusliikkeisiin ja kiinteän, urheilullisen kehon neljällä salipäivällä.',
    equipmentProfile:
      'Tavallinen sali: tanko, käsipainot, taljat, laitteet ja kahvakuula.',
    whyItWorks:
      'Ylävartalo treenataan kolmesti, kahdesti tankoliikkeestä alkaen (penkki ja kulmasoutu) ja kerran käsipainoilla, alavartalo kerran raskaasti ja lisäksi lantionnostoilla ja heilautuksilla vetopäivänä, joten voima ja lihas kehittyvät ilman että viikko käy raskaaksi.',
  },
  tpl_gainer_joint_friendly_v1: {
    summary:
      'Kolme päivää viikossa laitteilla, taljoilla ja kuminauhalla: tuettu alavartalo, tuettu ylävartalo sekä koko kehon ja tasapainon päivä. Toistoja on pääosin 12–20, ja liikkeet tehdään hallitusti.',
    audience:
      'Aloittelijalle, tauolta palaavalle tai kenelle tahansa, jonka nivelet eivät kestä raskasta vapaata painoa mutta joka haluaa lisää voimaa.',
    equipmentProfile:
      'Salin laitteet ja taljat, kuminauha ja tuoli.',
    whyItWorks:
      'Laite tukee liikeradan, joten kuorma osuu lihakseen eikä niveleen, ja korkeat toistot rakentavat voimaa kevyillä painoilla.',
  },
  tpl_gainer_prenatal_fitness_v1: {
    summary:
      'Kolme kevyttä treeniä viikossa raskausajalle: hellävarainen voima, liikkuvuus ja lantionpohja sekä kevyt cardio ja tasapaino.',
    audience:
      'Odottaville, jotka ovat saaneet terveydenhuollon ammattilaiselta luvan liikkua ja haluavat pitää voiman ja liikkuvuuden yllä.',
    equipmentProfile:
      'Käsipainot, kuminauha ja jumppamatto sekä salilta talja soutuun ja kuntopyörä.',
    whyItWorks:
      'Kevyet painot, lantionpohjan aktivointi ja rauhallinen pyöräily pitävät toimintakyvyn yllä ilman hyppyjä tai raskaita nostoja.',
  },
  tpl_gainer_postpartum_recovery_v1: {
    summary:
      'Kolme lyhyttä treeniä viikossa synnytyksen jälkeen: keskivartalon herättely hengityksestä ja lantionpohjasta alkaen, kevyt koko kehon päivä ja voiman palautus kevyillä käsipainoilla.',
    audience:
      'Synnytyksestä toipuville, jotka ovat saaneet lääkäriltä tai terveydenhuollon ammattilaiselta luvan aloittaa treenin.',
    equipmentProfile:
      'Kevyet käsipainot, kuminauha ja lattiatilaa.',
    whyItWorks:
      'Ensin opetellaan hengitys ja syvien vatsalihasten aktivointi, sitten kevyet perusliikkeet ja vasta lopuksi kuorma, joten keskivartalo palautuu ennen kuin sitä kuormitetaan.',
  },
  tpl_gainer_runners_strength_v1: {
    summary:
      'Kolme salipäivää juoksijalle: takaketju ja teho, yhden jalan tasapaino sekä keskivartalo ja liikkuvuus. Romanialainen maastaveto, lantionnosto, askelkyykyt ja hypyt.',
    audience:
      'Keskitason juoksijoille, jotka haluavat vahvemmat takareidet, pakarat ja pohkeet, pysyä ehjinä ja juosta taloudellisemmin.',
    equipmentProfile:
      'Salin perusvälineet: tanko tai käsipainot, laatikko hyppyihin, leuanvetotanko jalannostoihin ja tilaa liikkuvuudelle.',
    whyItWorks:
      'Yhden jalan liikkeet ja takaketjun vahvistaminen osuvat siihen, mitä juoksu vaatii, ja hypyt opettavat jalan tuottamaan voimaa nopeasti, joten askel kevenee ja rasitusvammat vähenevät.',
  },

  tpl_strong_elite_v1: {
    summary:
      '12 viikon Pro-voimajakso: viiden sarjan ankkuriliikkeet, raskaat ja kovat päivät sekä apuliikkeet, jotka suojaavat seuraavaa raskasta treeniä.',
    audience:
      'Kokeneille treenaajille, jotka palautuvat hyvin, osaavat perusliikkeet ulkoa ja haluavat maksimivoiman selkeäksi prioriteetiksi.',
    equipmentProfile: 'Vaatii täyden salin: tanko, teline, penkki, trap bar tai maastavetopaikka, laitteet ja taljat.',
    whyItWorks:
      'Jokainen liikemalli tehdään viikossa kerran raskaana ja kerran kovana päivänä, joten teho nousee jakson aikana ilman että viikko romahtaa väsymykseen.',
  },
  tpl_fit_elite_v1: {
    summary:
      '12 viikon Pro-jakso, jossa voima-ankkurit pysyvät liikkeessä ja kunto-osuudet rakentavat oikeaa kestävyyttä neljänä päivänä viikossa.',
    audience:
      'Kokeneille yleisosaajille, jotka haluavat voiman, kunnon ja liikkuvuuden yhteen rehelliseen viikkorakenteeseen.',
    equipmentProfile: 'Suositellaan täyttä salia: tanko, käsipainot, laitteet, kahvakuula ja cardiolaite kunto-osuuksiin.',
    whyItWorks:
      'Tehopäivät painavat perusliikkeitä ja volyymipäivät lisäävät kuntotiheyttä, joten sekä voima että kestävyys etenevät varastamatta toisiltaan.',
  },
  tpl_shred_elite_v1: {
    summary:
      '12 viikon Pro-rasvanpudotusjakso: viisi päivää, jotka pitävät voima-ankkurit paikallaan, kun HIIT-tyyppiset kunto-osuudet nostavat energiankulutusta.',
    audience:
      'Kokeneille treenaajille, jotka pudottavat rasvaa mutta eivät halua luopua voimastaan, vaikka kuntotreenin määrä kasvaa.',
    equipmentProfile: 'Suositellaan täyttä salia: tanko, laitteet, kahvakuula sekä juoksumatto tai pyörä intervalleihin.',
    whyItWorks:
      'Joka treeni yhdistää yhden rehellisen voimaosion kunto-osuuteen, joten vaje syntyy työstä jossa voi oikeasti edetä — ei turhasta volyymista.',
  },
  tpl_3_day_full_body_v1: {
    summary:
      'Kolme koko kehon treeniä, jotka pitävät voimaharjoittelun tiheänä samalla kun viikon kokonaisrasitus pysyy hallittavana.',
    audience:
      'Aloitteleville treenaajille tai kenelle tahansa, joka haluaa yksinkertaisen viikkorakenteen ja toistuvaa harjoittelua perusliikkeillä.',
    equipmentProfile: 'Suositellaan täyttä salia: tanko, penkki, talja, jalkaprässi ja perusvetopaikka.',
    whyItWorks:
      'Pohja toistaa kyykky-, punnerrus-, veto- ja saranaliikkeet viikon aikana, joten eteneminen pysyy ilmiselvänä ilman monimutkaista jakoa.',
  },
  tpl_4_day_upper_lower_v1: {
    summary:
      'Tasapainoinen ylä/ala-jako, jossa on riittävä viikkovolyymi kasvuun ja ankkuriliikkeillä silti selkeät etenemistavoitteet.',
    audience:
      'Keskitason treenaajille, jotka pääsevät salille neljästi viikossa ja haluavat enemmän ylä/ala-volyymia kuin koko kehon treeni antaa.',
    equipmentProfile: 'Suositellaan täyttä salia, erityisesti tangot, käsipainot, laitteet, ylätalja ja soutupaikat.',
    whyItWorks:
      'Jokainen liikemalli tehdään kahdesti viikossa, mikä tekee palautumisesta ennakoitavaa ja tuottaa enemmän tuottavia kovia sarjoja ilman että jokaisesta päivästä tulee maraton.',
  },
  tpl_5_day_hybrid_v1: {
    summary:
      'Tiheämpi hybridijako, joka yhdistää ylä/ala-rakenteen omiin työntö- ja vetopäiviin tarkempaa erikoistumista varten.',
    audience:
      'Keskitason treenaajille, jotka palautuvat hyvin, haluavat enemmän saliaikaa ja pitävät lihasryhmäkohtaisista päivistä ilman että eteneminen katoaa.',
    equipmentProfile: 'Vaatii täyden salin. Pohja olettaa laajan välinevalikoiman: tanko, laitteet, käsipainot ja taljat.',
    whyItWorks:
      'Viikko avautuu raskaammalla moninivelrakenteella ja lisää sitten erilliset työntö- ja vetopäivät, joten lisävolyymi osuu sinne, missä sillä on merkitystä, venyttämättä jokaista treeniä.',
  },
  tpl_2_day_minimal_full_body_v1: {
    summary:
      'Kevyt kahden päivän kehonpaino-ohjelma viikoille, joina haluat treenata koko kehon ilman salia.',
    audience:
      'Aloittelijoille, kiireisiin viikkoihin, kotitreeneihin tai kenelle tahansa treeniin palaavalle, joka haluaa silti rakenteen ja etenemisen.',
    equipmentProfile: 'Koti- ja kehonpainoystävällinen. Lattiatila ja tukeva soutupaikka riittävät ohjelman ytimeen.',
    whyItWorks:
      'Pohja pitää kyykky-, työntö-, veto-, sarana- ja keskivartaloliikkeet viikossa ja käyttää kehonpainon etenemistä salivälineiden sijaan.',
  },
  tpl_3_day_strength_base_v1: {
    summary:
      'Yksinkertainen voimaviikko, jossa on kolme raskasta treeniä, joten kyykky, punnerrus ja sarana etenevät kaikki omalla selkeällä säännöllään.',
    audience:
      'Aloitteleville treenaajille, jotka haluavat oikean voimaohjelman siirtymättä suoraan raskaaseen voimanosto-ohjelmaan.',
    equipmentProfile: 'Suositellaan täyttä salia, erityisesti tankopaikat, soutuvaihtoehto, ylätalja ja alavartalon peruslaitteet.',
    whyItWorks:
      'Jokainen treeni alkaa yhdellä ankkuriliikkeellä matalilla toistoilla ja täyttää loppupäivän riittävällä tukityöllä rakentamatta palautumisvelkaa.',
  },
  tpl_4_day_powerbuilding_v1: {
    summary:
      'Nelipäiväinen powerbuilding-ohjelma, jossa viikko avautuu voimatyöllä ja päättyy volyymiin, joka oikeasti rakentaa lihasta.',
    audience:
      'Keskitason treenaajille, jotka välittävät tangon luvuista mutta haluavat silti ylä- ja alavartalopäivien näyttävän kehonrakennustreeneiltä.',
    equipmentProfile: 'Vaatii täyden salin: tangot, käsipainot, ylätalja, soutupaikat ja alavartalon laitteet.',
    whyItWorks:
      'Jako erottaa suorituspäivät volyymipäivistä, joten perusliikkeet pysyvät tuoreina ja rinta, selkä, olkapäät ja jalat keräävät silti tarpeeksi kasvutyötä viikon aikana.',
  },
  tpl_2_day_beginner_strength_v1: {
    summary:
      'Kahden päivän voimaharjoittelun aloituspiste, joka pitää liikevalikoiman yksinkertaisena mutta antaa kyykylle, punnerrukselle, saranalle ja vedolle tilaa edetä.',
    audience:
      'Uusille treenaajille, jotka haluavat selkeää tankoetenemistä sitoutumatta heti kolmeen tai neljään viikkotreeniin.',
    equipmentProfile: 'Suositellaan täyttä salia, mutta liikemäärä pysyy niin pienenä että päivät on helppo oppia ja toistaa.',
    whyItWorks:
      'Ohjelma riisuu voimatyön perusliikkeisiin, joten energia menee toistettaviin nostoihin eikä vaihtelun jahtaamiseen liian aikaisin.',
  },

  tpl_3_day_upper_lower_lite_v1: {
    summary:
      'Kevyempi kolmen päivän ylä/ala-jako, joka pitää viikon tasapainossa vaatimatta pitkiä tai liian tiiviitä treenejä.',
    audience:
      'Aloittelijoille, jotka haluavat koko kehon treeniä vaihtelevampaa mutta eivät ole vielä valmiita klassiseen nelipäiväiseen jakoon.',
    equipmentProfile: 'Tavallinen täysi sali toimii parhaiten, mutta treenin pituus ja liikemäärä pysyvät maltillisina.',
    whyItWorks:
      'Jako antaa ylävartalolle kaksi treeniä ja alavartalolle yhden isomman päivän, joten sekä tekniikkaharjoittelu että palautuminen pysyvät helposti hallinnassa.',
  },

  tpl_3_day_push_pull_legs_v1: {
    summary:
      'Klassinen kolmen päivän PPL, jossa jako pysyy tuttuna mutta eteneminen noudattaa selkeitä sääntöjä satunnaisen salivolyymin sijaan.',
    audience:
      'Keskitason kasvujaksoihin, kun haluat tunnistettavan lihasryhmäjaon ajautumatta turhaan volyymiin.',
    equipmentProfile: 'Suositellaan täyttä salia, erityisesti punnerruslaitteet, ylätalja/soutupaikat ja kunnolliset alavartalon laitteet.',
    whyItWorks:
      'Jokaisella päivällä on vain yksi iso tehtävä, joten rinta/olkapäät, selkä/kädet ja jalat saavat painetta erikseen ilman että väsymys laahaa läpi viikon.',
  },

  tpl_4_day_muscle_builder_v1: {
    summary:
      'Nelipäiväinen kasvupohja, joka pysyy lähestyttävänä aloitteleville mutta antaa silti riittävän kokonaisvolyymin kasvuun.',
    audience:
      'Aloittelijoille, jotka haluavat siirtyä koko kehon rakenteesta oikeaan ylä/ala-lihaskasvujakoon.',
    equipmentProfile: 'Suositellaan täyttä salia, erityisesti laitteet, käsipainot ja alavartalon peruslaitteet.',
    whyItWorks:
      'Jako toistaa ylä- ja alavartalon kahdesti viikossa, mutta liikevalinnat pysyvät aloittelijaystävällisinä, joten kuorma kasvaa ennen monimutkaisuutta.',
  },

  tpl_4_day_strength_size_v1: {
    summary:
      'Nelipäiväinen jakso, joka antaa viikolle selkeät suorituspäivät ja jättää silti tilaa merkitykselliselle kasvutyölle.',
    audience:
      'Keskitason treenaajille, jotka haluavat enemmän raskasta nostoa kuin puhdas kehonrakennusjako mutta enemmän kasvutyötä kuin riisuttu voimaohjelma.',
    equipmentProfile: 'Vaatii täyden salin, erityisesti tangot, ylätalja/soutuvaihtoehdot ja riittävästi alavartalon välineitä raskaille ja kevyemmille päiville.',
    whyItWorks:
      'Viikon alkupuoli hoitaa raskaimman työn ja loppupuoli lisää volyymin, joka pitää koon ja liikesietokyvyn kehittymässä.',
  },
  tpl_2_day_mobility_reset_v1: {
    summary:
      'Kevyt kahden päivän palautumisohjelma: liikkuvuutta, hengitysharjoituksia ja rauhallista liikkeen laadun harjoittelua.',
    audience:
      'Palautusviikkoihin, aloitusvaiheisiin tai kenelle tahansa, joka haluaa kevyemmän aloituksen kuin täysi voimajako.',
    equipmentProfile: 'Ei vaadi raskaita välineitä. Ohjelma toimii lattiatilan ja kehonpainon varassa palautusjaksona.',
    whyItWorks:
      'Treenit toistavat yksinkertaisia liikkuvuusmalleja ja hengitystyötä, joten rakennat ensin säännöllisyyden ja lisäät kierroksia vasta kun liike tuntuu luontevalta.',
  },
  tpl_2_day_yoga_recovery_v1: {
    summary:
      'Kahden päivän joogapainotteinen palautusjakso liikkuvuudelle, tasapainolle, hengitykselle ja hitaammalle koko kehon liikeharjoittelulle.',
    audience:
      'Aloittelijoille, liikkuvuuspainotteisiin viikkoihin tai kenelle tahansa, joka haluaa rauhallisemman liikevaihtoehdon Vinhan sisällä.',
    equipmentProfile: 'Matto ja oma kehonpaino riittävät. Salia ei tarvita.',
    whyItWorks:
      'Ohjelma käyttää lyhyitä toistettavia sarjoja monimutkaisen sekvenssin sijaan, joten joogasta saa tavan ilman tunnin studiotuntia joka kerta.',
  },
  tpl_3_day_run_mobility_v1: {
    summary:
      'Aloittelijaystävällinen juoksu- ja palautuspohja, joka yhdistää intervallipohjaiset juoksublokit liikkuvuus- ja palautumistyöhön.',
    audience:
      'Niille, jotka haluavat yksinkertaisen juoksun aloituspisteen Vinhan nykymallissa hyppäämättä suoraan suuriin kilometrimääriin.',
    equipmentProfile: 'Välineitä tarvitaan vähän. Juoksupäivät on rakennettu yksinkertaisiksi blokeiksi, ja palautuspäivä vaatii vain lattiatilaa.',
    whyItWorks:
      'Sen sijaan että jahtaisit heti pitkiä lenkkejä, ohjelma vuorottelee kevyitä ja tempotyylisiä juoksublokkeja oman palautuspäivän kanssa, jotta jalat ja lonkat pysyvät mukana.',
  },

  tpl_season_summer_v1: {
    summary:
      'Kesäkauden ohjelma: kolme päivää, joissa jokaisessa on lyhyt voimaosuus ja juoksuosuus peräkkäin. Tankoa ei tarvita missään kohtaa.',
    audience:
      'Kesäkauteen osallistuville - ja kenelle tahansa, jonka salilla käyminen muuttuu epäsäännölliseksi huhtikuun ja syyskuun välillä.',
    equipmentProfile:
      'Käsipainopari tai kahvakuula, jokin tanko tai pöytä jonka alla soutaa, ja paikka juosta. Ei tankoa, ei laitteita.',
    whyItWorks:
      'Voima ja juoksu jaetaan yleensä eri päiville, ja sitten juoksu lakkaa hiljaa tapahtumasta. Kun juoksuosuus on jokaisen treenin lopussa, kunto karttuu niinä päivinä joina olit joka tapauksessa treenaamassa.',
  },

  tpl_season_winter_v1: {
    summary:
      'Talvikauden ohjelma: neljä päivää, ylä- ja alavartalo kahdesti, jokaisessa treenissä yksi raskas ankkuriliike ja jalkapäivien lopussa lyhyt kunto-osuus.',
    audience:
      'Talvikauteen osallistuville, jotka osaavat perusliikkeet jo ja haluavat että pimeä puolivuotinen jättää jotain käteen.',
    equipmentProfile:
      'Vaatii täyden salin. Tanko, käsipainot, ylätalja ja reisikoukistuslaite sekä pyörä tai juoksumatto kunto-osuuksiin.',
    whyItWorks:
      '26 viikkoa on tarpeeksi pitkä aika tehdä yksi raskas ankkuriliike joka treenissä ilman että sitä tarvitsee pakottaa, ja kaksi lyhyttä kunto-osuutta pitää kesällä rakennetun kunnon tallella maaliskuuhun asti.',
  },

  tpl_4_day_ppl_plus_v1: {
    summary:
      'Nelipäiväinen PPL+1-jako, joka lisää klassiseen työntö/veto/jalat-malliin oman ylävartalotreenin viikkovolyymin kasvattamiseksi ilman kuutta treenipäivää.',
    audience:
      'Keskitason treenaajille, jotka ovat kasvaneet ulos kolmen päivän PPL:stä mutta eivät ole valmiita täyteen kuuden päivän sitoumukseen.',
    equipmentProfile: 'Vaatii täyden salin. Pohja olettaa tangon, käsipainot, taljat, ylätaljan ja laitteet läpi viikon.',
    whyItWorks:
      'Kun neljäs päivä on ylävartalon lisäpäivä eikä toinen jalkapäivä, jalat eivät ylikuormitu ja rinta, selkä ja kädet saavat toisen kunnollisen treenikerran viikkoon.',
  },

  tpl_5_day_ppl_v1: {
    summary:
      'Viiden päivän PPL-jakso, jossa työntö ja veto tehdään kahdesti viikossa ja yksi jalkapäivä sijoittuu keskelle, jotta alavartalo ehtii palautua.',
    audience:
      'Keskitason ja edistyneille treenaajille, jotka treenaavat viitenä päivänä viikossa ja haluavat runsasvolyymisen työntö/veto-rakenteen.',
    equipmentProfile: 'Vaatii täyden salin kaikkina viitenä päivänä. Talja- ja laitepääsy on erityisen tärkeää toisilla työntö- ja vetotreeneillä.',
    whyItWorks:
      'Kun työntö ja veto tehdään kahdesti viikossa, ylävartalo saa kaksi treenikertaa ilman toista raskasta jalkapäivää, joka veisi palautumisen.',
  },

  tpl_5_day_upper_lower_full_v1: {
    summary:
      'Viiden päivän ohjelma, jossa ylä- ja alavartalo treenataan kahdesti viikossa ja viikko päättyy koko kehon treeniin lisäharjoittelua ja volyymia varten.',
    audience:
      'Keskitason treenaajille, jotka haluavat lisätä viidennen päivän tuplaamatta yhtä lihasryhmää liian aggressiivisesti.',
    equipmentProfile: 'Vaatii täyden salin. Koko kehon päivä on tarkoituksella kevyempi, joten se toimii salilla jossa on perustanko ja laitteet.',
    whyItWorks:
      'Koko kehon päivä toimii tekniikka- ja volyymipuskurina — se pitää jokaisen liikemallin viikossa kolme kertaa kuormittamatta yhtäkään niin että palautuminen kärsisi.',
  },

  tpl_6_day_ppl_v1: {
    summary:
      'Klassinen kuuden päivän PPL-tupla: työntö, veto ja jalat kahdesti viikossa maksimaalisen viikkovolyymin ja -tiheyden vuoksi.',
    audience:
      'Edistyneille treenaajille, jotka palautuvat hyvin suuresta viikkovolyymista ja haluavat treeniviikkoon eniten erikoistumisaikaa.',
    equipmentProfile: 'Vaatii täyden salin kaikkina kuutena päivänä. Laitevalikoima auttaa erityisesti B-treeneissä, joissa volyymi on huipussaan.',
    whyItWorks:
      'Kun koko PPL-kierto tehdään kahdesti, jokainen iso lihasryhmä saa kaksi erillistä ärsykettä viikossa ilman että yksittäinen treeni venyy.',
  },

  tpl_6_day_arnold_v1: {
    summary:
      'Kuusi päivää rinta/selkä-, olkapäät/kädet- ja jalkatreeniä — Arnold Schwarzeneggerin kuuluisaksi tekemä rakenne nykyaikaisella tuplaprogressiolla.',
    audience:
      'Edistyneille treenaajille, jotka pitävät vastavaikuttajalihasten yhdistämisestä ja haluavat tiheän kehonrakennusjaon vahvalla rakenteellisella logiikalla.',
    equipmentProfile: 'Vaatii täyden salin kaikkina kuutena päivänä, erityisesti punnerruslaitteet, taljat ja täydet alavartalon laitteet.',
    whyItWorks:
      'Rinnan yhdistäminen selkään ja olkapäiden käsiin antaa yhden lihaksen palautua toisen työskennellessä, mikä pitää treenin tiheyden korkeana ilman että yhden lihaksen väsymys vie tehon.',
  },

  tpl_focus_chest_v1: {
    summary: 'Oma rintatreeni: punnerrusta useasta kulmasta ja avaavia liikkeitä, joilla rinnan volyymi saadaan täyteen yhdellä salikäynnillä.',
    audience: 'Parhaiten lisäpäivänä, erikoistumisjaksona tai itsenäisenä rintatreeninä omassa viikkosuunnitelmassa.',
    equipmentProfile: 'Vaatii tasa- ja vinopenkin, käsipainot ja mielellään taljan tai pec deck -laitteen.',
    whyItWorks:
      'Treeni osuu rintaan kolmesta kulmasta — tasainen, vino ja avaava — joten sekä ylä- että alaosa saavat suoraa työtä yhdessä tehokkaassa blokissa.',
  },

  tpl_focus_back_v1: {
    summary: 'Täysi selkätreeni, joka kattaa leveän selän, yläselän ja takaolkapäät veto-, soutu- ja kohautusliikkeillä.',
    audience: 'Parhaiten itsenäisenä selkäpäivänä, täydentävänä vetotreeninä tai osana omaa tiheämpää viikkoa.',
    equipmentProfile: 'Vaatii leuanveto- tai ylätaljapaikan, tanko- tai taljasoutupaikan sekä kasvoilleveto- tai takaolkapäälaitteen.',
    whyItWorks:
      'Pysty- ja vaakavetojen yhdistäminen takaolkapäätyöhön varmistaa, että kaikki kolme selän pääaluetta — leveä selkä, keskiselkä ja takaolkapää — treenataan yhdessä treenissä.',
  },

  tpl_focus_shoulders_v1: {
    summary:
      'Olkapäihin keskittyvä treeni punnerruksen sekä sivu- ja takaolkapään eristyksen ympärillä, joka lisää viikkovolyymia ylikuormittamatta työntöpäiviä.',
    audience:
      'Treenaajille, jotka haluavat lisää olkapäiden kehitystä nykyisen ohjelman päälle tai kohdennetun olkapääpäivän omaan jakoon.',
    equipmentProfile: 'Vaatii käsipainot, tanko- tai laitepunnerrusvaihtoehdon sekä talja- tai laitepääsyn takaolkapäätyöhön.',
    whyItWorks:
      'Punnerruksen erottaminen eristyksestä antaa sivu- ja takaolkapäille suoraa työtä sen sijaan että ne jäisivät rintapäivien sivutuotteeksi.',
  },

  tpl_focus_arms_v1: {
    summary:
      'Itsenäinen käsitreeni hauiskääntöjen ja ojentajaojennusten kanssa useista kulmista suoraa käsikehitystä varten.',
    audience:
      'Treenaajille, jotka haluavat lisää käsivolyymia työntö- ja vetopäivien päälle, tai kenelle tahansa, jolla on oma käsipäivä.',
    equipmentProfile: 'Vaatii käsipainot, tangon tai EZ-tangon sekä taljapääsyn kääntöihin ja pushdowneihin.',
    whyItWorks:
      'Suora hauis- ja ojentajatyö samassa treenissä pitää treenin lyhyenä ja varmistaa silti että molemmat lihasryhmät saavat kasvuun riittävän ärsykkeen.',
  },

  tpl_focus_legs_v1: {
    summary:
      'Koko jalkatreeni etureisille, takareisille, pakaroille ja pohkeille, joka rakentaa alavartalon volyymia yhdellä salikäynnillä.',
    audience: 'Parhaiten itsenäisenä jalkapäivänä, lisätreeninä tai alavartalon ankkurina omassa jaossa.',
    equipmentProfile: 'Vaatii kyykkytelineen, jalkaprässin, takareisikoukistuslaitteen ja pohjenostopaikan.',
    whyItWorks:
      'Treenissä tehdään kyykky-, sarana- ja yhden jalan liikkeet ennen eristäviä, mikä on alavartalon moninivelliikkeille paras järjestys väsymyksen kannalta.',
  },

  tpl_focus_glutes_v1: {
    summary:
      'Pakaroihin keskittyvä treeni lantionnoston, taljapotkun ja romanialaisen maastavedon ympärillä kohdennettuun takaketjun kehitykseen.',
    audience:
      'Treenaajille, jotka haluavat enemmän pakaravolyymia kuin tavalliset jalkapäivät antavat, tai kenelle tahansa pakaroiden erikoistumisjaksolla.',
    equipmentProfile: 'Vaatii lantionnostopenkin tai vakaan alustan, taljalaitteen ja mahdollisuuden romanialaiseen maastavetoon.',
    whyItWorks:
      'Treeni priorisoi lonkan ojennusmalleja, jotka kuormittavat pakaroita pitkässä lihaspituudessa — tutkimusten mukaan se tuottaa enemmän kasvua kuin se, mitä moninivelliikkeistä tulee sivutuotteena.',
  },

  tpl_shred_v1: {
    summary:
      'Kolme koko kehon treeniä, jotka yhdistävät moninivelnostot oikeisiin kunto-osuuksiin — rakennettu rasvanpudotukseen lihasta säilyttäen.',
    audience: 'Kenelle tahansa, jonka päätavoite on rasvanpudotus ja joka haluaa voimatyön ja kunnon samalle käynnille.',
    equipmentProfile: 'Suositellaan täyttä salia: tanko, laitteet, kahvakuula sekä juoksumatto tai pyörä kunto-osuuksiin.',
    whyItWorks:
      'Raskaat perusliikkeet suojaavat lihasta kalorivajeessa, ja joka treeni päättyy kunto-osuuteen, joka lisää oikeaa energiankulutusta — nimi toimii vain koska kunto on oikeasti mukana suunnitelmassa.',
  },

  tpl_huge_starter_v1: {
    summary: 'Kaksi tehokasta koko kehon treeniä, jotka rakentavat lihasta pienimmällä mahdollisella viikkokitkalla.',
    audience: 'Uusille treenaajille, jotka haluavat kasvattaa lihasta kahtena salipäivänä viikossa ilman monimutkaista jakoa.',
    equipmentProfile: 'Suositellaan täyttä salia: penkki, jalkaprässi, taljapaikat ja käsipainot.',
    whyItWorks:
      'Jokainen iso lihas treenataan kahdesti viikossa moninivelliikkeillä, ja lyhyet treenit pitävät säännöllisyyden korkealla — aloittelijan kasvun tärkein tekijä.',
  },

  tpl_focus_chest_program_v1: {
    summary:
      'Kolmen päivän erikoistumisjakso, jossa rinta treenataan kahdesti viikossa muun kehon pysyessä ylläpitovolyymilla.',
    audience: 'Keskitason treenaajille, joiden rinta laahaa perässä ja jotka voivat sitoutua kolmeen päivään viikossa.',
    equipmentProfile: 'Vaatii täyden salin: tasa- ja vinopenkki, laitteet, käsipainot ja taljat.',
    whyItWorks:
      'Rinnan tiheyden tuplaaminen raskaalla ja volyymipäivällä tuottaa kasvua, ja yksi ylläpitopäivä estää selkää ja jalkoja taantumasta.',
  },

  tpl_focus_back_program_v1: {
    summary:
      'Kolmen päivän erikoistumisjakso, jossa selkä treenataan kahdesti viikossa punnerruksen ja jalkojen pysyessä ylläpitovolyymilla.',
    audience: 'Keskitason treenaajille, jotka haluavat leveämmän ja paksumman selän ja voivat treenata kolmesti viikossa.',
    equipmentProfile: 'Vaatii täyden salin: tanko, ylätalja- ja soutupaikat sekä taljat.',
    whyItWorks:
      'Raskas soutupäivä ja ylätaljavetoinen volyymipäivä tuplaavat selän viikkoärsykkeen, ja yksi koko kehon ylläpitopäivä suojaa muuta edistymistä.',
  },

  tpl_focus_arms_program_v1: {
    summary: 'Kolmen päivän erikoistumisjakso kahdella suoralla käsipäivällä ja yhdellä koko kehon ylläpitopäivällä.',
    audience: 'Keskitason treenaajille, joiden kädet laahaavat rinnan ja selän kehityksen perässä.',
    equipmentProfile: 'Vaatii täyden salin: tanko, EZ-tanko tai käsipainot ja taljapaikat.',
    whyItWorks:
      'Kädet palautuvat nopeasti, joten hauiksen ja ojentajan suora treenaaminen kahdesti viikossa lisää oikeaa volyymia varastamatta palautumista muulta viikolta.',
  },

  tpl_focus_legs_program_v1: {
    summary:
      'Kolmen päivän erikoistumisjakso, jossa jalat treenataan kahdesti viikossa — yksi raskas kyykkypäivä, yksi volyymipäivä — ja yksi ylävartalon ylläpitopäivä.',
    audience: 'Keskitason treenaajille, jotka haluavat tosissaan alavartalon kasvua ja palautuvat kahdesta kovasta jalkapäivästä.',
    equipmentProfile: 'Vaatii täyden salin: kyykkyteline, hack squat tai jalkaprässi, takareisikoukistuslaite ja pohjepaikka.',
    whyItWorks:
      'Kyykkyvetoinen raskas työ ja laitevetoinen volyymityö tuplaavat viikon kasvuärsykkeen, ja ylävartalopäivä pitää punnerruksen ja vedon tasolla.',
  },

  tpl_focus_glutes_program_v1: {
    summary:
      'Kolmen päivän erikoistumisjakso kahdella pakaravetoisella alavartalopäivällä ja yhdellä ylävartalon ylläpitopäivällä.',
    audience: 'Treenaajille, joille pakaroiden kasvu on seuraavan jakson selkeä ykkösprioriteetti.',
    equipmentProfile: 'Vaatii täyden salin: lantionnostopaikka, kyykkyteline tai jalkaprässi ja takareisikoukistuslaite.',
    whyItWorks:
      'Lantionnosto- ja saranamallit kuormittavat pakaroita suoraan kahdesti viikossa, ja kyykky- ja askelkyykkyvariaatiot lisäävät ärsykettä toisesta kulmasta.',
  },
};

/** Finnish text for programs generated outside the curated map. */
export const FALLBACK_READY_PROGRAM_CONTENT_FI: ReadyProgramContent = {
  summary:
    'Vinha-ohjelma, jossa on valmiit treenit, toistotavoitteet ja selvät etenemissäännöt.',
  audience:
    'Sinulle, jos alkukyselyn vastauksesi osuvat tämän ohjelman päiviin, tasoon ja painotukseen.',
  equipmentProfile:
    'Välineet määräytyvät ohjelman liikkeistä. Käy ensimmäinen viikko läpi ennen aloitusta, jos salisi valikoima on rajallinen.',
  whyItWorks:
    'Ohjelma kokoaa treenipäivät toistettavaksi viikoksi ja pitää sarjat, toistot ja lepoajat näkyvissä, joten etenemistä on helppo seurata.',
};


