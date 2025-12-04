/**
 * AI Research Page - Chat-based Stock Research with MCP Integration
 *
 * Provides natural language interface for:
 * - Stock research and analysis
 * - Market data queries
 * - Portfolio recommendations
 * - Trading insights powered by Alpaca MCP
 *
 * Features:
 * - Real-time chat interface
 * - Context-aware conversations
 * - Integration with rankings and Alpaca data
 * - Example prompts for quick start
 */

import { useState, useEffect, useRef } from 'react';

const AIResearchPage = () => {
  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tradingMode, setTradingMode] = useState(null);

  // Context data
  const [rankings, setRankings] = useState([]);
  const [account, setAccount] = useState(null);

  // Refs
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom of chat
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load initial data
  useEffect(() => {
    loadTradingMode();
    loadRankings();
    loadAccount();

    // Add welcome message
    setMessages([{
      role: 'assistant',
      content: 'Hello! I\'m your AI trading research assistant. I can help you:\n\n• Research stocks and analyze trends\n• Get real-time market data\n• Review your portfolio and positions\n• Generate trading ideas based on rankings\n• Answer questions about the market\n\nWhat would you like to explore today?',
      timestamp: new Date()
    }]);
  }, []);

  const loadTradingMode = async () => {
    try {
      const response = await fetch('/api/trading/mode');
      const data = await response.json();
      if (data.success) {
        setTradingMode(data.mode);
      }
    } catch (err) {
      console.error('Error loading trading mode:', err);
    }
  };

  const loadRankings = async () => {
    try {
      const response = await fetch('/api/rankings/current');
      const data = await response.json();
      if (data.success) {
        setRankings(data.rankings);
      }
    } catch (err) {
      console.error('Error loading rankings:', err);
    }
  };

  const loadAccount = async () => {
    try {
      const response = await fetch('/api/alpaca/account');
      const data = await response.json();
      if (data.success) {
        setAccount(data.account);
      }
    } catch (err) {
      console.error('Error loading account:', err);
    }
  };

  // Example prompts
  const examplePrompts = [
    'What are the top 5 ranked stocks today?',
    'Analyze NVDA fundamentals and give me a recommendation',
    'What\'s my current portfolio balance?',
    'Compare AAPL vs MSFT - which is a better buy right now?',
    'Show me stocks with strong momentum in the rankings',
    'What are the latest market trends?'
  ];

  const handleExampleClick = (prompt) => {
    setInputMessage(prompt);
    inputRef.current?.focus();
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: inputMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Build context for AI
      const context = {
        tradingMode: tradingMode?.mode,
        accountBalance: account?.portfolio_value,
        topRankings: rankings.slice(0, 10).map(r => ({
          symbol: r.ticker,
          rank: r.overallRank,
          price: r.price
        }))
      };

      // Send to AI research endpoint
      const response = await fetch('/api/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: inputMessage,
          context,
          conversationHistory: messages.slice(-5) // Last 5 messages for context
        })
      });

      const data = await response.json();

      if (data.success) {
        const assistantMessage = {
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
          suggestions: data.suggestions || []
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error(data.error || 'AI research request failed');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      const errorMessage = {
        role: 'assistant',
        content: `I encountered an error: ${err.message}\n\nThis feature uses AI-powered analysis. Make sure the backend AI service is configured correctly.`,
        timestamp: new Date(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (confirm('Clear all chat messages?')) {
      setMessages([{
        role: 'assistant',
        content: 'Chat cleared. How can I help you with your trading research?',
        timestamp: new Date()
      }]);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto', height: 'calc(100vh - 100px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: '0 0 5px 0' }}>🤖 AI Research Assistant</h1>
          <p style={{ margin: 0, color: '#6c757d' }}>
            Powered by Claude API • {tradingMode ? `${tradingMode.statusEmoji} ${tradingMode.mode.toUpperCase()} Mode` : 'Loading...'}
          </p>
        </div>
        <button
          onClick={clearChat}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          🗑️ Clear Chat
        </button>
      </div>

      {/* Cost Warning Banner */}
      <div style={{
        backgroundColor: '#fff3cd',
        border: '2px solid #ffc107',
        borderRadius: '8px',
        padding: '16px 20px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px'
      }}>
        <div style={{ fontSize: '24px', flexShrink: 0 }}>💰</div>
        <div>
          <h3 style={{ margin: '0 0 8px 0', color: '#856404', fontSize: '16px', fontWeight: '600' }}>
            API Usage Notice
          </h3>
          <p style={{ margin: 0, color: '#856404', fontSize: '14px', lineHeight: '1.5' }}>
            This feature uses the Claude API and costs approximately <strong>$0.01-0.05 per message</strong> depending on complexity.
            Each question you ask incurs API costs. Use thoughtfully for valuable insights about your portfolio and trading strategy.
          </p>
        </div>
      </div>

      {/* Main Layout: Chat + Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '20px', height: 'calc(100% - 80px)' }}>

        {/* Chat Area */}
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#f8f9fa', borderRadius: '8px', overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '15px'
          }}>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%'
                }}
              >
                <div style={{
                  backgroundColor: msg.role === 'user' ? '#007bff' : msg.isError ? '#dc3545' : '#ffffff',
                  color: msg.role === 'user' ? '#ffffff' : '#212529',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
                    {msg.content}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    marginTop: '6px',
                    opacity: 0.7,
                    textAlign: 'right'
                  }}>
                    {msg.timestamp.toLocaleTimeString()}
                  </div>
                </div>

                {/* Suggestions */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {msg.suggestions.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleExampleClick(suggestion)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          backgroundColor: '#e9ecef',
                          border: '1px solid #dee2e6',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          color: '#495057'
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
                <div style={{
                  backgroundColor: '#ffffff',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center'
                }}>
                  <div className="spinner"></div>
                  <span style={{ color: '#6c757d' }}>AI is thinking...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div style={{
            padding: '16px',
            backgroundColor: '#ffffff',
            borderTop: '1px solid #dee2e6'
          }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <textarea
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me about stocks, market trends, or your portfolio..."
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: '12px',
                  fontSize: '14px',
                  border: '1px solid #ced4da',
                  borderRadius: '6px',
                  resize: 'none',
                  minHeight: '60px',
                  fontFamily: 'inherit'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !inputMessage.trim()}
                style={{
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '600',
                  backgroundColor: isLoading || !inputMessage.trim() ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isLoading || !inputMessage.trim() ? 'not-allowed' : 'pointer',
                  opacity: isLoading || !inputMessage.trim() ? 0.6 : 1
                }}
              >
                {isLoading ? '⏳' : '📤'} Send
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Example Prompts */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>💡 Try asking:</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {examplePrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleExampleClick(prompt)}
                  style={{
                    padding: '10px 12px',
                    fontSize: '13px',
                    textAlign: 'left',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.backgroundColor = '#e9ecef';
                    e.target.style.borderColor = '#007bff';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.backgroundColor = '#f8f9fa';
                    e.target.style.borderColor = '#dee2e6';
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {/* Context Info */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>📊 Current Context</h3>
            <div style={{ fontSize: '13px', color: '#495057', lineHeight: '1.8' }}>
              <div><strong>Mode:</strong> {tradingMode?.mode || 'Loading...'}</div>
              <div><strong>Account:</strong> {tradingMode?.accountNumber || 'N/A'}</div>
              {account && (
                <div><strong>Balance:</strong> ${parseFloat(account.portfolio_value).toLocaleString()}</div>
              )}
              <div><strong>Rankings:</strong> {rankings.length} stocks tracked</div>
            </div>
          </div>

          {/* Quick Actions */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>⚡ Quick Actions</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => handleExampleClick('What are my current positions?')}
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                📊 View Positions
              </button>
              <button
                onClick={() => handleExampleClick('Show me today\'s top performers')}
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                📈 Top Performers
              </button>
              <button
                onClick={() => handleExampleClick('Give me a market summary')}
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  backgroundColor: '#17a2b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                🌐 Market Summary
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Loading Spinner CSS */}
      <style>{`
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #f3f3f3;
          border-top: 2px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default AIResearchPage;
