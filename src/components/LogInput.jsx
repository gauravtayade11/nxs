import React, { useRef } from 'react';
import { Upload, Sparkles, Loader2, X } from 'lucide-react';
import { EXAMPLE_LOGS } from '../utils/exampleLogs';

export function LogInput({ logText, setLogText, onAnalyze, isAnalyzing }) {
  const fileInputRef = useRef(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setLogText(event.target.result);
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <section className="log-input-section fade-in">
      {/* Example log buttons */}
      <div className="examples-row">
        <span className="examples-label">Try an example:</span>
        {EXAMPLE_LOGS.map((ex) => (
          <button
            key={ex.tool}
            className="example-btn"
            onClick={() => setLogText(ex.log)}
            title={`Load a sample ${ex.label} error log`}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Textarea with clear button */}
      <div className="log-textarea-wrapper">
        <textarea
          className="log-textarea"
          placeholder="Paste your failing CI/CD pipeline logs, Kubernetes error, or Docker build output here..."
          value={logText}
          onChange={(e) => setLogText(e.target.value)}
          spellCheck="false"
        />
        {logText && (
          <button
            className="clear-btn"
            onClick={() => setLogText('')}
            title="Clear log"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="input-actions">
        <div>
          <input
            type="file"
            accept=".log,.txt"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button
            className="upload-btn"
            onClick={() => fileInputRef.current.click()}
            title="Upload .log or .txt file"
          >
            <Upload size={18} />
            <span>Upload File</span>
          </button>
        </div>

        <button
          className="analyze-btn"
          onClick={onAnalyze}
          disabled={!logText.trim() || isAnalyzing}
        >
          {isAnalyzing ? (
            <>
              <Loader2 size={18} className="spin" />
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Sparkles size={18} />
              <span>Debug Log</span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}
