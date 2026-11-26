"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Exact match for "/items", prefix match for deeper sections, so /items/mine doesn't also light up Browse. */
function isCurrent(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A nav link that marks the page you're on (aria-current, plus a visible style). */
export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = isCurrent(pathname, href, exact);
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}

/**
 * Browse is current on /items and on item pages, but not on Your items (/items/mine)
 * or the list-an-item form, which belong to "Your items".
 */
export function BrowseLink() {
  const pathname = usePathname();
  const current =
    pathname === "/items" || (pathname.startsWith("/items/") && !pathname.startsWith("/items/mine") && !pathname.startsWith("/items/new"));
  return (
    <Link href="/items" aria-current={current ? "page" : undefined}>
      Browse
    </Link>
  );
}

export function YourItemsLink() {
  const pathname = usePathname();
  const current = pathname.startsWith("/items/mine") || pathname.startsWith("/items/new");
  return (
    <Link href="/items/mine" aria-current={current ? "page" : undefined}>
      Your items
    </Link>
  );
}

/** Signed-out header link. Hidden on invite links, where signing in is the wrong path (you join first). */
export function SignInLink() {
  const pathname = usePathname();
  if (pathname.startsWith("/join/")) return null;
  return <NavLink href="/sign-in">Sign in</NavLink>;
}

/** Closes the More menu when a link in it is followed (client navigation keeps the popover open otherwise). */
export function MoreMenuLinks({ children }: { children: React.ReactNode }) {
  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) (e.currentTarget.closest("[popover]") as HTMLElement | null)?.hidePopover();
      }}
    >
      {children}
    </div>
  );
}
