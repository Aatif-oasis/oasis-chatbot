"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { CurrentUser, clearToken, getCurrentUser, getToken } from "@/lib/api-client";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
    } else {
      setMe(getCurrentUser());
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  // Only admins can manage people, so only admins are shown the door.
  // Previously every agent saw this link and got a permissions error the
  // moment they clicked it.
  const canManageUsers = !!me?.roles.includes("org_admin");

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="wordmark">Oasis Chatbot</div>
        <div className="wordmark-sub">Live chat console</div>

        <Link
          href="/dashboard"
          className="nav-link"
          aria-current={pathname === "/dashboard" ? "page" : undefined}
        >
          Conversations
        </Link>

        <Link
          href="/dashboard/tickets"
          className="nav-link"
          aria-current={pathname?.startsWith("/dashboard/tickets") ? "page" : undefined}
        >
          Tickets
        </Link>

        {canManageUsers && (
          <Link
            href="/dashboard/users"
            className="nav-link"
            aria-current={pathname?.startsWith("/dashboard/users") ? "page" : undefined}
          >
            People
          </Link>
        )}

        <div className="sidebar-foot">
          {me && (
            <div className="who">
              <strong>{me.roles.includes("org_admin") ? "Administrator" : "Agent"}</strong>
              signed in
            </div>
          )}
          <button
            className="btn btn-ghost-light"
            onClick={() => {
              clearToken();
              router.push("/login");
            }}
          >
            Log out
          </button>
        </div>
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
