/**
 * AI Semiconductor Analyst
 *
 * Uses Claude to analyze semiconductor sector sentiment and provide
 * trading direction recommendations for SOXL/SOXS strategy.
 *
 * Triggered on:
 * - Market open (9:30 AM) - Initial direction assessment
 * - After settle phase (10:00 AM) - Confirm or adjust direction
 * - On sentiment direction change - Validate the switch
 */

const Anthropic = require('@anthropic-ai/sdk');

class AISemiconductorAnalyst {
  constructor(options = {}) {
    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Analysis cache
    this.analysisCache = null;
    this.lastAnalysis = null;
    this.lastTrigger = null;

    // Configuration
    this.config = {
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 512,
      ...options,
    };

    // Track if API is available
    this.apiAvailable = !!process.env.ANTHROPIC_API_KEY;

    if (!this.apiAvailable) {
      console.warn('[AI Semiconductor Analyst] ANTHROPIC_API_KEY not set - AI analysis disabled');
    }
  }

  /**
   * Build system prompt for semiconductor analysis
   * @returns {string} System prompt
   */
  buildSystemPrompt() {
    return `You are a semiconductor sector analyst for an automated trading system.
Your job is to assess semiconductor market conditions and provide a trading direction recommendation.

You are analyzing data to determine whether to trade:
- SOXL (3x Bull Semiconductor ETF) on bullish days
- SOXS (3x Bear Semiconductor ETF) on bearish days

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "direction": "bullish" | "bearish" | "neutral",
  "confidenceAdjustment": <integer from -20 to +20>,
  "reasoning": "<1-2 sentence explanation>",
  "keyFactors": ["<factor1>", "<factor2>"],
  "riskLevel": "low" | "medium" | "high",
  "holdDuration": "intraday" | "swing" | "avoid"
}

Guidelines:
- confidenceAdjustment adjusts the base technical confidence by -20 to +20 points
- Use positive adjustment when fundamentals support the direction
- Use negative adjustment when there are concerns or uncertainty
- "avoid" holdDuration means skip trading entirely due to high risk
- Consider semiconductor earnings (NVDA, AMD, INTC, TSM, AVGO, QCOM)
- Consider macro factors (interest rates, tariffs, China demand, AI demand)
- Consider technical context provided in the data
- Be concise and actionable
- If uncertain, recommend "neutral" with negative confidence adjustment`;
  }

  /**
   * Build user message with current market data
   * @param {Object} marketData - Current semiconductor sentiment data
   * @param {string} trigger - What triggered this analysis
   * @returns {string} User message
   */
  buildUserMessage(marketData, trigger) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

    return `Semiconductor Market Analysis Request

Trigger: ${trigger}
Time: ${timeStr} ET

SOXX (Semiconductor ETF) Status:
- Current Price: $${marketData.currentPrice || 'N/A'}
- Open Price: $${marketData.openPrice || 'N/A'}
- Intraday Change: ${marketData.intradayChange || 'N/A'}
- Volatility: ${marketData.volatility || 'N/A'}

Technical Sentiment:
- Direction: ${marketData.direction || 'unknown'}
- Base Confidence: ${marketData.confidence || 0}%
- Trading Allowed: ${marketData.tradingAllowed ? 'Yes' : 'No'}
- Market Phase: ${marketData.phase || 'unknown'}

Dynamic Thresholds:
- Entry: ${marketData.thresholds?.entry || 'N/A'}
- Switch: ${marketData.thresholds?.switch || 'N/A'}

Signals:
${marketData.signals?.map(s => `- ${s}`).join('\n') || '- No signals'}

Based on this data and your knowledge of semiconductor markets, what is your trading recommendation?`;
  }

  /**
   * Parse AI response into structured format
   * @param {string} text - Raw response text
   * @returns {Object} Parsed analysis
   */
  parseResponse(text) {
    try {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Validate required fields
        if (!['bullish', 'bearish', 'neutral'].includes(parsed.direction)) {
          parsed.direction = 'neutral';
        }

        // Clamp confidence adjustment
        parsed.confidenceAdjustment = Math.max(-20, Math.min(20, parseInt(parsed.confidenceAdjustment) || 0));

        // Ensure arrays
        if (!Array.isArray(parsed.keyFactors)) {
          parsed.keyFactors = [];
        }

        // Validate risk level
        if (!['low', 'medium', 'high'].includes(parsed.riskLevel)) {
          parsed.riskLevel = 'medium';
        }

        // Validate hold duration
        if (!['intraday', 'swing', 'avoid'].includes(parsed.holdDuration)) {
          parsed.holdDuration = 'intraday';
        }

        return parsed;
      }

      throw new Error('No valid JSON found in response');
    } catch (error) {
      console.error('[AI Semiconductor Analyst] Failed to parse response:', error.message);
      return {
        direction: 'neutral',
        confidenceAdjustment: -10,
        reasoning: 'Failed to parse AI response',
        keyFactors: ['Parse error'],
        riskLevel: 'high',
        holdDuration: 'avoid',
        parseError: true,
      };
    }
  }

  /**
   * Get AI analysis of semiconductor sector
   * @param {Object} marketData - Current market data (from SemiconductorSentimentEngine)
   * @param {string} trigger - What triggered this analysis (phase_transition, direction_change, manual)
   * @returns {Promise<Object>} AI analysis with confidence adjustment
   */
  async analyze(marketData, trigger = 'manual') {
    // Return cached if same trigger and recent
    if (
      this.analysisCache &&
      this.lastTrigger === trigger &&
      Date.now() - this.lastAnalysis < 60000 // 1 minute cache for same trigger
    ) {
      return this.analysisCache;
    }

    // Check if API is available
    if (!this.apiAvailable) {
      return {
        direction: 'neutral',
        confidenceAdjustment: 0,
        reasoning: 'AI analysis disabled - no API key',
        keyFactors: ['API unavailable'],
        riskLevel: 'medium',
        holdDuration: 'intraday',
        aiDisabled: true,
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[AI Semiconductor Analyst] Running analysis (trigger: ${trigger})`);

    try {
      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: this.buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: this.buildUserMessage(marketData, trigger),
          },
        ],
      });

      const text = response.content[0].text;
      const analysis = this.parseResponse(text);

      // Add metadata
      this.analysisCache = {
        ...analysis,
        timestamp: new Date().toISOString(),
        trigger,
        model: this.config.model,
        inputData: {
          direction: marketData.direction,
          confidence: marketData.confidence,
          intradayChange: marketData.intradayChange,
          phase: marketData.phase,
        },
      };

      this.lastAnalysis = Date.now();
      this.lastTrigger = trigger;

      console.log(
        `[AI Semiconductor Analyst] Analysis complete: ${analysis.direction} (adj: ${analysis.confidenceAdjustment > 0 ? '+' : ''}${analysis.confidenceAdjustment})`
      );

      return this.analysisCache;
    } catch (error) {
      console.error('[AI Semiconductor Analyst] API error:', error.message);

      // Return safe fallback
      return {
        direction: 'neutral',
        confidenceAdjustment: -10,
        reasoning: `AI analysis failed: ${error.message}`,
        keyFactors: ['API error'],
        riskLevel: 'high',
        holdDuration: 'avoid',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Force refresh analysis (bypass cache)
   * @param {Object} marketData - Current market data
   * @param {string} trigger - Trigger reason
   * @returns {Promise<Object>} Fresh AI analysis
   */
  async forceRefresh(marketData, trigger = 'manual_refresh') {
    this.analysisCache = null;
    this.lastAnalysis = null;
    this.lastTrigger = null;
    return this.analyze(marketData, trigger);
  }

  /**
   * Get cached analysis without making API call
   * @returns {Object|null} Cached analysis or null
   */
  getCached() {
    return this.analysisCache;
  }

  /**
   * Check if AI is available
   * @returns {boolean} True if API key is configured
   */
  isAvailable() {
    return this.apiAvailable;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.analysisCache = null;
    this.lastAnalysis = null;
    this.lastTrigger = null;
  }
}

// Export singleton instance
const aiAnalyst = new AISemiconductorAnalyst();

module.exports = {
  AISemiconductorAnalyst,
  aiAnalyst,
};
