import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation } from "react-router";

import { BookIcon } from "../components/BookIcon.js";

export function AppShell() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Announce the destination after navigation without stealing initial focus.
    if (previousPath.current !== pathname) {
      mainRef.current?.querySelector<HTMLHeadingElement>("h1")?.focus();
      previousPath.current = pathname;
    }
  }, [pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <Link className="brand" to="/" aria-label="OpenStudy library">
          <span className="brand-mark">
            <BookIcon />
          </span>
          <span>OpenStudy</span>
        </Link>
      </header>
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">A quiet place to learn.</footer>
    </div>
  );
}
