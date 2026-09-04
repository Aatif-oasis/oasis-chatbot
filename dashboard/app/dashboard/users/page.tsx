"use client";

import { useEffect, useState } from "react";
import {
  CurrentUser,
  UserSummary,
  getCurrentUser,
  inviteUser,
  listUsers,
  reactivateUser,
  resetUserPassword,
  suspendUser,
} from "@/lib/api-client";

const ROLE_LABELS: Record<string, string> = {
  org_admin: "Administrator",
  team_manager: "Team manager",
  agent: "Agent",
};

const STATUS_NOTE: Record<string, string> = {
  active: "Can sign in",
  invited: "Has a password from an admin",
  suspended: "Cannot sign in",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("agent");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Which row's reset form is open, and what's typed in it.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function refresh() {
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the people list");
    }
  }

  useEffect(() => {
    setMe(getCurrentUser());
    refresh();
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await inviteUser(email, fullName, password, role);
      setNotice(`${fullName} can now sign in with the password you set.`);
      setEmail("");
      setFullName("");
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this person");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(e: React.FormEvent, user: UserSummary) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("A password needs at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      await resetUserPassword(user.id, newPassword);
      // Shown once, here, because nobody can look it up later — not even
      // an admin. The old password was never stored, only its hash.
      setNotice(
        `Password changed for ${user.full_name}. Tell them: ${newPassword} — and ask them to change it after signing in.`
      );
      setResetFor(null);
      setNewPassword("");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset that password");
    } finally {
      setSaving(false);
    }
  }

  async function handleSuspend(user: UserSummary) {
    if (!confirm(`Stop ${user.full_name} from signing in? Their chats and tickets stay.`)) return;
    setSaving(true);
    try {
      await suspendUser(user.id);
      setNotice(`${user.full_name} can no longer sign in.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not suspend this person");
    } finally {
      setSaving(false);
    }
  }

  async function handleReactivate(user: UserSummary) {
    setSaving(true);
    try {
      await reactivateUser(user.id);
      setNotice(`${user.full_name} can sign in again.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reactivate this person");
    } finally {
      setSaving(false);
    }
  }

  const isAdmin = !!me?.roles.includes("org_admin");

  return (
    <div className="page">
      <div className="page-head">
        <h2>People</h2>
        <span className="count">{users.length} in this workspace</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      {isAdmin && (
        <div className="panel" style={{ padding: 20, marginBottom: 22 }}>
          <form
            onSubmit={handleInvite}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "0 16px",
              alignItems: "end",
            }}
          >
            <label className="field">
              Full name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>

            <label className="field">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </label>

            <label className="field">
              Starting password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>

            <label className="field">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="agent">Agent</option>
                <option value="team_manager">Team manager</option>
                <option value="org_admin">Administrator</option>
              </select>
            </label>

            <div className="field" style={{ marginBottom: 14 }}>
              <button type="submit" className="btn" disabled={saving} style={{ width: "100%" }}>
                {saving ? "Adding" : "Add person"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>{u.roles.map((r) => ROLE_LABELS[r] || r).join(", ") || "No role"}</td>
                <td>
                  <span className={u.status === "suspended" ? "pill pill-urgent" : "pill"}>
                    {u.status}
                  </span>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                    {STATUS_NOTE[u.status] || ""}
                  </div>
                </td>
                {isAdmin && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {resetFor === u.id ? (
                      <form onSubmit={(e) => handleReset(e, u)} style={{ display: "flex", gap: 6 }}>
                        <input
                          type="text"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="New password"
                          autoFocus
                          style={{
                            padding: "7px 10px",
                            border: "1px solid var(--line)",
                            borderRadius: 6,
                            font: "inherit",
                            fontSize: 14,
                          }}
                        />
                        <button type="submit" className="btn" disabled={saving}>
                          Set
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() => {
                            setResetFor(null);
                            setNewPassword("");
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {/* An admin can't lock themselves out of their own workspace. */}
                        {u.id !== me?.id && (
                          <>
                            <button
                              className="btn btn-quiet"
                              onClick={() => setResetFor(u.id)}
                              disabled={saving}
                            >
                              Reset password
                            </button>
                            {u.status === "suspended" ? (
                              <button
                                className="btn btn-quiet"
                                onClick={() => handleReactivate(u)}
                                disabled={saving}
                              >
                                Let back in
                              </button>
                            ) : (
                              <button
                                className="btn btn-quiet"
                                onClick={() => handleSuspend(u)}
                                disabled={saving}
                              >
                                Suspend
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && !error && (
          <p className="empty">
            <strong>Nobody here yet</strong>
            Add your first agent using the form above.
          </p>
        )}
      </div>
    </div>
  );
}
