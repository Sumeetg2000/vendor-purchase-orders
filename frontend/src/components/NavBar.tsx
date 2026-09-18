/* eslint-disable react-refresh/only-export-components -- shared nav config, not a component */
import type { AuthUser, Role } from "../types";

export interface PageDef {
  key: string;
  label: string;
  role: Role;
}

export const PAGES: PageDef[] = [
  { key: "vendors", label: "Vendors", role: "BUYER" },
  { key: "raise-po", label: "Raise PO", role: "BUYER" },
  { key: "approvals", label: "Approvals", role: "APPROVER" },
  { key: "outstanding", label: "Outstanding Orders", role: "PROCUREMENT_ADMIN" },
];

export function pagesForRoles(roles: Role[]): PageDef[] {
  return PAGES.filter((page) => roles.includes(page.role));
}

interface NavBarProps {
  pages: PageDef[];
  activePage: string | null;
  onNavigate: (key: string) => void;
  user: AuthUser;
  onLogout: () => void;
}

export default function NavBar({ pages, activePage, onNavigate, user, onLogout }: NavBarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">Vendor &amp; PO Management</div>
      <nav className="sidebar-nav">
        {pages.map((page) => (
          <button
            key={page.key}
            className={`sidebar-link${activePage === page.key ? " active" : ""}`}
            onClick={() => onNavigate(page.key)}
          >
            {page.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-user">
        <span className="email">{user.email}</span>
        <span className="roles">{user.roles.join(", ")}</span>
        <button type="button" className="btn" onClick={onLogout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
