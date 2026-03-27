import type { ReactNode } from "react";
import { NAV_SECTIONS, type NavSection } from "./nav";

interface AppShellProps {
  activeSection: NavSection;
  onSectionChange: (section: NavSection) => void;
  sectionTitle: string;
  sectionDescription: string;
  sidebar: ReactNode;
  children: ReactNode;
}

export function AppShell({
  activeSection,
  onSectionChange,
  sectionTitle,
  sectionDescription,
  sidebar,
  children
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="panel panel-left">
        <div className="panel-header">
          <h2>Backtester Workspace</h2>
          <span>Structured by session, run, and trade flow</span>
        </div>
        <div className="left-nav">
          {NAV_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeSection ? "left-nav-item active" : "left-nav-item"}
              onClick={() => onSectionChange(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
        <div className="left-context">{sidebar}</div>
      </aside>
      <main className="panel panel-main">
        <section className="workspace-header">
          <h2>{sectionTitle}</h2>
          <p>{sectionDescription}</p>
        </section>
        {children}
      </main>
    </div>
  );
}
