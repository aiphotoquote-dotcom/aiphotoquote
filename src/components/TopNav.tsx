import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function TopNav() {
  return (
    <header className="border-b">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg">
          AIPhotoQuote
        </Link>

        <div className="flex items-center gap-4 text-sm">
          <SignedOut>
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
            <Link className="underline" href="/sign-up">
              Sign up
            </Link>
          </SignedOut>

          <SignedIn>
            <nav className="flex items-center gap-4">
              <Link className="underline" href="/dashboard">
                Dashboard
              </Link>
              <Link className="underline" href="/onboarding">
                Onboarding
              </Link>
              <Link className="underline" href="/admin">
                Admin
              </Link>
            </nav>
            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
