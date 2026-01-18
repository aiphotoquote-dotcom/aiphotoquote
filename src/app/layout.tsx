import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "AIPhotoQuote",
  description: "AI-powered photo quoting for service businesses",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className="min-h-screen bg-white text-gray-900 antialiased dark:bg-black dark:text-gray-100">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
