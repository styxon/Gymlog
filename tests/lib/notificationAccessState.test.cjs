const assert = require('node:assert/strict');

const { resolveNotificationAccessState } = require('../../src/lib/notificationAccessState');

/**
 * The permission and a channel's own importance are two separate switches
 * (#bugs, 2026-09-26): a reader can grant Vinha permission and still mute one
 * channel in Android's own settings. Code that read only the permission
 * called that "allowed"; this is the one place that tells the three states
 * apart.
 */
module.exports = [
  {
    name: 'a refused permission reads as denied, whatever the channel says',
    run() {
      assert.equal(
        resolveNotificationAccessState({ permissionGranted: false, channelMuted: true }),
        'denied',
      );
      assert.equal(
        resolveNotificationAccessState({ permissionGranted: false, channelMuted: false }),
        'denied',
      );
    },
  },
  {
    name: 'permission granted and the channel muted reads as channelMuted, not granted',
    run() {
      assert.equal(
        resolveNotificationAccessState({ permissionGranted: true, channelMuted: true }),
        'channelMuted',
      );
    },
  },
  {
    name: 'permission granted and the channel untouched reads as granted',
    run() {
      assert.equal(
        resolveNotificationAccessState({ permissionGranted: true, channelMuted: false }),
        'granted',
      );
    },
  },
];
