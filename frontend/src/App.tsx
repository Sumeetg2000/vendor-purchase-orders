import { useMemo, useState, type ComponentType } from "react";
import "./styles/global.css";
import LoginForm from "./components/LoginForm";
import NavBar, { pagesForRoles } from "./components/NavBar";
import VendorsPage from "./pages/VendorsPage";
import RaisePoPage from "./pages/RaisePoPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import OutstandingOrdersPage from "./pages/OutstandingOrdersPage";
import { setToken } from "./services/api";
import type { AuthUser } from "./types";

const PAGE_COMPONENTS: Record<string, ComponentType> = {
  vendors: VendorsPage,
  "raise-po": RaisePoPage,
  approvals: ApprovalsPage,
  outstanding: OutstandingOrdersPage,
};

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activePage, setActivePage] = useState<string | null>(null);

  const availablePages = useMemo(() => (user ? pagesForRoles(user.roles) : []), [user]);

  function handleLogin(nextUser: AuthUser) {
    setUser(nextUser);
    setActivePage(pagesForRoles(nextUser.roles)[0]?.key ?? null);
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
    setActivePage(null);
  }

  if (!user) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1>Vendor &amp; Purchase Order Management</h1>
          <LoginForm onLogin={handleLogin} />
        </div>
      </div>
    );
  }

  const ActivePageComponent = activePage ? PAGE_COMPONENTS[activePage] : null;

  return (
    <div className="app-shell">
      <NavBar
        pages={availablePages}
        activePage={activePage}
        onNavigate={setActivePage}
        user={user}
        onLogout={handleLogout}
      />
      <main className="app-content">
        {ActivePageComponent ? (
          <div className="page">
            <ActivePageComponent />
          </div>
        ) : (
          <p className="hint-text">Your account has no roles authorized to use this application.</p>
        )}
      </main>
    </div>
  );
}
