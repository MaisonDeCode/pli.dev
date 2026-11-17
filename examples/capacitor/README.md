# Pli in a Capacitor app: example

The full Pli.Documents editor (the same `PliDocument` as the web playground) running inside an iPhone, iPad and Android app with [Capacitor](https://capacitorjs.com). The web app is ordinary React; Capacitor puts it in a native shell, and the `ios` and `android` folders are the native projects.

## Run it

You need [pnpm](https://pnpm.io), and Xcode for iOS or Android Studio for Android. From the root of this repository:

```sh
pnpm install
cd examples/capacitor
pnpm build          # builds the web app into dist/
pnpm exec cap sync  # copies it into the iOS and Android projects
```

Then open a native project and press Run:

```sh
pnpm exec cap open ios       # Xcode
pnpm exec cap open android   # Android Studio
```

`pnpm ios` and `pnpm android` do the build, the sync and the open in one go. After any change to the web app, run `pnpm sync` again (or use the live-reload steps below).

To work on it in a browser first: `pnpm dev`, then open http://localhost:5190.

### Live reload on a device or simulator

Run `pnpm dev`, then set `server: { url: "http://YOUR-COMPUTER-IP:5190", cleartext: true }` in `capacitor.config.ts` and run `pnpm exec cap sync`. The app then loads from your computer, and edits show as you save. Remove the `server` setting before a real build.

## What it shows

- **The whole editor on a phone.** Menus, toolbar, tables, lists, pageless view, and DOCX and PDF export all work in the web view. `App.tsx` starts in the pageless view on narrow screens.
- **A toolbar above the keyboard.** On a phone `PliDocument` puts its toolbar at the bottom, so it stays in reach while you type. For it to sit right above the keyboard in an app, the web view must shrink when the keyboard opens: `@capacitor/keyboard` does that (`Keyboard: { resize: "native" }` in `capacitor.config.ts`, which is also the default for the plugin), and `index.html` sets `maximum-scale=1` so iOS doesn't zoom into the page when you tap to type. On iPhone, `main.tsx` also hides the bar of arrows and Done that iOS puts above the keyboard for web pages (`Keyboard.setAccessoryBarVisible`). In Safari and Chrome the editor follows the keyboard on its own.
- **Saving.** The document is saved in the web view's storage as you type and opened again on the next launch.
- **Files out.** A web view can't download a file, so `File > Download` calls the `onDownload` function that `App.tsx` passes. It writes the file to the app's cache with `@capacitor/filesystem` and shows the share sheet with `@capacitor/share` (Save to Files, AirDrop, Mail). In a browser, the same menu downloads as usual.
- **Files in.** `File > Import DOCX` opens the system file picker.

## Notes

- The app ids are `dev.pli.example.capacitor`. Change `appId` in `capacitor.config.ts` before you ship your own app; if you change it after adding a platform, remove that folder and add it again (`pnpm exec cap add ios`).
- Android needs the SDK path in `android/local.properties` (`sdk.dir=…`). Android Studio writes it for you.
- This example lives in the Pli repository and uses its packages from the workspace. In your own app, install them from npm: `npm install @pli.dev/docs @pli.dev/react`.
- The editor was built for a mouse and keyboard first. On a phone its toolbar scrolls sideways (undo, bold, italic and the list buttons come first, and the **…** menu with the layout and zoom stays at the right edge). Native editing views for Swift and Kotlin are on the Pli.Documents roadmap.
