import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { COOKIE, decodeSession } from "@/lib/session";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/Navbar";

const plex = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Shop Cart",
  description: "ระบบตะกร้าสินค้า ตัดสต็อกแบบ FEFO",
};

// sets .rv-on before first paint so cards do not flash (only when IntersectionObserver exists and motion is allowed)
const rvScript = `try{if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('rv-on')}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = decodeSession((await cookies()).get(COOKIE)?.value);
  return (
    <html lang="th" className={plex.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: rvScript }} />
      </head>
      <body className="bg-stone-50 text-stone-900 antialiased min-h-screen">
        <Providers initialUser={session ? { email: session.email, role: session.role } : null}>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
