const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The iOS privacy manifest names every required-reason API the bundled
 * libraries use.
 *
 * App Store Connect rejects an upload whose binary calls a required-reason API
 * (UserDefaults, file timestamps, boot time, disk space, …) without a declared
 * reason (ITMS-91053). The libraries ship their own `PrivacyInfo.xcprivacy`,
 * but `app.json` → `ios.privacyManifests` is the app's own declaration, so it
 * is kept as the union of theirs. A new native dependency that brings a new
 * category or reason fails here until app.json names it too.
 *
 * Pods downloaded at `pod install` time (RevenueCat's PurchasesHybridCommon)
 * are not in node_modules and carry their own manifest into the build.
 */
const appConfig = require('../../app.json');

const ROOT = path.join(__dirname, '..', '..', 'node_modules');

function findManifests(dir, depth, found) {
  if (depth > 6) {
    return found;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'android' || entry.name === '.bin') continue;
      findManifests(full, depth + 1, found);
    } else if (entry.name === 'PrivacyInfo.xcprivacy') {
      found.push(full);
    }
  }
  return found;
}

/** { category: Set(reasons) } from one plist, read as text. */
function accessedApis(plist) {
  const result = {};
  const blocks = plist.split('<key>NSPrivacyAccessedAPIType</key>').slice(1);
  for (const block of blocks) {
    const category = (block.match(/NSPrivacyAccessedAPICategory[A-Za-z]+/) || [])[0];
    if (!category) continue;
    const reasonsPart = block.split('NSPrivacyAccessedAPITypeReasons')[1] || '';
    const reasons = reasonsPart.split('</array>')[0].match(/[0-9A-F]{4}\.\d/g) || [];
    result[category] = new Set([...(result[category] || []), ...reasons]);
  }
  return result;
}

module.exports = [
  {
    name: 'iosPrivacyManifest: app.json declares no tracking',
    run() {
      const manifest = appConfig.expo.ios.privacyManifests;
      assert.ok(manifest, 'expo.ios.privacyManifests is missing');
      assert.equal(manifest.NSPrivacyTracking, false);
    },
  },
  {
    name: 'iosPrivacyManifest: every library category and reason is declared in app.json',
    run() {
      const declared = {};
      for (const item of appConfig.expo.ios.privacyManifests.NSPrivacyAccessedAPITypes) {
        declared[item.NSPrivacyAccessedAPIType] = new Set(item.NSPrivacyAccessedAPITypeReasons);
      }
      const files = findManifests(ROOT, 0, []);
      if (files.length === 0) {
        // No node_modules (a docs-only checkout): nothing to compare against.
        return;
      }
      const missing = [];
      for (const file of files) {
        const apis = accessedApis(fs.readFileSync(file, 'utf8'));
        for (const [category, reasons] of Object.entries(apis)) {
          for (const reason of reasons) {
            if (!declared[category] || !declared[category].has(reason)) {
              missing.push(`${category} ${reason} (${path.relative(ROOT, file)})`);
            }
          }
        }
      }
      assert.deepEqual(missing, [], `app.json ios.privacyManifests lacks:\n${missing.join('\n')}`);
    },
  },
];
