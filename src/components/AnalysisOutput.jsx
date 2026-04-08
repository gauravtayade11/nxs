import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, TerminalSquare, AlertTriangle, Lightbulb, Activity, Loader2, Download, Send, MessageSquare } from 'lucide-react';
import { chatFollowUp } from '../utils/ai';

export function AnalysisOutput({ result, isAnalyzing, logText }) {
  const [activeTab, setActiveTab] = useState('summary');
  const [copied, setCopied] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    setCopied(false);
    setChatMessages([]);
    setChatInput('');
  }, [result]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  if (isAnalyzing) {
    return (
      <section className="analysis-output glass-panel">
        <div className="tab-content" style={{ padding: '2rem', textAlign: 'center' }}>
          <Loader2 size={32} className="spin" style={{ color: 'var(--primary-accent)', margin: '1rem auto' }} />
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>
            Analyzing your log with AI...
          </p>
        </div>
      </section>
    );
  }

  if (!result) return null;

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const md = [
      `# DevOps Log Analysis`,
      `**Tool detected:** ${getToolDisplayName(result.tool)}`,
      ``,
      `## Summary`,
      result.summary,
      ``,
      `## Root Cause`,
      result.rootCause,
      ``,
      `## Fix Steps`,
      result.fixSteps,
      ``,
      `## Remediation Commands`,
      '```sh',
      result.commands,
      '```',
      chatMessages.length > 0 ? `\n## Follow-up Q&A` : '',
      ...chatMessages.map((m) => `**${m.role === 'user' ? 'Q' : 'A'}:** ${m.content}`),
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analysis-${result.tool}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleChat = async () => {
    const text = chatInput.trim();
    if (!text || isChatLoading) return;

    const newMessages = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(newMessages);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const reply = await chatFollowUp(logText, result, newMessages);
      setChatMessages([...newMessages, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages([...newMessages, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const tabs = [
    { id: 'summary', label: 'Summary', icon: <Activity size={16} /> },
    { id: 'cause', label: 'Root Cause', icon: <AlertTriangle size={16} /> },
    { id: 'fix', label: 'Fix', icon: <Lightbulb size={16} /> },
    { id: 'commands', label: 'Commands', icon: <TerminalSquare size={16} /> },
    { id: 'chat', label: 'Ask AI', icon: <MessageSquare size={16} /> },
  ];

  const getToolDisplayName = (tool) => {
    switch (tool) {
      case 'kubernetes': return 'Kubernetes';
      case 'docker': return 'Docker';
      case 'ci': return 'CI/CD';
      case 'terraform': return 'Terraform';
      default: return 'General context';
    }
  };

  return (
    <section className="analysis-output glass-panel">
      <div className="tab-content" style={{ padding: '2rem' }}>
        <div className="output-header">
          <h2>Analysis Result</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className={`tool-badge tool-${result.tool || 'generic'}`}>
              {getToolDisplayName(result.tool)} detected
            </div>
            <button className="export-btn" onClick={handleExport} title="Export as Markdown">
              <Download size={15} />
              <span>Export</span>
            </button>
          </div>
        </div>

        <div className="tabs-container">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {tab.icon}
                <span>{tab.label}</span>
              </div>
            </button>
          ))}
        </div>

        {activeTab === 'summary' && (
          <div className="result-block fade-in">
            <h3>Error Summary</h3>
            <p className="text-content">{result.summary}</p>
          </div>
        )}

        {activeTab === 'cause' && (
          <div className="result-block fade-in">
            <h3>Root Cause</h3>
            <div className="text-content" style={{ whiteSpace: 'pre-line' }}>{result.rootCause}</div>
          </div>
        )}

        {activeTab === 'fix' && (
          <div className="result-block fade-in">
            <h3>Suggested Fix Steps</h3>
            <div className="text-content" style={{ whiteSpace: 'pre-line' }}>{result.fixSteps}</div>
          </div>
        )}

        {activeTab === 'commands' && (
          <div className="result-block fade-in">
            <h3>Remediation Commands</h3>
            <p className="text-content">Run the following commands to investigate or fix the issue:</p>
            <div className="code-block-container">
              <div className="code-block-header">
                <span>Terminal (Shell)</span>
                <button className="copy-btn" onClick={() => handleCopy(result.commands)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre className="code-block"><code>{result.commands}</code></pre>
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="result-block fade-in chat-panel">
            <h3>Ask a Follow-up Question</h3>
            <p className="text-content" style={{ marginBottom: '1rem' }}>
              Ask anything about this error — how to roll back, what caused it, how to prevent it, etc.
            </p>

            <div className="chat-messages">
              {chatMessages.length === 0 && (
                <div className="chat-empty">
                  <MessageSquare size={24} style={{ opacity: 0.3 }} />
                  <span>No messages yet. Ask something below.</span>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
                  <span className="chat-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
                  <div className="chat-text" style={{ whiteSpace: 'pre-line' }}>{msg.content}</div>
                </div>
              ))}
              {isChatLoading && (
                <div className="chat-bubble chat-bubble-assistant">
                  <span className="chat-role">AI</span>
                  <Loader2 size={16} className="spin" style={{ color: 'var(--primary-accent)' }} />
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-input-row">
              <input
                className="chat-input"
                type="text"
                placeholder="e.g. How do I roll back this deployment?"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                disabled={isChatLoading}
              />
              <button
                className="chat-send-btn"
                onClick={handleChat}
                disabled={!chatInput.trim() || isChatLoading}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
