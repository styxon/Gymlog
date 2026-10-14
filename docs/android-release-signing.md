# Android release signing

Release builds (APK and AAB) are signed with the Play **upload key**, not the
debug key. `plugins/withReleaseSigning.js` writes the signing config into
`android/app/build.gradle` on every `expo prebuild` (also `--clean`), so nothing
lives in `android/` by hand and no secret lives in the repo.

## Where the key lives

- Keystore: `C:\Users\sante\.vinha-keys\vinha-upload.jks`, alias `upload`.
- Backed up in the owner's password manager (file and both passwords). Losing
  it means a Play upload-key reset request.
- `D:\Gymlog\private` is NOT a safe place for it: that folder is not
  git-ignored. `*.jks` and `*.keystore` are git-ignored, but keep the key
  outside the repo anyway.

## Gradle properties

In `~/.gradle/gradle.properties` (Gradle reads it automatically; never commit it):

```
VINHA_UPLOAD_STORE_FILE=C:/Users/<you>/.vinha-keys/vinha-upload.jks
VINHA_UPLOAD_KEY_ALIAS=upload
VINHA_UPLOAD_STORE_PASSWORD=<store password>
VINHA_UPLOAD_KEY_PASSWORD=<key password>
```

With all four set, `npm run android:release` (APK) and `npm run android:bundle`
(AAB; `npm run release:android:bundle` runs the version guard first) sign with
the upload key. With any missing, the release build fails and names the missing
properties. For a deliberately debug-signed local test build, set
`VINHA_ALLOW_DEBUG_SIGNED_RELEASE=true`.

## SHA-1

```
keytool -list -v -keystore C:\Users\sante\.vinha-keys\vinha-upload.jks -alias upload
```

Add BOTH the upload key's SHA-1 and the Play App Signing key's SHA-1 (Play
Console, App integrity) to the Google Cloud Android OAuth client for package
`app.vinha` (see [account-backup.md](account-backup.md)). Without them Google
sign-in fails with `DEVELOPER_ERROR`.

## Installed phones

A phone with a debug-signed install cannot be updated by an upload-key-signed
build: uninstall once first (this removes local data, so export a backup).
