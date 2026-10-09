# Tietoturvaloukkaus: toimintasuunnitelma

Tämä on ohje sille hetkelle, kun jokin on vuotanut tai näyttää vuotaneen. Lue
ensin kohta 1 ja toimi sen mukaan. Loput luetaan, kun ensimmäinen tunti on
takana.

Laki antaa **72 tuntia** siitä, kun loukkaus huomataan, ilmoittaa siitä
tietosuojavaltuutetulle (GDPR 33 art.). Aika alkaa huomaamisesta, ei
selvityksen valmistumisesta.

---

## 1. Ensimmäinen tunti

1. **Kirjaa kellonaika.** Milloin huomasit, mistä, ja mitä näit. Kuvakaappaus
   tai kopio viestistä talteen.
2. **Pysäytä vuoto.** Nopein tapa on hätäkatkaisin (kohta 1a), joka sulkee
   kaikki palvelintoiminnot kerralla. Kierrätä sen jälkeen vuotanut avain
   (kohta 3). Pysäytys menee selvityksen edelle.
3. **Älä poista todisteita.** Tallenna Vercelin lokit heti (Project → Logs →
   aikaväli → vienti tai kuvakaappaus). Vercel säilyttää lokeja vain lyhyen
   ajan.
4. **Älä kerro julkisesti vielä mitään.** Ilmoitus tehdään kohdan 5 mukaan,
   kun tiedetään mitä tapahtui.

## 1a. Hätäkatkaisin ja tiedote

**Katkaisin.** Vercel → projekti → Settings → Environment Variables →
lisää `SERVICE_PAUSED` = `1` (Production) → Deployments → uusin →
**Redeploy**. Muutos tulee voimaan uuden deployn myötä, noin minuutissa.
Sen jälkeen jokainen rajapinta (valmentaja, varmuuskopio, tilastot,
siivous-cron, valvonta) vastaa `503 SERVICE_PAUSED` lukematta tai
kirjoittamatta mitään. Appi toimii edelleen: treenit kirjataan puhelimeen,
valmentaja vastaa laitteen omilla vastauksilla ja varmuuskopio yrittää
myöhemmin. Katkaisin pois: poista muuttuja tai aseta `0`, ja tee Redeploy.

Kaksi pyyntöä toimii katkaisimesta huolimatta, koska ne vain poistavat:
pilvivarmuuskopion poisto (Asetukset → Poista pilvivarmuuskopio) ja
valmentajakopioiden suostumuksen peruminen. Tauko pysäyttää myös
tilastojen 24 kk siivouksen, joten pura se heti kun vuoto on tukittu.

**Tiedote.** Samaan paikkaan muuttuja `APP_NOTICE`, arvona yksi rivi JSONia:

```json
{"id":"2026-11-03-varmuuskopio","fi":{"title":"Varmuuskopio tauolla","body":"…"},"en":{"title":"Backup paused","body":"…"}}
```

Tee sen jälkeen Redeploy. Appi kysyy tiedotetta käynnistyessään ja
palatessaan käyttöön muutaman tunnin tauon jälkeen, ja näyttää sen kerran.
Kumpikin kieli on pakollinen, koska puolikas tiedote ei näy kenellekään.
Uusi `id` tarkoittaa uutta tiedotetta. Otsikko on enintään 80 merkkiä ja
teksti 800. `/api/notice` pysyy auki katkaisimesta huolimatta, jotta tauon
syyn voi kertoa. Tiedote tavoittaa kaikki, jotka avaavat apin verkossa;
kirjautumista tai tilastoja ei tarvita.

## 2. Mitä palvelimella on

Kaikki palvelindata on yhdessä Vercel Blob -säilössä `vinha-backups`
(Tukholma, `arn1`). Säilö on yksityinen: yksikään tiedosto ei aukea
osoitteella ilman palvelimen tunnistetta.

| Kansio | Sisältö | Henkilötieto? | Säilytys |
|---|---|---|---|
| `backups/` | Käyttäjän koko appidata: treenit, paino, mitat, asetukset. Tiedoston nimi on HMAC Google-tunnisteesta, ei sähköpostia. | **Kyllä, terveystietoja** | Kunnes käyttäjä poistaa |
| `transcripts/` | Valmentajakeskustelut, jotka käyttäjä salli tallentaa (nimi `<label>--<aika>`) | Kyllä, voi sisältää terveystietoja | 24 kk tai kunnes käyttäjä poistaa |
| `events/` | Anonyymit käyttötilastot | Ei suoraan | 24 kk (cron `/api/prune-events`) |

Kolmannet osapuolet, joille dataa kulkee:

- **Anthropic:** valmentajan kysymys ja treenikonteksti. Poistetaan 30 päivässä, ei käytetä koulutukseen.
- **Google:** kirjautuminen.
- **Vercel:** palvelin ja tallennus.

Laitteella oleva data ei ole palvelimen loukkauksen piirissä. Suurin osa
käyttäjistä ei ole kirjautunut, joten heidän tietonsa eivät ole palvelimella
lainkaan.

## 3. Salaisuudet: mitä vuotanut avain antaa ja miten se vaihdetaan

| Salaisuus | Missä | Mitä vuotaja saa | Vaihto |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel env | Käyttää Claudea sinun laskullasi. Ei käyttäjädataa. | Claude Console → Revoke → uusi avain Verceliin → redeploy. Vaikutus käyttäjiin: ei mitään. |
| Vercel-tili | Kirjautuminen | **Kaiken:** Blob-säilö, ympäristömuuttujat, deploy | Salasana ja 2FA heti, istunnot ulos, tarkista tiimin jäsenet ja tokenit (Settings → Tokens), sitten kaikki alla olevat. |
| `BACKUP_PATH_SECRET` | Vercel env | Yksin ei mitään: säilö on yksityinen. Yhdessä Blob-pääsyn kanssa kertoo, mikä tiedosto on kenen. | ⚠️ **Vaihto orpouttaa kaikki varmuuskopiot.** Vaihda vain, jos myös Blob-pääsy on vuotanut, ja siirrä tiedostot uusiin nimiin samalla. |
| `CRON_SECRET`, `ANALYTICS_READ_SECRET` | Vercel env, `.env.local` | Lukevat tilastoja tai ajavat siivouksen | Vaihda vapaasti: uusi arvo Verceliin ja `.env.local`iin, redeploy. |
| `AI_COACH_APP_KEY` | Vercel env **ja APK** | Kutsuu valmentajaa ohi apin. Arvo on jokaisessa APK:ssa, joten se ei ole aito salaisuus. Suojana ovat pyyntörajat. | Uusi arvo vaatii uuden appiversion. Pakota päivitys update gatella (`docs/app-updates.md`). |
| `SLACK_WEBHOOK_BUGS` | Ympäristömuuttuja | Postaa #bugs-kanavalle | Slack → poista webhook → uusi. |
| GitHub-tili tai -token | Kirjautuminen | Koodi ja Actions-salaisuudet. **Repo on julkinen**, joten koodi ei ole salaisuus. | Salasana, 2FA, tokenit pois, Actions-salaisuudet uusiksi. |
| Upload-keystore | Oma kone | Voi allekirjoittaa päivityksiä | Play Console → upload-avaimen vaihtopyyntö. |
| Kehityskone (varastettu) | `.env.local`, keystore, kirjautumiset | Kaikki koneella olevat | Kaikki yllä olevat. |

**Julkinen repo on yleisin vuotoreitti.** Jos avain päätyy commitiin, se on
vuotanut, vaikka commit poistettaisiin: vaihda avain, historian siivous ei
riitä.

## 4. Ensimmäinen vuorokausi: selvitys

Kirjaa vastaukset loukkausrekisteriin (kohta 7):

- Mitä tapahtui ja milloin (aikajana)?
- Mitä dataa ja keiden? Kuinka monta ihmistä, arvio riittää.
- Oliko mukana terveystietoja? `backups/` ja `transcripts/` = kyllä.
- Onko vuoto pysäytetty?
- Mistä se johtui?

## 5. 72 tunnin sisällä: ilmoitukset

**Tietosuojavaltuutetulle** ilmoitetaan aina, ellei ole epätodennäköistä, että
loukkaus aiheuttaa riskiä ihmisille. Vinhan palvelindata on terveystietoa,
joten **oleta, että ilmoitus tehdään.**

- Sähköinen lomake: tietosuoja.fi → Tietoturvaloukkausilmoitus.
- Jos kaikkea ei vielä tiedetä, ilmoita se mitä tiedät ja täydennä myöhemmin.
  Myöhästyminen on pahempi kuin keskeneräisyys.

**Käyttäjille** ilmoitetaan ilman aiheetonta viivytystä, jos riski on
**korkea** (esim. terveystiedot päätyivät ulkopuoliselle). Kerro selkokielellä:

1. mitä tapahtui
2. mitä tietoja se koski
3. mitä teimme
4. mitä käyttäjä voi tehdä itse, esim. poistaa pilvivarmuuskopion.

Kanava on apin sisäinen tiedote (kohta 1a). Sähköposteja ei kerätä, joten
se, joka ei avaa appia, näkee ilmoituksen vasta seuraavalla kerralla. Lisää
tarvittaessa sama teksti kauppasivun kuvaukseen ja verkkosivulle.

Muut ilmoitukset tarpeen mukaan:

- **Anthropic** (avaimen väärinkäyttö): support.
- **Vercel** (tili tai infra): support.
- **Poliisi:** jos kyse on tietomurrosta.

## 6. Jälkeenpäin

- Korjaa juurisyy koodissa. Lisää testi, joka kaatuu samaan virheeseen.
- Päivitä tietosuojaseloste (`src/lib/legalDocuments.ts`), jos jokin lupaus
  muuttui.
- Vapaa kuvaus kohtaan "mitä opittiin" loukkausrekisteriin.

## 7. Loukkausrekisteri

GDPR vaatii kirjaamaan **jokaisen** loukkauksen, myös ne joista ei ilmoiteta.
Yksi rivi per tapaus, esim. taulukkona:

| Kenttä | Esimerkki |
|---|---|
| Huomattu | 2026-11-03 14.20 |
| Mitä | `ANTHROPIC_API_KEY` näkyi commitissa `abc123` |
| Data | Ei käyttäjädataa |
| Ihmisiä | 0 |
| Pysäytetty | 14.35, avain kierrätetty |
| Ilmoitettu TSV:lle | Ei: ei riskiä ihmisille, perustelu kirjattu |
| Käyttäjille | Ei |
| Juurisyy ja korjaus | `.env` puuttui `.gitignore`sta; lisätty ja tarkistettu |

## 8. Tehtävä ennen julkaisua (aukot)

- [x] **Hätäkatkaisin** `SERVICE_PAUSED` (kohta 1a). Kokeile kerran ennen
      julkaisua: päälle, Redeploy, valmentaja vastaa laitteelta, pois.
- [x] **Tiedote käyttäjille apissa** `APP_NOTICE` (kohta 1a). Kokeile samalla
      kertaa testitiedotteella.
- [ ] **2FA** Verceliin, GitHubiin, Googleen, Claude Consoleen ja Play Consoleen.
- [ ] **Salaisuudet salasanamanageriin** (`BACKUP_PATH_SECRET` ja keystore
      myös toiseen paikkaan).
- [ ] **Vanhat kehityslokit pois** `transcripts/`-kansiosta (nimet ilman
      `--`, päivätty 11.9.2026 tai aiemmin).
- [ ] **Harjoitus kerran vuodessa:** käy kohta 3 läpi yhden avaimen osalta
      oikeasti.
