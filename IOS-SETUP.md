# KikUp iPhone app: one-time setup (no Mac needed)

The iPhone app is built in the cloud by **Codemagic** from this GitHub repository and sent to
**TestFlight** (Apple's beta-testing app), then to the App Store.

- App name: **KikUp Soccer**
- Bundle ID: **com.kikupsoccer.app** (can't be changed after the first upload)
- iPhone only, portrait only. The app bundles all of KikUp, so it works offline.
- Inside the app, Google sign-in is hidden (Google blocks it in apps like this, and Apple would
  then also require Sign in with Apple). Username and parent-email accounts work normally.

## 1. Create an App Store Connect API key (lets Codemagic upload for you)
1. Go to https://appstoreconnect.apple.com → **Users and Access** → **Integrations** → **App Store Connect API**.
2. Under **Team Keys**, click **+** (first time: **Request Access**, then accept).
3. Name: `Codemagic`. Access: **App Manager**. Click **Generate**.
4. **Download the key (.p8 file). Apple only lets you download it once.** Keep it safe; don't share it in chat.
5. Note the **Issuer ID** (top of the page) and the key's **Key ID**.

## 2. Register the app's ID
1. Go to https://developer.apple.com/account/resources/identifiers/list → **+**.
2. Choose **App IDs** → **App** → Continue.
3. Description: `KikUp Soccer`. Bundle ID: **Explicit**, `com.kikupsoccer.app`. No capabilities needed. **Register**.

## 3. Create the app in App Store Connect
1. https://appstoreconnect.apple.com → **Apps** → **+** → **New App**.
2. Platform **iOS**, Name `KikUp Soccer` (if taken: `KikUp Soccer Training`), Language English,
   Bundle ID `com.kikupsoccer.app`, SKU `kikup-soccer`, User Access **Full Access**. **Create**.

## 4. Connect Codemagic
1. Go to https://codemagic.io → **Sign up with GitHub** → allow access to `rakishah-spec/KikUp-Soccer`.
2. **Add application** → GitHub → `KikUp-Soccer` → it finds `codemagic.yaml` automatically.
3. **Team settings** (or your account settings) → **Integrations** → **Developer Portal** → **Connect**:
   - Name: exactly `KikUp App Store key`
   - Issuer ID and Key ID from step 1, and upload the .p8 file.
4. **Code signing identities** → **iOS certificates** → **Generate certificate** (pick the key above).
   This creates an Apple Distribution certificate.
5. **iOS provisioning profiles** → **Fetch profiles**. If none appear, create one at
   https://developer.apple.com/account/resources/profiles/list → **+** → **App Store Connect** →
   App ID `com.kikupsoccer.app` → the certificate Codemagic just made → name `KikUp App Store` → **Generate**,
   then **Fetch profiles** in Codemagic again.

## 5. Build
In Codemagic, open the app → **Start new build** → workflow **KikUp iPhone app (App Store)** → **Start**.
It takes about 15–25 minutes. When it's green, the build appears in App Store Connect → **TestFlight**
a few minutes later.

## 6. Test on an iPhone, then submit
1. Install **TestFlight** from the App Store, and add yourself as an internal tester in App Store Connect → TestFlight.
2. Try a camera drill, Friends sign-in, and the videos.
3. Fill in the App Store listing (description, screenshots, privacy policy URL:
   https://rakishah-spec.github.io/KikUp-Soccer/privacy.html, age rating), pick the build, and **Submit for Review**.

## Updating the app later
Changes to the website go live right away. The iPhone app gets them when you start a new Codemagic build
and submit the new version (Apple reviews each update, usually within a day or two).
