import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "dev.pli.example.capacitor",
  appName: "Pli Example",
  // `pnpm build` writes the web app here, and `cap sync` copies it into the iOS and Android projects.
  webDir: "dist",
  // The colour behind the web view while it loads, so there is no black flash before the editor appears.
  backgroundColor: "#f7f8fa",
  plugins: {
    // When the keyboard opens, the web view itself gets shorter, so the toolbar at the bottom of the editor rides above it.
    Keyboard: { resize: KeyboardResize.Native },
  },
};

export default config;
