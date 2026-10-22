import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cedar Clinic | Book an appointment",
  description: "Find a time for thoughtful care. Book, look up, and manage your Cedar Clinic appointments.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
