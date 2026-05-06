const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { aiTradingEngine } = deps;

  // Get available strategy presets
  router.get('/api/ai/presets', (req, res) => {
    try {
      const presets = aiTradingEngine.listStrategyPresets();
      res.json({
        success: true,
        presets,
      });
    } catch (error) {
      console.error('Error getting strategy presets:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific strategy preset
  router.get('/api/ai/presets/:presetName', (req, res) => {
    try {
      const { presetName } = req.params;
      const preset = aiTradingEngine.getStrategyPreset(presetName);

      if (!preset) {
        return res.status(404).json({ error: `Preset '${presetName}' not found` });
      }

      res.json({
        success: true,
        id: presetName,
        preset,
      });
    } catch (error) {
      console.error('Error getting strategy preset:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Start a session from a preset
  router.post('/api/ai/session/from-preset', async (req, res) => {
    try {
      const { userId = 'default_user', presetName, overrides = {} } = req.body;

      // Get the preset
      const preset = aiTradingEngine.getStrategyPreset(presetName);
      if (!preset) {
        return res.status(400).json({ error: `Unknown preset: ${presetName}` });
      }

      // Merge preset with overrides (overrides take precedence)
      const config = { ...preset, ...overrides };

      // Start the session
      const session = aiTradingEngine.startSession(userId, config);

      res.json({
        success: true,
        ...session,
        preset: presetName,
        message: `Started session from preset '${presetName}'`,
      });
    } catch (error) {
      console.error('Error starting preset session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
