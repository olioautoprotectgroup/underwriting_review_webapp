import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import DealerDetail from "./pages/DealerDetail";
import CaseDetail from "./pages/CaseDetail";
import { getClientPrincipal, type ClientPrincipal } from "./lib/api";
import { ALLOWED_STAFF_EMAILS } from "./lib/allowlist";
import logo from "./assets/autoprotect-logo.png";

const ALLOWED = new Set(ALLOWED_STAFF_EMAILS.map((e) => e.toLowerCase()));

function navClass({ isActive }: { isActive: boolean }) {
  return `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10 hover:text-white"
  }`;
}

export default function App() {
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getClientPrincipal()
      .then(setPrincipal)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-brand-600 text-brand-200">
        Loading&hellip;
      </div>
    );
  }

  if (!principal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 bg-gradient-to-br from-brand-600 to-brand-800 px-6 text-center">
        <img src={logo} alt="AutoProtect" className="h-24 w-auto" />
        <h1 className="text-2xl font-black text-white">Underwriting Review</h1>
        <p className="max-w-sm text-brand-100">
          This tool is restricted to approved underwriting staff. Sign in with your
          Microsoft account to continue.
        </p>
        <a
          href="/.auth/login/aad?post_login_redirect_uri=/"
          className="rounded-full bg-highlight px-6 py-3 font-bold text-white shadow-lg shadow-black/20 transition hover:brightness-110"
        >
          Sign in with Microsoft
        </a>
      </div>
    );
  }

  if (!ALLOWED.has(principal.userDetails.toLowerCase())) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 bg-gradient-to-br from-brand-600 to-brand-800 px-6 text-center">
        <img src={logo} alt="AutoProtect" className="h-24 w-auto" />
        <h1 className="text-2xl font-black text-white">Access restricted</h1>
        <p className="max-w-sm text-brand-100">
          This tool is restricted to approved underwriting staff. You're signed in as{" "}
          <strong className="text-white">{principal.userDetails}</strong>, which isn't on the
          approved list.
        </p>
        <a
          href="/.auth/logout?post_logout_redirect_uri=/"
          className="rounded-full bg-highlight px-6 py-3 font-bold text-white shadow-lg shadow-black/20 transition hover:brightness-110"
        >
          Sign out and try a different account
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between bg-brand-600 px-6 py-2.5 shadow-sm">
        <div className="flex items-center gap-6">
          <img src={logo} alt="AutoProtect" className="h-9 w-auto" />
          <span className="hidden text-sm font-bold uppercase tracking-wide text-brand-100 sm:inline">
            Underwriting Review
          </span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>
              Dashboard
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-brand-100">
          <span>{principal.userDetails}</span>
          <a href="/.auth/logout" className="font-medium text-white hover:underline">
            Sign out
          </a>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto bg-brand-50">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dealers/:dealerCode" element={<DealerDetail />} />
          <Route path="/cases/:caseId" element={<CaseDetail />} />
        </Routes>
      </main>
    </div>
  );
}
