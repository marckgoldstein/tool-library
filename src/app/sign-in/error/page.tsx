import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign-in problem" };

export default async function SignInErrorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const expired = error === "Verification";
  return (
    <>
      <h1>{expired ? "That link has expired or was already used" : "We couldn't sign you in"}</h1>
      <p>
        {expired
          ? "Sign-in links work once and expire after 15 minutes. Request a new one."
          : "Only invited members can sign in. If you think this is a mistake, ask the person who invited you."}
      </p>
      <p>
        <Link className="button" href="/sign-in">
          Get a new link
        </Link>
      </p>
    </>
  );
}
