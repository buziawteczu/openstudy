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
    <div className="app-shell mx-auto flex flex-col">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <Link
          className="inline-flex min-h-[44px] items-center gap-3 rounded-small text-lg leading-[1.6] font-[650] tracking-[-0.03em] text-text no-underline"
          to="/"
          aria-label="OpenStudy library"
        >
          <span className="grid size-[36px] place-items-center rounded-small bg-accent text-surface">
            <BookIcon />
          </span>
          <span>OpenStudy</span>
        </Link>
      </header>
      <main id="main-content" className="app-main flex-1" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        A quiet place to learn.
      </footer>
    </div>
  );
}
