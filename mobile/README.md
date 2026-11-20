# Finance Guru: Android app (reads real bank SMS)

The Android app is a Capacitor shell around the same Finance Guru web app, plus a native plugin
(`android/app/src/main/java/com/financeguru/app/SmsReaderPlugin.java`) that reads bank and UPI SMS.

## What it does
- **Import from SMS:** asks for SMS permission, reads this month's inbox and shows every bank or UPI message. You tap Scan, then Add. Income and spends are logged automatically.
- **Live:** when a new bank SMS arrives while the app is open, it's added within about a second ("+₹2,200 income added from SMS").
- **Catch-up:** SMS that arrived while the app was closed are imported when you open it.
- **Privacy:** the phone itself filters messages. Only SMS with account or UPI words, credited or debited, and an amount are sent to the server. Personal chats and OTPs never leave the phone. The server stores only a hash of each SMS, to prevent double-counting.

## Build and run (Android Studio)
```bash
cd mobile
npm install
npx cap sync android
npx cap open android      # then press Run ▶ in Android Studio
```
Or from the command line: `cd mobile/android && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`

## Which server the app talks to
Set this in `capacitor.config.json` → `server.url`, then run `npx cap sync android` and rebuild:

| Where | `server.url` |
|---|---|
| Android emulator + local server (`npm start` in the project root) | `http://10.0.2.2:3000` (current) |
| Real phone on the same Wi-Fi as your laptop | `http://<your-laptop-IP>:3000` |
| Real phone, live site | `https://finance-guru-me2j.onrender.com` (after deploying the new backend) |

## Testing with fake SMS on the emulator
```bash
adb emu sms send 5676766 "Rs.1,450.00 credited to A/c XX2153 on 21-11-26 by SWIGGY (UPI Ref No 455500011122) -HDFC Bank"
```

## Play Store note
Google Play only allows the READ_SMS permission for approved use cases. For the hackathon, install the APK directly (sideload). For production, use the share-to-app or notification-listener approach, or the RBI's Account Aggregator framework.
