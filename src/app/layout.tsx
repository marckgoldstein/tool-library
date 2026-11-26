import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { BrowseLink, MoreMenuLinks, NavLink, SignInLink, YourItemsLink } from "@/components/site-nav";
import { pendingCount } from "@/server/invitations/service";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tool Library", template: "%s · Tool Library" },
  description: "Borrow and lend tools and gear within your group.",
};

// Matches --paper in globals.css, so the browser chrome blends with the page.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#151917" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const pending = isAdmin ? await pendingCount(session!.user.id) : 0;
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link className="brand" href="/">
            Tool Library
          </Link>
          <nav aria-label="Main">
            {session?.user ? (
              <ul className="nav-list">
                <li>
                  <BrowseLink />
                </li>
                <li>
                  <YourItemsLink />
                </li>
                <li>
                  <NavLink href="/threads">Messages</NavLink>
                </li>
                <li>
                  <NavLink href="/profile">Profile</NavLink>
                </li>
                <li>
                  {/* Native popover (D33): light dismiss and Escape come built in. */}
                  <button type="button" className="nav-more-button" popoverTarget="more-menu" aria-label={pending > 0 ? `More, ${pending} suggestions waiting` : undefined}>
                    More{pending > 0 ? <span className="count">{pending}</span> : null}
                  </button>
                  <div id="more-menu" popover="auto" className="nav-more">
                    <MoreMenuLinks>
                      <ul>
                        <li>
                          <NavLink href="/invite">Suggest someone</NavLink>
                        </li>
                        {isAdmin && (
                          <>
                            <li>
                              <NavLink href="/admin/invitations">
                                Member suggestions{pending > 0 ? <span className="count">{pending}</span> : null}
                              </NavLink>
                            </li>
                            <li>
                              <NavLink href="/admin/members">Members</NavLink>
                            </li>
                          </>
                        )}
                        <li>
                          <NavLink href="/notices">Notices</NavLink>
                        </li>
                      </ul>
                      <hr />
                      <form
                        action={async () => {
                          "use server";
                          await signOut({ redirectTo: "/" });
                        }}
                      >
                        <button type="submit" className="link">
                          Sign out
                        </button>
                      </form>
                    </MoreMenuLinks>
                  </div>
                </li>
              </ul>
            ) : (
              <ul className="nav-list">
                <li>
                  <SignInLink />
                </li>
              </ul>
            )}
          </nav>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
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
