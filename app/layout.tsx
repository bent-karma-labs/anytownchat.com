import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anytown Chat — Your town, right now.",
  description: "The live digital town square for your community.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const bubblavId = process.env.NEXT_PUBLIC_BUBBLAV_WEBSITE_ID;

  return (
    <html lang="en">
      <body>
        {children}
        {bubblavId ? (
          <Script
            src="https://www.bubblav.com/widget.js"
            data-site-id={bubblavId}
            strategy="afterInteractive"
          />
        ) : null}
      </body>
    </html>
  );
}
