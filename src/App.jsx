import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { LogInput } from './components/LogInput';
import { AnalysisOutput } from './components/AnalysisOutput';
import { HistorySidebar } from './components/HistorySidebar';
import { analyzeLog } from './utils/ai';

function App() {
  const [logText, setLogText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('op-history');
    if (saved) {
      try { setHistory(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('op-history', JSON.stringify(history));
  }, [history]);

  const handleAnalyze = async () => {
    if (!logText.trim()) return;
    setIsAnalyzing(true);
    setResult(null);
    setError(null);

    try {
      const response = await analyzeLog(logText);
      setResult(response);
      setHistory(prev => {
        const newEntry = {
          timestamp: new Date().toISOString(),
          logText: logText.substring(0, 500),
          result: response,
        };
        return [newEntry, ...prev].slice(0, 5);
      });
    } catch (err) {
      setError(err.message || 'Analysis failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLoadHistoryItem = (item) => {
    setLogText(item.logText);
    setResult(item.result);
    setError(null);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('op-history');
  };

  return (
    <div className="app-container">
      <main className="main-content">
        <Header onToggleSidebar={() => setSidebarOpen(o => !o)} />

        <div style={{ maxWidth: '800px', width: '100%', margin: '0 auto' }}>
          <p style={{ marginBottom: '2rem', fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
            Paste CI/CD logs, Kubernetes errors, Docker failures, or Terraform traces below to instantly identify the root cause and get actionable copy-paste fixes.
          </p>

          <LogInput
            logText={logText}
            setLogText={setLogText}
            onAnalyze={handleAnalyze}
            isAnalyzing={isAnalyzing}
          />

          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          <AnalysisOutput result={result} isAnalyzing={isAnalyzing} logText={logText} />
        </div>
      </main>

      <HistorySidebar
        history={history}
        onLoadHistoryItem={handleLoadHistoryItem}
        onClearHistory={clearHistory}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
}

export default App;
