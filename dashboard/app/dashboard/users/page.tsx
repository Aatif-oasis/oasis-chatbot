"use client";

import { useEffect, useState } from "react";
import { UserSummary, inviteUser, listUsers } from "@/lib/api-client";

const ROLE_LABELS: Record<string, string> = {
  org_admin: "Administrator",
  team_manager: "Team manager",
  agent: "Agent",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("agent");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the people list");
    }
  }

  useEffect(() => {
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

  return (
    <div className="page">
      <div className="page-head">
        <h2>People</h2>
        <span className="count">{users.length} in this workspace</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

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

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>{u.roles.map((r) => ROLE_LABELS[r] || r).join(", ") || "No role"}</td>
                <td>{u.status}</td>
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
