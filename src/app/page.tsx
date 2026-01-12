import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="min-h-screen p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">AIPhotoQuote</h1>
        <div className="flex items-center gap-3">
          <SignedOut>
            <Link className="underline" href="/sign-in">Sign in</Link>
            <Link className="underline" href="/sign-up">Sign up</Link>
          </SignedOut>
          <SignedIn>
            <Link className="underline" href="/dashboard">Dashboard</Link>
            <Link className="underline" href="/onboarding">Onboarding</Link>
            <UserButton />
          </SignedIn>
        </div>
      </div>
      <p className="mt-10 max-w-2xl text-lg">
        Embed an AI-powered photo quoting flow on your website.
      </p>
    </main>
  );
}
