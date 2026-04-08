import React from 'react';
import { Clock, Trash2, Cpu, X } from 'lucide-react';

export function HistorySidebar({ history, onLoadHistoryItem, onClearHistory, isOpen, onClose }) {
  const getToolIcon = (tool) => {
    switch (tool) {
      case 'kubernetes': return '☸️';
      case 'docker': return '🐳';
      case 'ci': return '🔄';
      case 'terraform': return '🏗️';
      default: return <Cpu size={14} />;
    }
  };

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}

      <aside className={`history-sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="history-header">
          <Clock size={16} />
          <span>Recent Analyzed Logs</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            {history.length > 0 && (
              <button
                className="copy-btn"
                onClick={onClearHistory}
                title="Clear History"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button className="copy-btn sidebar-close-btn" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="history-list">
          {history.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '2rem' }}>
              No history yet. Paste a log to get started.
            </p>
          ) : (
            history.map((item) => (
              <div
                key={item.timestamp}
                className="history-item fade-in"
                onClick={() => { onLoadHistoryItem(item); onClose(); }}
              >
                <div className="history-item-header">
                  <div className="history-item-tools" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {item.result.tool ? getToolIcon(item.result.tool) : ''}
                    <span style={{ textTransform: 'uppercase' }}>{item.result.tool || 'Log'}</span>
                  </div>
                  <span className="history-item-time">{formatTime(item.timestamp)}</span>
                </div>
                <div className="history-item-error">
                  {item.result.summary}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
