# KikUp Android app: one-time setup

The Android app is built in the cloud by **Codemagic**, the same way as the iPhone app, and you upload it to
**Google Play Console**.

- App name: **KikUp Soccer**
- Package name: **com.kikupsoccer.app** (can't be changed after the first upload)
- Phones only, portrait only. The app bundles all of KikUp, so it works offline.
- Streak reminders and friend streak reminders work, like on iPhone. Google sign-in is hidden in the app.

## 1. Save the upload key (you got two files from Claude)
- `kikup-upload.jks` (the key) and `KEEP-THIS-SAFE.txt` (its passwords).
- Keep both somewhere safe and private. Don't post them anywhere, and don't send them in chat.
- If they're ever lost, Google Play support can reset the upload key, so it's not the end of the world.

## 2. Add the key to Codemagic
1. Codemagic → **Personal Account** settings → **Code signing identities** → **Android keystores**.
2. Upload `kikup-upload.jks` and fill in from `KEEP-THIS-SAFE.txt`:
   - Keystore password, Key alias: `upload`, Key password
   - Reference name: exactly `Android upload key`
3. Save.

## 3. Build
Codemagic → **KikUp-Soccer** → **Start new build** → branch **main** → workflow **KikUp Android app (Google Play)**.
When it's green, download the **.aab** file from the build's **Artifacts**.

## 4. Create the app in Google Play Console
https://play.google.com/console → **Create app**:
- Name `KikUp Soccer`, language English (US), **App**, **Free**, accept the declarations → **Create app**.

## 5. Upload a test release first
**Test and release → Testing → Internal testing → Create new release**:
- Accept **Play App Signing** (Google keeps the real signing key; your upload key just proves it's you).
- Upload the .aab, release name `1.0`, notes like "First version" → **Next** → **Save and publish**.
- **Testers** tab: create an email list with your (and your son's) Google account → copy the **join link**,
  open it on the Android phone, and install KikUp from Google Play.

> **New personal developer accounts:** Google requires a **closed test with at least 12 testers for
> 14 days in a row** before you can publish to everyone. Play Console shows this on the Dashboard if it
> applies to you. Teammates and family with Android phones can be the testers (they join with the link).

## 6. Fill in the store listing and App content (left sidebar)
- **Main store listing:** text and graphics from `appstore/google-play/LISTING.md` and that folder.
- **Privacy policy:** https://rakishah-spec.github.io/KikUp-Soccer/privacy.html
- **App access:** "All or some functionality is restricted" → add the test login (teen account) and say
  it's for the Friends features.
- **Ads:** No ads.
- **Content rating:** start the questionnaire, category **All other app types**, answer **No** to everything
  (no violence, no chat, no sharing location, no purchases, no gambling).
- **Target audience:** pick the ages KikUp is for (including under 13). Google then applies its
  **Families policy**: KikUp has no ads, no location and a privacy policy, which are the main rules.
- **Data safety:** data is collected only for Friends accounts, encrypted in transit, users can delete it:
  - Personal info → **Email address** (account management)
  - Personal info → **User IDs** (account management, app functionality)
  - App activity → **Other user-generated content** (app functionality: nicknames, stars, streaks, friends)
  - None of it is shared with third parties.
  - **Delete account URL:** https://rakishah-spec.github.io/KikUp-Soccer/#friends
    (Friends → Account → Delete account works on the website too.)
- **Health apps, Government, Financial, News:** No / not applicable.

## 7. Publish
**Test and release → Production → Create new release** → add the .aab (from the library) → **Send for review**.
Google usually reviews in a few days.

## Updating the app later
Start a new Codemagic build of the Android workflow, then upload the new .aab as a new release in Play Console.
The version number goes up by itself.
