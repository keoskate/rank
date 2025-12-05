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
import Button from './common/Button';
import Card from './common/Card';
import theme from '../theme';

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
    <div style={{ padding: theme.spacing.md, maxWidth: '1400px', margin: '0 auto', height: 'calc(100vh - 100px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
        <div>
          <h1 style={{ margin: `0 0 ${theme.spacing.xs} 0`, fontFamily: theme.typography.fontFamily }}>🤖 AI Research Assistant</h1>
          <p style={{ margin: 0, color: theme.colors.textLight, fontSize: theme.typography.fontSize.base }}>
            Powered by Claude API • {tradingMode ? `${tradingMode.statusEmoji} ${tradingMode.mode.toUpperCase()} Mode` : 'Loading...'}
          </p>
        </div>
        <Button variant="ghost" size="medium" onClick={clearChat}>
          🗑️ Clear Chat
        </Button>
      </div>

      {/* Cost Warning Banner */}
      <Card variant="warning" padding="medium" style={{ marginBottom: theme.spacing.md, display: 'flex', alignItems: 'flex-start', gap: theme.spacing.sm }}>
        <div style={{ fontSize: theme.typography.fontSize.xxl, flexShrink: 0 }}>💰</div>
        <div>
          <h3 style={{ margin: `0 0 ${theme.spacing.sm} 0`, color: theme.colors.warningDark, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.medium }}>
            API Usage Notice
          </h3>
          <p style={{ margin: 0, color: theme.colors.warningDark, fontSize: theme.typography.fontSize.base, lineHeight: '1.5' }}>
            This feature uses the Claude API and costs approximately <strong>$0.01-0.05 per message</strong> depending on complexity.
            Each question you ask incurs API costs. Use thoughtfully for valuable insights about your portfolio and trading strategy.
          </p>
        </div>
      </Card>

      {/* Main Layout: Chat + Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: theme.spacing.md, height: 'calc(100% - 80px)' }}>

        {/* Chat Area */}
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: theme.colors.gray100, borderRadius: theme.borderRadius.lg, overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: theme.spacing.md,
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.sm
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
                  backgroundColor: msg.role === 'user' ? theme.colors.info : msg.isError ? theme.colors.error : theme.colors.surface,
                  color: msg.role === 'user' ? theme.colors.surface : theme.colors.text,
                  padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                  borderRadius: theme.borderRadius.xl,
                  boxShadow: theme.shadows.md,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  <div style={{ fontSize: theme.typography.fontSize.base, lineHeight: '1.6' }}>
                    {msg.content}
                  </div>
                  <div style={{
                    fontSize: theme.typography.fontSize.xs,
                    marginTop: theme.spacing.xs,
                    opacity: 0.7,
                    textAlign: 'right'
                  }}>
                    {msg.timestamp.toLocaleTimeString()}
                  </div>
                </div>

                {/* Suggestions */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div style={{ marginTop: theme.spacing.sm, display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                    {msg.suggestions.map((suggestion, i) => (
                      <Button
                        key={i}
                        variant="ghost"
                        size="small"
                        onClick={() => handleExampleClick(suggestion)}
                        style={{
                          borderRadius: theme.borderRadius.xl,
                          backgroundColor: theme.colors.gray200,
                          border: `1px solid ${theme.colors.gray300}`,
                          color: theme.colors.gray700
                        }}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
                <div style={{
                  backgroundColor: theme.colors.surface,
                  padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                  borderRadius: theme.borderRadius.xl,
                  boxShadow: theme.shadows.md,
                  display: 'flex',
                  gap: theme.spacing.sm,
                  alignItems: 'center'
                }}>
                  <div className="spinner"></div>
                  <span style={{ color: theme.colors.textLight }}>AI is thinking...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div style={{
            padding: theme.spacing.md,
            backgroundColor: theme.colors.surface,
            borderTop: `1px solid ${theme.colors.gray300}`
          }}>
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              <textarea
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me about stocks, market trends, or your portfolio..."
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: theme.spacing.sm,
                  fontSize: theme.typography.fontSize.base,
                  border: `1px solid ${theme.colors.gray400}`,
                  borderRadius: theme.borderRadius.md,
                  resize: 'none',
                  minHeight: '60px',
                  fontFamily: theme.typography.fontFamily
                }}
              />
              <Button
                variant="primary"
                size="medium"
                onClick={sendMessage}
                disabled={isLoading || !inputMessage.trim()}
              >
                {isLoading ? '⏳' : '📤'} Send
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>

          {/* Example Prompts */}
          <Card padding="medium">
            <h3 style={{ margin: `0 0 ${theme.spacing.sm} 0`, fontSize: theme.typography.fontSize.md, fontFamily: theme.typography.fontFamily }}>💡 Try asking:</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              {examplePrompts.map((prompt, idx) => (
                <Button
                  key={idx}
                  variant="ghost"
                  size="small"
                  onClick={() => handleExampleClick(prompt)}
                  style={{
                    textAlign: 'left',
                    backgroundColor: theme.colors.gray100,
                    border: `1px solid ${theme.colors.gray300}`,
                    whiteSpace: 'normal',
                    height: 'auto',
                    lineHeight: '1.4'
                  }}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </Card>

          {/* Context Info */}
          <Card padding="medium">
            <h3 style={{ margin: `0 0 ${theme.spacing.sm} 0`, fontSize: theme.typography.fontSize.md, fontFamily: theme.typography.fontFamily }}>📊 Current Context</h3>
            <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray700, lineHeight: '1.8' }}>
              <div><strong>Mode:</strong> {tradingMode?.mode || 'Loading...'}</div>
              <div><strong>Account:</strong> {tradingMode?.accountNumber || 'N/A'}</div>
              {account && (
                <div><strong>Balance:</strong> ${parseFloat(account.portfolio_value).toLocaleString()}</div>
              )}
              <div><strong>Rankings:</strong> {rankings.length} stocks tracked</div>
            </div>
          </Card>

          {/* Quick Actions */}
          <Card padding="medium">
            <h3 style={{ margin: `0 0 ${theme.spacing.sm} 0`, fontSize: theme.typography.fontSize.md, fontFamily: theme.typography.fontFamily }}>⚡ Quick Actions</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              <Button
                variant="primary"
                size="small"
                onClick={() => handleExampleClick('What are my current positions?')}
              >
                📊 View Positions
              </Button>
              <Button
                variant="success"
                size="small"
                onClick={() => handleExampleClick('Show me today\'s top performers')}
              >
                📈 Top Performers
              </Button>
              <Button
                variant="primary"
                size="small"
                onClick={() => handleExampleClick('Give me a market summary')}
                style={{ backgroundColor: theme.colors.navBacktest }}
              >
                🌐 Market Summary
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Loading Spinner CSS */}
      <style>{`
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid ${theme.colors.gray200};
          border-top: 2px solid ${theme.colors.info};
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
