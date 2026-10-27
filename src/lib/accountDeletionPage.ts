import { AppLanguage } from '../types/models';
import { ANALYTICS_RETENTION_MONTHS } from './analyticsRetention';
import { t } from './i18n';
import { LEGAL_ENTITY } from './legalDocuments';

/**
 * The public "delete your account" page — the URL Play's Data safety form asks
 * for. Play counts Google sign-in as an account, so the page is required even
 * though signing in is optional, and it must work "without sending the user
 * back to the app and requiring them to re-download it": the first section
 * deletes from the browser (lib/webAccountDeletion), the app comes second.
 *
 * Every button name is read from the app's own strings, so a renamed button
 * renames the page too. What is deleted and what stays repeats the privacy
 * policy's "Delete account" paragraph; keep the two saying the same thing.
 */
type AccountDeletionSection = {
  heading: string;
  body?: string[];
  steps?: string[];
  bullets?: string[];
  /** The browser deletion form goes under this section's text. */
  webDeletion?: boolean;
};

type AccountDeletionPage = {
  title: string;
  summary: string;
  sections: AccountDeletionSection[];
  /** What the browser form says at each step. `{email}` is the signed-in account. */
  web: {
    noScript: string;
    confirm: string;
    confirmButton: string;
    cancelButton: string;
    working: string;
    done: string;
    signInFailed: string;
    refused: string;
    rateLimited: string;
    failed: string;
  };
};

/** Apple sign-in markers are cleared once this many days have passed (api/backup.ts APPLE_SESSION_DAYS). */
export const APPLE_DELETION_MARKER_DAYS = 180;

/** Section labels are upper case in the app; the page names them as words. */
function sectionName(language: AppLanguage, key: 'settings.section.dangerZone'): string {
  const label = t(language, key);
  return label.charAt(0) + label.slice(1).toLocaleLowerCase(language === 'fi' ? 'fi-FI' : 'en-GB');
}

export function buildAccountDeletionPage(language: AppLanguage): AccountDeletionPage {
  const profile = t(language, 'tabs.profile');
  const settings = t(language, 'settings.title');
  const dangerZone = sectionName(language, 'settings.section.dangerZone');
  const deleteAccount = t(language, 'account.deleteAccount');
  const deleteRemote = t(language, 'account.deleteRemote');
  const resetAll = t(language, 'settings.resetData');
  const months = ANALYTICS_RETENTION_MONTHS;
  const days = APPLE_DELETION_MARKER_DAYS;
  const { name, email } = LEGAL_ENTITY;

  if (language === 'fi') {
    return {
      title: 'Vinha – tilin ja tietojen poisto',
      summary: `Vinha-sovelluksen julkaisija on ${name}. Näin poistat Vinha-tilisi ja palvelimellamme olevat tietosi.`,
      sections: [
        {
          heading: 'Poista tili tällä sivulla',
          body: [
            'Kirjaudu samalla Google-tilillä, jolla otit varmuuskopion, ja vahvista. Tili poistetaan heti; sovellusta ei tarvita.',
          ],
          webDeletion: true,
        },
        {
          heading: 'Tai poista tili sovelluksessa',
          steps: [
            'Avaa Vinha ja kirjaudu sisään samalla Google- tai Apple-tilillä, jolla otit varmuuskopion.',
            `Avaa ${profile}-välilehti ja paina oikean yläkulman ratasta (${settings}).`,
            `Vieritä kohtaan ${dangerZone} ja paina ${deleteAccount}.`,
            'Vahvista. Poisto tehdään heti.',
          ],
          body: ['Applella kirjautunut tili poistetaan toistaiseksi vain sovelluksessa.'],
        },
        {
          heading: 'Mitä poistetaan',
          bullets: [
            'Pilvivarmuuskopio: profiilisi, treeniloki, ohjelmat ja kehon mittaukset — kaikki, mitä sovellus oli varmuuskopioinut.',
            `AI-valmentajan kopiot kysymyksistäsi, ohjelmistasi ja kuvistasi, jos olit sallinut niiden säilyttämisen. Sovelluksessa ne poistetaan tilin mukana. Ne on tallennettu puhelimen satunnaisen tunnisteen alle eikä tilisi alle, joten tällä sivulla niitä ei löydä; silloin ne poistuvat automaattisesti viimeistään ${months} kuukauden kuluttua.`,
            'Apple-tilillä: palvelimemme antamat kirjautumiset. Muut puhelimesi kirjautuvat ulos seuraavalla yhteydellään.',
          ],
        },
        {
          heading: 'Mitä jää ja kuinka kauan',
          bullets: [
            `Treenitiedot puhelimessasi, kunnes painat ${resetAll} tai poistat sovelluksen.`,
            `Nimettömät käyttötilastot ja virheraportit, enintään ${months} kuukautta. Niitä ei ole sidottu tiliisi, joten niistä ei voi poimia sinun tietojasi.`,
            `Apple-tilillä yksi merkintä päivämäärineen, joka estää vanhan kirjautumisen käytön. Siinä ei ole nimeä, sähköpostia eikä treenitietoja. Palvelimen rutiinisiivous poistaa sen, kun ${days} päivää on kulunut; siivous ajetaan, kun joku kirjautuu Applella, joten siinä voi mennä hieman pidempään.`,
            'Anthropic, joka kirjoittaa valmentajan vastaukset, poistaa oman kopionsa kysymyksistä 30 päivän kuluessa joka tapauksessa.',
          ],
        },
        {
          heading: 'Vain varmuuskopion poisto',
          body: [`${deleteRemote} sovelluksen samassa kohdassa poistaa palvelinkopion mutta pitää sinut kirjautuneena.`],
        },
        {
          heading: 'Kysymykset',
          body: [
            `Kirjoita osoitteeseen ${email}. Palvelimelle ei tallenneta nimeäsi eikä sähköpostiasi, joten emme löydä tietojasi pelkän osoitteen perusteella — tili yksilöidään kirjautumalla, tällä sivulla tai sovelluksessa.`,
          ],
        },
      ],
      web: {
        noScript: 'Poisto tällä sivulla vaatii JavaScriptin. Voit poistaa tilin myös sovelluksessa.',
        confirm: 'Poistetaanko tilin {email} varmuuskopio palvelimeltamme? Tätä ei voi perua.',
        confirmButton: deleteAccount,
        cancelButton: 'Peruuta',
        working: 'Poistetaan…',
        done: 'Tili poistettu. Palvelimellamme ei ole enää varmuuskopiota tilille {email}.',
        signInFailed: 'Kirjautuminen ei onnistunut. Yritä uudelleen.',
        refused: 'Kirjautuminen ei kelvannut. Kirjaudu uudelleen ja yritä uudestaan.',
        rateLimited: 'Liian monta yritystä. Yritä uudelleen kymmenen minuutin päästä.',
        failed: `Poisto ei onnistunut. Tarkista yhteys ja yritä uudelleen; jos se ei onnistu, kirjoita osoitteeseen ${email}.`,
      },
    };
  }

  return {
    title: 'Vinha – delete your account and data',
    summary: `Vinha is published by ${name}. This is how you delete your Vinha account and the data on our server.`,
    sections: [
      {
        heading: 'Delete your account on this page',
        body: [
          'Sign in with the same Google account you backed up with, and confirm. The account is deleted immediately; you do not need the app.',
        ],
        webDeletion: true,
      },
      {
        heading: 'Or delete your account in the app',
        steps: [
          'Open Vinha and sign in with the same Google or Apple account you backed up with.',
          `Open the ${profile} tab and tap the gear in the top right corner (${settings}).`,
          `Scroll to ${dangerZone} and tap ${deleteAccount}.`,
          'Confirm. The deletion happens immediately.',
        ],
        body: ['An account signed in with Apple can for now be deleted only in the app.'],
      },
      {
        heading: 'What is deleted',
        bullets: [
          'The cloud backup: your profile, training log, programmes and body measurements — everything the app had backed up.',
          `The AI coach’s copies of your questions, programmes and photos, if you had allowed us to keep them. In the app they go with the account. They are filed under a random identifier of the phone, not under your account, so this page cannot find them; they are then deleted automatically after ${months} months at the latest.`,
          'For an Apple account: the sign-ins our server issued. Your other phones are signed out the next time they connect.',
        ],
      },
      {
        heading: 'What stays, and for how long',
        bullets: [
          `The training data on your phone, until you tap ${resetAll} or uninstall the app.`,
          `Anonymous usage statistics and error reports, for up to ${months} months. They are not tied to your account, so nothing of yours can be picked out of them.`,
          `For an Apple account, one dated marker that stops an old sign-in from being used. It holds no name, email or training data. The server’s routine clean-up removes it once ${days} days have passed; that clean-up runs when someone signs in with Apple, so it can take a little longer.`,
          'Anthropic, which writes the coach’s answers, deletes its own copy of the questions within 30 days either way.',
        ],
      },
      {
        heading: 'Deleting only the backup',
        body: [`${deleteRemote}, in the same place in the app, removes the server copy and keeps you signed in.`],
      },
      {
        heading: 'Questions',
        body: [
          `Write to ${email}. Our server stores neither your name nor your email, so we cannot find your data from an address alone — an account is identified by signing in, on this page or in the app.`,
        ],
      },
    ],
    web: {
      noScript: 'Deleting on this page needs JavaScript. You can also delete the account in the app.',
      confirm: 'Delete the backup of {email} from our server? This cannot be undone.',
      confirmButton: deleteAccount,
      cancelButton: 'Cancel',
      working: 'Deleting…',
      done: 'Account deleted. Our server no longer holds a backup for {email}.',
      signInFailed: 'Sign-in did not work. Try again.',
      refused: 'The sign-in was not accepted. Sign in again and retry.',
      rateLimited: 'Too many attempts. Try again in ten minutes.',
      failed: `The deletion did not go through. Check your connection and try again; if it still fails, write to ${email}.`,
    },
  };
}
