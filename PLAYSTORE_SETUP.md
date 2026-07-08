# PlayStore App Setup Guide — Tourly

This guide walks you through publishing Tourly to Google Play Console. Your developer registration is already accepted, so you're ready to begin.

## Phase 1: Create the App Listing in Google Play Console

### 1.1 Create a New App

1. Go to [Google Play Console](https://play.google.com/console)
2. Click **+ Create app**
3. Fill in:
   - **App name**: `Tourly`
   - **Default language**: English – United States
   - **App or game**: App
   - **Free or paid**: Free
   - **Declaration**: Check "Declarations" → agree to required terms
4. Click **Create app**

### 1.2 Set Up App Details

Navigate to **All apps → Tourly → App details**:

- **App name**: Tourly
- **Short description** (80 chars max):
  > Tournament management for professional tennis players.

- **Full description** (4000 chars max):
  ```
  Tourly is the essential tournament management app for professional tennis 
  players on the ITF World Tennis Tour circuit.
  
  Keep your tournament schedule organized, never miss a deadline, and track 
  your travel and expense budgets all in one place.
  
  Features:
  • Manage your tournament schedule with automatic deadline tracking
  • View upcoming tournaments on an interactive map
  • Track singles and doubles entry fees and deadlines
  • Monitor travel expenses and tournament budgets
  • Receive timely push notifications before key deadlines
  • Offline access to all tournament information
  • Sync seamlessly across your devices
  
  Designed specifically for the professional tennis circuit, Tourly 
  simplifies tournament management so you can focus on your game.
  ```

- **Developer contact info**:
  - Email: allanjarry@gmail.com
  - Phone: (optional but recommended)
  - Website: (optional)

- **Privacy policy**: Add your privacy policy URL (you'll need one before publishing)

### 1.3 Add App Screenshots

**Screenshots go to: App details → Main store listing → Screenshots**

You need:
- **Phone screenshots** (portrait, 1080×1920 px, min 2, max 8)
- **Tablet screenshots** (optional, landscape)

For now, placeholder screenshots are fine. You can update them before submission.

### 1.4 Add App Icon & Preview Graphics

- **App icon**: 512×512 PNG (go to **All apps → Tourly → All apps → App details → App icon**)
  - Use the same icon from `assets/images/icon.png`

- **Featured graphic** (1024×500 PNG): Promotional banner
- **Cover image** (1024×500 PNG): Store listing header

## Phase 2: Set Up Google Play App Signing

Google Play now requires App Signing. Expo/EAS handles this automatically through **Play App Signing**.

### 2.1 Enable Play App Signing

1. Navigate to **Tourly → Setup → App integrity**
2. Under **App signing**, you should see **Google Play App Signing** enabled by default
   - Google manages your upload and app signing keys
   - Your signing certificate is stored securely

**You do NOT need to manually generate a keystore** — EAS and Google Play handle this together.

## Phase 3: Build and Upload the First AAB

### 3.1 Create a Signed Android App Bundle (AAB)

Run this command to trigger an EAS production build:

```bash
eas build --platform android --profile production
```

This will:
- Build your Android app as an `.aab` (Android App Bundle)
- EAS automatically signs it using Google Play App Signing credentials
- Upload the build to your EAS account

**Wait for the build to complete.** You'll receive an email with a link to your build.

### 3.2 Submit to Google Play Console

Option A: **Use EAS Submit** (Recommended)

First, create Google Play service account credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a **Service Account**:
   - Project: Create or select a new GCP project
   - Service account name: `tourly-play-deploy`
   - Grant role: **Editor** (or more restrictive: **Play Developer API Access**)
   - Create a **JSON key** and save it

3. In Google Play Console:
   - Go to **Setup → API access**
   - Click **Link Google Cloud project**
   - Grant the service account `Releases Editor` or `Admin` access

4. Save the JSON key as `credentials.json` in your project root (add to `.gitignore`!)

5. Submit the build:
   ```bash
   eas submit --platform android --profile production --use-submission-service
   ```

Option B: **Manual Upload**

1. Download the `.aab` from your EAS dashboard
2. Go to Google Play Console → **Tourly → Release → Production**
3. Click **Create new release**
4. Upload the `.aab` file
5. Review and publish

## Phase 4: Complete Store Listing & Content Ratings

### 4.1 Target Audience

**Tourly → Setup → Target audience**

- Age group: Everyone / Mature audiences (your choice)
- Content rating: None (or add questionnaire)

### 4.2 Content Rating Questionnaire

Complete the **Content rating** questionnaire:
- Go to **Setup → Content rating**
- Fill out the IAMAI/PEGI questionnaire (takes ~5 min)

### 4.3 Pricing & Distribution

**Tourly → Setup → Pricing → Production**

- Status: **Available on Google Play**
- Countries: Select all or your target countries

### 4.4 Privacy, Permissions & Ads

**Tourly → Setup → App security**

- **Permissions**: Review and confirm Android permissions
- **Ads**: Declare if you use ads (you don't, so select "No")
- **Privacy**: Link your privacy policy

## Phase 5: Submit for Review

### 5.1 Pre-Flight Checklist

Before submitting, verify:

- [ ] App name, description, icon, and screenshots complete
- [ ] Privacy policy linked
- [ ] Content rating completed
- [ ] All required permissions declared
- [ ] No placeholder graphics
- [ ] AAB uploaded and no errors shown
- [ ] Version code incremented (should auto-increment in `eas.json`)

### 5.2 Submit for Review

1. Go to **Tourly → Release → Production**
2. Review the release details
3. Click **Review release**
4. Check for any errors or warnings
5. Click **Start rollout to Production** (or **Begin staged rollout** to test with a small % first)

**Review typically takes 1–3 hours, but can take up to 24 hours.**

## Phase 6: Post-Publication

### 6.1 Monitor Your App

- Go to **Tourly → Release → Production** to see release status
- Use **Analytics** dashboard to monitor installs and crashes
- Monitor **Vitals** for app stability metrics

### 6.2 Update Procedure for Future Versions

For subsequent releases:

1. Increment version in `app.json`:
   ```json
   "version": "1.0.1",  // X.Y.Z semver
   "android": {
     "versionCode": 2     // Must increase for each release
   }
   ```

2. Build and submit:
   ```bash
   eas build --platform android --profile production
   eas submit --platform android --profile production --use-submission-service
   ```

3. Or use one command:
   ```bash
   eas build --platform android --profile production --auto-submit
   ```

## Troubleshooting

### Build fails with "No valid signing certificate"

→ This happens if your upload key hasn't been linked. Make sure Google Play App Signing is enabled and your EAS account is connected.

### "Service account cannot access this app"

→ Verify the service account has **Releases Editor** (or higher) role in Google Play Console.

### Build shows as "Not signed" in Google Play Console

→ This is normal with Play App Signing. Google will sign it before release.

### How long before my app appears in search?

→ **3–6 hours** after your first submission. Manual search results take longer; indexed search takes 24–48 hrs.

## Resources

- [Expo EAS Submit docs](https://docs.expo.dev/versions/v54.0.0/build/submit/)
- [Google Play Console Setup](https://play.google.com/console/about/gettingstarted/)
- [Google Play Policies](https://play.google.com/about/play-policies/policy-center/)
- [Android App Bundle Format](https://developer.android.com/guide/app-bundle)

---

**Next Steps:**
1. Create app listing in Play Console
2. Complete store metadata and screenshots
3. Obtain Google Play service account credentials
4. Run `eas build --platform android --profile production`
5. Submit using `eas submit` or manually upload
6. Submit for review
