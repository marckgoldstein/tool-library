import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { pendingCount } from "@/server/invitations/service";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tool Library", template: "%s · Tool Library" },
  description: "Borrow and lend tools and gear within your group.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#151917" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const pending = session?.user?.role === "admin" ? await pendingCount(session.user.id) : 0;
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            Tool Library
          </Link>
          <nav aria-label="Main">
            {session?.user ? (
              <>
                <Link href="/items">Browse</Link>
                <Link href="/items/mine">Your items</Link>
                <Link href="/invite">Suggest someone</Link>
                {session.user.role === "admin" && (
                  <>
                    <Link href="/admin/invitations">
                      Member suggestions{pending > 0 ? <span className="count"> {pending}</span> : null}
                    </Link>
                    <Link href="/admin/members">Members</Link>
                  </>
                )}
                <Link href="/profile">Your profile</Link>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/" });
                  }}
                >
                  <button type="submit" className="secondary">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/sign-in">Sign in</Link>
            )}
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>
            Members lend and borrow at their own risk. <Link href="/notices">Notices and how we use your data</Link>
          </p>
          <p>Built with help from AI tools, including Anthropic&apos;s Claude.</p>
        </footer>
      </body>
    </html>
  );
}
