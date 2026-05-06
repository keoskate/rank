const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { aiTradingEngine, polygonClient, technicalIndicatorsService, patternRecognitionService, assetUtils } = deps;

  // Start AI trading session (creates a new session)
  router.post('/api/ai/session/start', async (req, res) => {
    try {
      const { userId = 'default_user', config } = req.body;
      const session = aiTradingEngine.startSession(userId, config);
      res.json({ success: true, ...session });
    } catch (error) {
      console.error('Error starting AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Stop AI trading session (by sessionId)
  router.post('/api/ai/session/stop', async (req, res) => {
    try {
      const { sessionId, userId } = req.body;
      // Support both sessionId and userId for backwards compatibility
      const id = sessionId || userId || 'default_user';
      const summary = aiTradingEngine.stopSession(id);
      res.json({ success: true, ...summary });
    } catch (error) {
      console.error('Error stopping AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Pause AI trading session
  router.post('/api/ai/session/pause', async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      aiTradingEngine.pauseSession(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error pausing AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Resume AI trading session
  router.post('/api/ai/session/resume', async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      aiTradingEngine.resumeSession(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error resuming AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete AI trading session permanently
  // Query param: closePositions=true to panic sell all positions before deleting
  router.delete('/api/ai/session/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const closePositions = req.query.closePositions === 'true';
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      const result = await aiTradingEngine.deleteSession(sessionId, {
        closePositions,
      });
      if (result.error) {
        return res.status(404).json(result);
      }
      res.json(result);
    } catch (error) {
      console.error('Error deleting AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Panic sell - immediately close all positions for a session without deleting it
  router.post('/api/ai/session/:sessionId/panic-sell', async (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      console.log(`[API] Panic sell requested for session ${sessionId}`);
      const result = await aiTradingEngine.panicSell(sessionId);
      if (result.error) {
        return res.status(404).json(result);
      }
      res.json(result);
    } catch (error) {
      console.error('Error executing panic sell:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clone AI trading session
  router.post('/api/ai/session/clone', async (req, res) => {
    try {
      const { sessionId, name, paperTrading } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      const result = aiTradingEngine.cloneSession(sessionId, {
        name,
        paperTrading,
      });
      if (result.error) {
        return res.status(404).json(result);
      }
      res.json(result);
    } catch (error) {
      console.error('Error cloning AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Health check for trading sessions — detects stale/dead trading loops
  router.get('/api/ai/health', (req, res) => {
    try {
      const health = aiTradingEngine.getSessionHealth();
      const staleCount = health.filter(s => s.isStale).length;
      res.json({
        status: staleCount > 0 ? 'degraded' : 'healthy',
        runningSessions: health.length,
        staleSessions: staleCount,
        sessions: health,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error getting session health:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all sessions for a user
  router.get('/api/ai/sessions/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const sessions = aiTradingEngine.getAllUserSessions(userId);
      res.json({ sessions });
    } catch (error) {
      console.error('Error getting AI sessions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get specific session by sessionId
  router.get('/api/ai/session/detail/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = aiTradingEngine.getSession(sessionId);
      if (!session) {
        return res.json({ status: 'not_found' });
      }
      res.json(session);
    } catch (error) {
      console.error('Error getting AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get AI session status (backwards compatible - returns first active session for user)
  router.get('/api/ai/session/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const status = aiTradingEngine.getSessionStatus(userId);
      if (!status) {
        return res.json({ status: 'stopped' });
      }
      res.json(status);
    } catch (error) {
      console.error('Error getting AI session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update AI session config (by sessionId)
  router.put('/api/ai/session/:sessionId/config', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const newConfig = req.body;
      aiTradingEngine.updateConfig(sessionId, newConfig);
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating AI config:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get AI decision history
  router.get('/api/ai/decisions/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const limit = parseInt(req.query.limit) || 100;
      const decisions = aiTradingEngine.getDecisionHistory(sessionId, limit);
      res.json({ decisions });
    } catch (error) {
      console.error('Error getting AI decisions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Analyze patterns for a symbol
  router.post('/api/ai/patterns/analyze', async (req, res) => {
    try {
      const { symbol } = req.body;

      // Get candles
      const toDate = new Date();
      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Detect if this is a crypto symbol
      const upperSymbol = symbol.toUpperCase();
      const isCryptoSymbol = assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
                             upperSymbol.includes('/USD') ||
                             upperSymbol.startsWith('X:');

      let candles;
      if (isCryptoSymbol) {
        candles = await polygonClient.getCryptoAggregates(symbol, 5, 'minute', {
          from: fromDate.toISOString().split('T')[0],
          to: toDate.toISOString().split('T')[0],
        });
      } else {
        candles = await polygonClient.getAggregates(symbol, 5, 'minute', {
          from: fromDate.toISOString().split('T')[0],
          to: toDate.toISOString().split('T')[0],
        });
      }

      if (!candles || candles.length < 50) {
        return res.status(400).json({ error: 'Insufficient data' });
      }

      const indicators = technicalIndicatorsService.getAllIndicators(candles);
      const patterns = await patternRecognitionService.predictPattern(
        candles,
        indicators
      );

      res.json({
        symbol,
        patterns,
        indicators: indicators.signals,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error analyzing patterns:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // AI Research Chat - Real AI-powered stock research using Claude API
  router.post('/api/ai/research', async (req, res) => {
    try {
      const { message, context, conversationHistory } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      console.log(`🤖 AI Research query: "${message.substring(0, 50)}..."`);

      // Initialize Anthropic client
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      // Get current trading mode and real account data
      const { tradingModeManager, alpacaClient } = deps;
      const tradingMode = tradingModeManager.getModeInfo();

      // Fetch real-time data from Alpaca
      let accountData = null;
      let positionsData = [];

      try {
        accountData = await alpacaClient.getAccount();
        positionsData = await alpacaClient.getPositions();
      } catch (error) {
        console.warn('Could not fetch Alpaca data:', error.message);
      }

      // Build comprehensive context for Claude
      const systemPrompt = `You are an expert trading assistant for a stock trading application. You have access to:

1. **Account Information:**
   - Trading Mode: ${tradingMode.mode.toUpperCase()} (${tradingMode.accountNumber})
   - Portfolio Value: $${accountData?.portfolio_value || 'N/A'}
   - Cash Available: $${accountData?.cash || 'N/A'}
   - Buying Power: $${accountData?.buying_power || 'N/A'}
   - Open Positions: ${positionsData.length}

2. **Current Positions:**
${positionsData.length > 0 ? positionsData.map(pos => `   - ${pos.symbol}: ${pos.qty} shares @ $${pos.avg_entry_price} (Current: $${pos.current_price}, P/L: $${pos.unrealized_pl})`).join('\n') : '   - No open positions'}

3. **Top Ranked Stocks (from proprietary ranking system):**
${
  context.topRankings?.length > 0
    ? context.topRankings
        .slice(0, 10)
        .map(
          (s, i) =>
            `   ${i + 1}. ${s.symbol} - Rank #${s.rank} at $${s.price?.toFixed(2) || 'N/A'}`
        )
        .join('\n')
    : '   - No ranking data available'
}

Your role is to:
- Provide intelligent trading analysis and recommendations
- Answer questions about stocks, portfolio, and market conditions
- Suggest specific actions based on the data
- Be concise but insightful (2-4 short paragraphs max)
- Use emojis sparingly for visual clarity
- Always consider the user is in ${tradingMode.mode.toUpperCase()} mode when making recommendations

If asked about specific stocks, provide analysis based on:
- Current price trends
- Position in rankings (if available)
- Risk/reward considerations
- Diversification advice

Format your response in plain text with clear paragraphs. End with 2-3 specific follow-up question suggestions that would be valuable for the user.`;

      // Build conversation messages
      const messages = [
        ...conversationHistory.slice(-5).map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        })),
        {
          role: 'user',
          content: message,
        },
      ];

      // Call Claude API
      console.log('📡 Calling Claude API for intelligent analysis...');
      const completion = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages,
      });

      const aiResponse = completion.content[0].text;

      // Extract suggestions from response (look for questions at the end)
      const suggestionMatch = aiResponse.match(
        /(?:follow-up questions?|you (?:might|could) ask|consider asking):[^\n]*((?:\n[-•*]\s*.+)+)/i
      );
      let suggestions = [];

      if (suggestionMatch) {
        suggestions = suggestionMatch[1]
          .split('\n')
          .filter(line => line.trim().match(/^[-•*]\s+/))
          .map(line => line.replace(/^[-•*]\s+/, '').trim())
          .filter(s => s.length > 0)
          .slice(0, 3);
      }

      console.log(`✅ Claude response generated (${aiResponse.length} chars)`);

      res.json({
        success: true,
        response: aiResponse,
        suggestions,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Error in AI research:', error.message);
      res.status(500).json({
        error: 'AI research request failed',
        details: error.message,
      });
    }
  });

  return router;
};
