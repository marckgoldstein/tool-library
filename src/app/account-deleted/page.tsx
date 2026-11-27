import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Account deleted", robots: { index: false } };

/** Where S21 lands after the account is deleted and the person is signed out. */
export default function AccountDeletedPage() {
  return (
    <>
      <h1>Your account is deleted</h1>
      <p>
        Your name, email, photo, general area and contact details are gone, and your items are delisted. Past loans stay
        in the record without your name.
      </p>
      <p>
        Thanks for lending and borrowing. If you&apos;d like to come back, ask a member to suggest you again.
      </p>
      <p>
        <Link href="/">Back to the Tool Library</Link>
      </p>
    </>
  );
}
