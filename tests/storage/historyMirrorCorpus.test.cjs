const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { accountBackupFingerprint, parseAccountBackupPayload } = require('../../src/lib/accountBackup');
const { decodeHistoryRows, HISTORY_COLLECTIONS } = require('../../src/lib/historyRowCodec');
const { workoutSessionRepository } = require('../../src/storage/repositories');
const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');
const { session, storeTexts, withWorld } = require('../helpers/mirrorWorld.cjs');

/**
 * The mirror against real data: the rows sixteen past releases stored
 * (tests/fixtures/storage-history, loaded through the real loader) and the five
 * cloud backups of old releases (tests/fixtures/backup-history, through the
 * real normalizer). Each becomes a mirror that reads back deep-equal, with the
 * same backup fingerprint and content hash, and that survives a restart and a
 * further commit.
 */
const NO_HISTORY = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };
const STORAGE_DIR = path.join(__dirname, '..', 'fixtures', 'storage-history');
const BACKUP_DIR = path.join(__dirname, '..', 'fixtures', 'backup-history');

function jsonFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

async function loadFromRows(rows) {
  const fake = createFakeAsyncStorage();
  for (const [key, value] of Object.entries(rows)) {
    fake.rows.set(key, value);
  }
  const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'), { locale: 'en_US' });
  return database.loadDatabase();
}

function readBack(file) {
  const texts = storeTexts(file);
  const items = {};
  for (const collection of HISTORY_COLLECTIONS) {
    const decoded = decodeHistoryRows(collection, texts[collection]);
    assert.equal(decoded.dropped, 0, `${collection}: a row did not decode`);
    items[collection] = decoded.items;
  }
  return items;
}

async function checkRelease(label, database) {
  await withWorld({ database }, async (world) => {
    const mirror = world.newMirror();
    const result = await mirror.start();
    assert.equal(result.status, 'rebuilt', `${label}: ${result.reason}`);
    assert.ok(world.matches(), `${label}: the store differs from memory`);

    const items = readBack(world.file);
    for (const collection of HISTORY_COLLECTIONS) {
      assert.deepEqual(items[collection], JSON.parse(JSON.stringify(database[collection])), `${label}: ${collection} is not deep-equal`);
    }
    assert.equal(
      accountBackupFingerprint({ ...database, ...items }, NO_HISTORY),
      accountBackupFingerprint(database, NO_HISTORY),
      `${label}: the backup fingerprint changed`,
    );

    await mirror.close();
    const again = world.newMirror();
    assert.equal((await again.start()).status, 'unchanged', `${label}: a second launch rebuilt`);
    const next = workoutSessionRepository.append(database, session(9001));
    world.state.database = next;
    await again.apply(database, next);
    assert.ok(world.matches(next), `${label}: a commit after the release's data`);
    const removeId = next.workoutSessions[next.workoutSessions.length - 1]?.id;
    if (removeId) {
      const smaller = workoutSessionRepository.remove(next, removeId);
      world.state.database = smaller;
      await again.apply(next, smaller);
      assert.ok(world.matches(smaller), `${label}: a delete after the release's data`);
    }
  });
}

module.exports = [
  {
    name: 'historyMirror corpus: the rows of every past release become a verified, deep-equal mirror',
    async run() {
      const files = jsonFiles(STORAGE_DIR);
      assert.ok(files.length >= 16, 'the corpus has sixteen releases');
      let sessions = 0;
      for (const name of files) {
        const fixture = JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, name), 'utf8'));
        const database = await loadFromRows(fixture.rows);
        sessions += database.workoutSessions.length;
        await checkRelease(`release ${name}`, database);
      }
      assert.ok(sessions > 0, 'the corpus holds sessions to mirror');
    },
  },
  {
    name: 'historyMirror corpus: the cloud backups of old releases become verified mirrors too',
    async run() {
      const { normalizeDatabase } = loadAgainstFake(createFakeAsyncStorage(), (requireDist) => requireDist('storage/database.js'), { locale: 'en_US' });
      const files = jsonFiles(BACKUP_DIR);
      assert.ok(files.length >= 5);
      for (const name of files) {
        const fixture = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8'));
        const payload = parseAccountBackupPayload(JSON.parse(fixture.body));
        assert.ok(payload, `${name}: the payload parses`);
        await checkRelease(`backup ${name}`, normalizeDatabase(payload.database));
      }
    },
  },
];
