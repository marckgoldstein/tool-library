import type { Metadata } from "next";
import Link from "next/link";
import { devMailboxEnabled } from "@/server/email/dev-mailbox";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ joined?: string }> }) {
  const joined = (await searchParams).joined === "1";
  return (
    <>
      <h1>Check your email</h1>
      {joined ? (
        <p>
          Welcome to the group. We&apos;ve emailed a sign-in link to the address your invite went to. It works once
          and expires in 15 minutes.
        </p>
      ) : (
        <p>
          If that address belongs to a member, a sign-in link is on its way. It works once and expires in 15 minutes.
        </p>
      )}
      <p>Not there after a minute? Check your spam or junk folder, then try again.</p>
      {devMailboxEnabled() && (
        <p className="notice warn">
          Development: emails aren&apos;t sent. Open the <Link href="/dev/mailbox">local mailbox</Link>.
        </p>
      )}
      <p>
        <Link href="/sign-in">Use a different address</Link>
      </p>
    </>
  );
}
