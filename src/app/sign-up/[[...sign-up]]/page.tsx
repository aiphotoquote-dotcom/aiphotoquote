import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-14">
      <SignUp
        afterSignInUrl="/dashboard"
        afterSignUpUrl="/dashboard"
      />
    </main>
  );
}
