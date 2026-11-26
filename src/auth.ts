/**
 * Sign-in (T4, D27): email magic link via Auth.js, no passwords.
 *
 * - Invite-only (D7): a link is only sent to an existing, active member.
 *   Unknown addresses see the same "check your email" page, so the form
 *   can't be used to discover who is a member.
 * - Links expire after 15 minutes; Auth.js stores tokens hashed.
 * - Rate limit: at most 5 links per address per 15 minutes (from email_log).
 * - In development the link goes to the local mailbox (/dev/mailbox).
 */
import NextAuth, { type DefaultSession } from "next-auth";
import type { EmailConfig } from "next-auth/providers/email";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, count, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { accounts, emailLog, sessions, users, verificationTokens } from "@/db/schema";
import { sendEmail } from "@/server/email/transport";
import { normalizeEmail } from "@/server/email/normalize";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: "member" | "admin" } & DefaultSession["user"];
  }
}

const LINK_MAX_AGE_SECONDS = 15 * 60;
/** T4: 5 links per address per window. Only the browser tests raise it (.env.test), as they sign the same people in many times. */
const LINKS_PER_WINDOW = Number(process.env.AUTH_LINKS_PER_WINDOW) || 5;

export { normalizeEmail };

async function activeUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  return user && user.status === "active" ? user : null;
}

const magicLink: EmailConfig = {
  id: "email",
  type: "email",
  name: "Email",
  maxAge: LINK_MAX_AGE_SECONDS,
  normalizeIdentifier: normalizeEmail,
  async sendVerificationRequest({ identifier, url }) {
    const since = new Date(Date.now() - LINK_MAX_AGE_SECONDS * 1000);
    const [recent] = await db
      .select({ n: count() })
      .from(emailLog)
      .where(and(eq(emailLog.toEmail, identifier), eq(emailLog.template, "auth.magic_link"), gt(emailLog.createdAt, since)));
    if ((recent?.n ?? 0) >= LINKS_PER_WINDOW) return; // silently drop; the page still says "check your email"
    const user = await activeUserByEmail(identifier);
    await sendEmail({
      to: identifier,
      toUserId: user?.id ?? null,
      template: "auth.magic_link",
      subject: "Your sign-in link for the Tool Library",
      text: [
        "Use this link to sign in. It works once and expires in 15 minutes:",
        url,
        "If you didn't ask for this, you can ignore this email.",
      ].join("\n\n"),
    });
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  providers: [magicLink],
  trustHost: true,
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
    error: "/sign-in/error",
  },
  callbacks: {
    async signIn({ user, email }) {
      const address = user.email ?? "";
      const member = await activeUserByEmail(address);
      if (email?.verificationRequest) {
        // Not a member: skip sending, but show the same page as a member would see.
        return member ? true : "/sign-in/check-email";
      }
      return !!member;
    },
    async session({ session, user }) {
      const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, user.id));
      session.user.id = user.id;
      session.user.role = row?.role ?? "member";
      return session;
    },
  },
});

/** Server-side guard for pages and actions. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user;
}
