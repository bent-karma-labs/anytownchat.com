import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
export const metadata: Metadata={title:"Anytown Chat — Your town, right now.",description:"The live digital town square for your community."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}<Script src="https://www.bubblav.com/widget.js" data-site-id={process.env.NEXT_PUBLIC_BUBBLAV_WEBSITE_ID} strategy="afterInteractive" /></body></html>}