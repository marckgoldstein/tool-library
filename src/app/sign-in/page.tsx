import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, signIn } from "@/auth";

export const metadata: Metadata = { title: "Sign in" };

const SignInSchema = z.object({ email: z.email().max(254) });

async function sendLink(formData: FormData) {
  "use server";
  const parsed = SignInSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) redirect("/sign-in?error=email");
  // Handle the redirect ourselves so every address lands on the same page (no member enumeration).
  await signIn("email", { email: parsed.data.email, redirectTo: "/", redirect: false });
  redirect("/sign-in/check-email");
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await auth())?.user) redirect("/");
  const { error } = await searchParams;
  const invalid = error === "email";
  return (
    <>
      <h1>Sign in</h1>
      <p>We&apos;ll email you a link that signs you in. The Tool Library is invite-only, so use the address you were invited with.</p>
      <form className="stack" action={sendLink} noValidate={false}>
        <label htmlFor="email">
          Email address
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            enterKeyHint="send"
            required
            maxLength={254}
            aria-invalid={invalid}
            aria-describedby={invalid ? "email-error" : undefined}
          />
        </label>
        {invalid && (
          <p id="email-error" className="error-text" role="alert">
            Enter a valid email address, like name@example.com.
          </p>
        )}
        <button type="submit">Email me a sign-in link</button>
      </form>
    </>
  );
}
