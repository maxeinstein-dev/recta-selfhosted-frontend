# Recta Android app (notification capture)

Capacitor shell around the web app, plus a local Kotlin plugin (`CaptureReader`) that reads the notifications of the
bank apps on the allow list and sends their raw text to the API (`POST /captures`). Only for personal use: debug APK,
installed by USB. There is no release signing and no Play Store build here.

## What is where

- `app/src/main/java/dev/maxsueleinstein/recta/capture/` the plugin: `AllowedPackages.kt` (the allow list, one constant),
  `CaptureListenerService.kt` (reads notifications), `CaptureDatabase.kt` (Room queue), `CaptureUploader.kt` and
  `UploadWorker.kt` (WorkManager upload with exponential backoff), `CaptureConfig.kt` (device token in
  `EncryptedSharedPreferences`), `CaptureReaderPlugin.kt` (bridge to the web layer).
- `app/src/test/` JVM unit tests (no device needed) for the allow list, the batch body and the retry decision.
- The diagnostics screen is in the web app: Settings > "Leitor de notificações" (it only shows inside the app).

## Requirements

- Android Studio (current stable). It bundles JDK 21, which Capacitor 8 needs (`android/app/capacitor.build.gradle`
  compiles at Java 21); the JDK 17 alone is not enough for Gradle on this project.
- Android SDK Platform 36 and Build-Tools (Studio offers to install them on the first sync).
- Node 22 or newer, and `npm install` done in the frontend folder.
- A phone with USB debugging on (Settings > About phone > Software information > tap "Build number" 7 times, then
  Settings > Developer options > USB debugging).

## Build and install

From the frontend folder (`recta-selfhosted-frontend`):

    npm run android:sync          # builds the web app with the API address baked in and copies it into android/
    npm run android:open          # opens the project in Android Studio (or open the android/ folder yourself)

`android:sync` uses `https://recta-api.maxsueleinstein.dev` unless `VITE_API_BASE_URL` is set (it must be https).

In Android Studio, run the `app` configuration on the connected phone. Or from a terminal, with Studio's JDK 21 as
`JAVA_HOME` and the SDK path in `android/local.properties` (`sdk.dir=...`, a file that is not committed):

    cd android
    ./gradlew assembleDebug       # Windows: gradlew.bat assembleDebug
    adb install -r app/build/outputs/apk/debug/app-debug.apk

Unit tests: `./gradlew testDebugUnitTest` (in `android/`).

Every time the web code changes, run `npm run android:sync` again before building.

## First run on the phone

1. Open Recta and sign in.
2. Settings > "Leitor de notificações" > **Vincular este aparelho**. This calls `POST /devices` with your session and
   hands the new device token to the app; it is stored encrypted on the phone and never shown.
3. **Acesso às notificações**: tap "Abrir acesso às notificações" and turn Recta on.
   - An APK installed from outside the store is "restricted": the switch can be greyed out or the system says the setting
     is restricted. Open App info (the screen has a button for it), tap the three dots at the top right, choose
     **Allow restricted settings**, confirm, then go back and turn the switch on. (One UI may ask for the screen lock.)
4. **Bateria**: tap "Abrir otimização de bateria", choose "All apps", find Recta and select "Don't optimize". On One UI also
   remove Recta from Settings > Battery > Background usage limits > "Sleeping apps" / "Deep sleeping apps".
5. Back on the screen, everything should read "Tudo certo". "Enviar agora" schedules an upload immediately.

## Before the first collection week

The package ids of the allow list are written from memory in `AllowedPackages.kt`: `com.nu.production` (Nubank) and
`com.mercadopago.wallet` (Mercado Pago). Check them on the phone (`adb shell pm list packages | findstr /i "nu mercado"`)
and fix the constant if they differ. A notification from any other package is dropped on the phone and never stored.
