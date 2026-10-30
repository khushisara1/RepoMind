import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "RepoMind — Understand any codebase",
  description: "Explore public GitHub repositories with clear source links, architecture maps, and grounded setup steps.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
