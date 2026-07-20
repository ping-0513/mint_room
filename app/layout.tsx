import type { Metadata } from "next";
import "./globals.css";
import { SettingsProvider } from "@/lib/settings-context";

export const metadata: Metadata = {
  title: "Mint Room",
  description: "A cute, practical GPT-powered personal assistant.",
};

// Applied before hydration to avoid a light/dark flash on load.
const themeInitScript = `
(function () {
  try {
    var raw = localStorage.getItem('mintroom.settings');
    var theme = raw ? JSON.parse(raw).appearance.theme : 'system';
    var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
