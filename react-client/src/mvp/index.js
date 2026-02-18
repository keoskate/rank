/**
 * MVP - Core Trading Application
 *
 * This directory contains barrel exports for all MVP-critical code.
 * Files exported here require HIGH RIGOR before changes:
 *
 * - Full testing before merging
 * - Code review for trading logic
 * - Consider edge cases and error handling
 *
 * Usage:
 *   import { LiveTradingDashboard } from '@mvp/pages';
 *   import { ConfigPanel, TradingLogPanel } from '@mvp/components';
 *
 * See individual files for categorized exports:
 * - pages.js: Core trading pages
 * - components.js: Shared UI components
 */

// Re-export everything for convenience
export * from './pages';
export * from './components';
