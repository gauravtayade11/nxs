import React from 'react';
import { Terminal, History } from 'lucide-react';

export function Header({ onToggleSidebar }) {
  return (
    <header className="app-header">
      <div className="app-logo">
        <Terminal className="app-logo-icon" size={32} />
        <span>NextSight DevOps</span>
      </div>
      <button
        className="sidebar-toggle-btn"
        onClick={onToggleSidebar}
        title="Toggle history"
      >
        <History size={20} />
      </button>
    </header>
  );
}
