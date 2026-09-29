import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Anytown Chat — Your town, right now.",description:"The live digital town square for your community."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}