# Turning on KikUp Friends (one-time, about 10 minutes)

**Status: done.** KikUp is connected to the Firebase project `kikup-soccer-3bf9c`
(Email/Password and Google sign-in on, Firestore in the US, rules published).
These steps are kept for reference, e.g. to set up a second project.

Friends (accounts, friend streaks, the friends leaderboard and challenges) need a free
Firebase project. Firebase is Google's service for sign-ins and data. KikUp's free usage
easily fits in Firebase's free plan.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with a Google account.
2. Click **Create a project**, name it `kikup-soccer`, and finish (Google Analytics: off is fine).

## 2. Turn on sign-in
1. In the left menu: **Build → Authentication → Get started**.
2. Under **Sign-in method**, click **Email/Password**, switch on the first toggle, and **Save**.
3. Optional: also add **Google** (pick a support email and **Save**). Parents and teens 13+ can then use "Continue with Google".

## 3. Create the database
1. **Build → Firestore Database → Create database**.
2. Pick a location near you, choose **Start in production mode**, and create it.
3. Open the **Rules** tab, delete what's there, paste in everything from `firestore.rules`
   (in this project), and click **Publish**.

## 4. Connect the website
1. Click the gear icon → **Project settings**. Under **Your apps**, click the **</>** (Web) icon.
2. Name it `KikUp website` and register it (no hosting needed).
3. Copy the `firebaseConfig` values it shows (apiKey, authDomain, projectId, appId).
4. Either paste them into `js/firebase-config.js`, or send them to Claude and it will do it.
   These values are safe to be public: who can see what is enforced by the rules from step 3.

## 5. Allow your website's address
**Authentication → Settings → Authorized domains → Add domain**: `rakishah-spec.github.io`
(and your own domain, if you add one later).

That's it. Open KikUp → menu → **Friends** → **Create account**.

## How it keeps kids safe
- Players 13+ make their own username and password. Players under 13 are added by a parent,
  who gives consent, and get a generated nickname (no real names).
- Friends add each other only with a friend code shared in person. There's no searching for players.
- There's no chat. Challenges use four preset messages.
- Friends only see each other's name, stars, streaks and this week's stars.
- A parent can delete the account, and all of its players, friends and challenges, at any time
  (Friends → Account → Delete account).
