/**
 * Component Catalog - Developer Reference Page
 *
 * Visual catalog of all core UI components with:
 * - Live previews of each component
 * - Props documentation
 * - File paths for reference
 * - Easy screenshot capability for AI discussions
 *
 * Route: /dev/components
 */

import { useState } from 'react';
import theme from '../../theme';
import Button from '../common/Button';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import ErrorBoundary from '../common/ErrorBoundary';

// Component catalog data
const COMPONENT_CATALOG = [
  {
    name: 'Button',
    file: 'Components/common/Button.jsx',
    description: 'Primary action button with variants and sizes',
    props: [
      { name: 'variant', type: "'primary' | 'success' | 'danger' | 'outline' | 'ghost'", default: "'primary'" },
      { name: 'size', type: "'small' | 'medium' | 'large'", default: "'medium'" },
      { name: 'disabled', type: 'boolean', default: 'false' },
      { name: 'onClick', type: 'function', default: '-' },
    ],
  },
  {
    name: 'Card',
    file: 'Components/common/Card.jsx',
    description: 'Container with shadow and border styling',
    props: [
      { name: 'variant', type: "'default' | 'success' | 'error' | 'warning' | 'info'", default: "'default'" },
      { name: 'padding', type: "'none' | 'small' | 'medium' | 'large'", default: "'medium'" },
    ],
  },
  {
    name: 'MetricCard',
    file: 'Components/common/MetricCard.jsx',
    description: 'Displays a labeled metric value with styling variants',
    props: [
      { name: 'label/title', type: 'string', default: '-' },
      { name: 'value', type: 'string | number', default: '-' },
      { name: 'subtext/subtitle', type: 'string', default: '-' },
      { name: 'variant', type: "'default' | 'success' | 'error' | 'warning' | 'info'", default: "'default'" },
    ],
  },
];

// Section wrapper for catalog items
const CatalogSection = ({ title, file, description, children }) => (
  <div
    style={{
      marginBottom: theme.spacing.xl,
      borderBottom: `1px solid ${theme.colors.gray200}`,
      paddingBottom: theme.spacing.xl,
    }}
  >
    <div style={{ marginBottom: theme.spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
        <h2
          style={{
            margin: 0,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.gray900,
          }}
        >
          {title}
        </h2>
        <code
          style={{
            fontSize: theme.typography.fontSize.xs,
            backgroundColor: theme.colors.gray100,
            padding: '2px 8px',
            borderRadius: theme.borderRadius.sm,
            color: theme.colors.gray600,
            fontFamily: 'monospace',
          }}
        >
          {file}
        </code>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: theme.typography.fontSize.sm,
          color: theme.colors.gray600,
        }}
      >
        {description}
      </p>
    </div>
    {children}
  </div>
);

// Props table component
const PropsTable = ({ props }) => (
  <table
    style={{
      width: '100%',
      borderCollapse: 'collapse',
      marginTop: theme.spacing.md,
      fontSize: theme.typography.fontSize.sm,
    }}
  >
    <thead>
      <tr style={{ borderBottom: `2px solid ${theme.colors.gray200}`, textAlign: 'left' }}>
        <th style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.medium }}>Prop</th>
        <th style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.medium }}>Type</th>
        <th style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.medium }}>Default</th>
      </tr>
    </thead>
    <tbody>
      {props.map((prop, idx) => (
        <tr key={prop.name} style={{ borderBottom: `1px solid ${theme.colors.gray100}` }}>
          <td style={{ padding: theme.spacing.sm, fontFamily: 'monospace', color: theme.colors.info }}>{prop.name}</td>
          <td style={{ padding: theme.spacing.sm, fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>{prop.type}</td>
          <td style={{ padding: theme.spacing.sm, fontFamily: 'monospace', color: theme.colors.gray500 }}>{prop.default}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

// Preview container
const Preview = ({ label, children }) => (
  <div style={{ marginBottom: theme.spacing.md }}>
    <div
      style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray500,
        marginBottom: theme.spacing.xs,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      {label}
    </div>
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: theme.spacing.md,
        alignItems: 'center',
        padding: theme.spacing.md,
        backgroundColor: theme.colors.gray50,
        borderRadius: theme.borderRadius.md,
        border: `1px dashed ${theme.colors.gray300}`,
      }}
    >
      {children}
    </div>
  </div>
);

const ComponentCatalog = () => {
  const [activeSection, setActiveSection] = useState('all');

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
        backgroundColor: theme.colors.background,
        minHeight: '100vh',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: theme.spacing.xl }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
          <h1
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.xxl,
              fontWeight: theme.typography.fontWeight.bold,
              color: theme.colors.gray900,
            }}
          >
            Component Catalog
          </h1>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              backgroundColor: theme.colors.info,
              color: 'white',
              padding: '2px 8px',
              borderRadius: theme.borderRadius.sm,
              fontWeight: theme.typography.fontWeight.medium,
            }}
          >
            DEV TOOL
          </span>
        </div>
        <p style={{ margin: 0, color: theme.colors.gray600 }}>
          Visual reference for core UI components. Use this to identify components for screenshots and discussions.
        </p>
      </div>

      {/* Quick Nav */}
      <Card style={{ marginBottom: theme.spacing.xl }}>
        <div style={{ display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          <span style={{ color: theme.colors.gray500, marginRight: theme.spacing.sm }}>Jump to:</span>
          {['Button', 'Card', 'MetricCard', 'Theme'].map(section => (
            <a
              key={section}
              href={`#${section.toLowerCase()}`}
              style={{
                color: theme.colors.info,
                textDecoration: 'none',
                padding: '4px 8px',
                backgroundColor: theme.colors.gray100,
                borderRadius: theme.borderRadius.sm,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              {section}
            </a>
          ))}
        </div>
      </Card>

      {/* Button Component */}
      <div id="button">
        <CatalogSection
          title="Button"
          file="Components/common/Button.jsx"
          description="Primary action button with multiple variants and sizes"
        >
          <Preview label="Variants">
            <Button variant="primary">Primary</Button>
            <Button variant="success">Success</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
          </Preview>

          <Preview label="Sizes">
            <Button size="small">Small</Button>
            <Button size="medium">Medium</Button>
            <Button size="large">Large</Button>
          </Preview>

          <Preview label="States">
            <Button>Normal</Button>
            <Button disabled>Disabled</Button>
          </Preview>

          <PropsTable props={COMPONENT_CATALOG[0].props} />
        </CatalogSection>
      </div>

      {/* Card Component */}
      <div id="card">
        <CatalogSection
          title="Card"
          file="Components/common/Card.jsx"
          description="Container with shadow and border for grouping content"
        >
          <Preview label="Variants">
            <Card style={{ minWidth: 120 }}>Default</Card>
            <Card variant="success" style={{ minWidth: 120 }}>Success</Card>
            <Card variant="error" style={{ minWidth: 120 }}>Error</Card>
            <Card variant="warning" style={{ minWidth: 120 }}>Warning</Card>
            <Card variant="info" style={{ minWidth: 120 }}>Info</Card>
          </Preview>

          <Preview label="Padding Sizes">
            <Card padding="none" style={{ minWidth: 80, textAlign: 'center' }}>None</Card>
            <Card padding="small" style={{ minWidth: 80, textAlign: 'center' }}>Small</Card>
            <Card padding="medium" style={{ minWidth: 80, textAlign: 'center' }}>Medium</Card>
            <Card padding="large" style={{ minWidth: 80, textAlign: 'center' }}>Large</Card>
          </Preview>

          <PropsTable props={COMPONENT_CATALOG[1].props} />
        </CatalogSection>
      </div>

      {/* MetricCard Component */}
      <div id="metriccard">
        <CatalogSection
          title="MetricCard"
          file="Components/common/MetricCard.jsx"
          description="Displays labeled metrics with optional subtext"
        >
          <Preview label="Variants">
            <MetricCard label="Default" value="$12,345" subtext="+2.5% today" />
            <MetricCard label="Success" value="85%" subtext="Win rate" variant="success" />
            <MetricCard label="Error" value="-$250" subtext="Loss today" variant="error" />
            <MetricCard label="Warning" value="3" subtext="PDT warning" variant="warning" />
            <MetricCard label="Info" value="12" subtext="Open positions" variant="info" />
          </Preview>

          <Preview label="Real Usage Examples">
            <MetricCard label="Portfolio Value" value="$52,847.32" />
            <MetricCard label="Trades Today" value="7" subtext="4 wins, 3 losses" />
            <MetricCard label="Win Rate" value="67%" variant="success" />
            <MetricCard label="Day P&L" value="+$423.18" subtext="+0.81%" variant="success" />
          </Preview>

          <PropsTable props={COMPONENT_CATALOG[2].props} />
        </CatalogSection>
      </div>

      {/* Theme Reference */}
      <div id="theme">
        <CatalogSection
          title="Theme"
          file="theme.js"
          description="Design tokens for colors, spacing, typography, and more"
        >
          {/* Colors */}
          <Preview label="Semantic Colors">
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              {[
                { name: 'success', color: theme.colors.success },
                { name: 'error', color: theme.colors.error },
                { name: 'warning', color: theme.colors.warning },
                { name: 'info', color: theme.colors.info },
                { name: 'primary', color: theme.colors.primary },
              ].map(c => (
                <div key={c.name} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      backgroundColor: c.color,
                      borderRadius: theme.borderRadius.md,
                      marginBottom: 4,
                    }}
                  />
                  <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600 }}>{c.name}</div>
                </div>
              ))}
            </div>
          </Preview>

          <Preview label="Gray Scale">
            <div style={{ display: 'flex', gap: theme.spacing.xs }}>
              {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(n => (
                <div key={n} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      backgroundColor: theme.colors[`gray${n}`],
                      borderRadius: theme.borderRadius.sm,
                      marginBottom: 4,
                      border: n < 300 ? `1px solid ${theme.colors.gray300}` : 'none',
                    }}
                  />
                  <div style={{ fontSize: '10px', color: theme.colors.gray500 }}>{n}</div>
                </div>
              ))}
            </div>
          </Preview>

          <Preview label="Spacing Scale">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: theme.spacing.md }}>
              {Object.entries(theme.spacing).map(([name, value]) => (
                <div key={name} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 24,
                      height: value,
                      backgroundColor: theme.colors.info,
                      borderRadius: 2,
                      marginBottom: 4,
                    }}
                  />
                  <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600 }}>{name}</div>
                  <div style={{ fontSize: '10px', color: theme.colors.gray400 }}>{value}</div>
                </div>
              ))}
            </div>
          </Preview>

          <Preview label="Typography Sizes">
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              {Object.entries(theme.typography.fontSize).map(([name, value]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md }}>
                  <code style={{ fontSize: theme.typography.fontSize.xs, width: 40, color: theme.colors.gray500 }}>{name}</code>
                  <span style={{ fontSize: value }}>The quick brown fox ({value})</span>
                </div>
              ))}
            </div>
          </Preview>

          <Preview label="Border Radius">
            <div style={{ display: 'flex', gap: theme.spacing.md }}>
              {Object.entries(theme.borderRadius).map(([name, value]) => (
                <div key={name} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      backgroundColor: theme.colors.gray200,
                      borderRadius: value,
                      marginBottom: 4,
                    }}
                  />
                  <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600 }}>{name}</div>
                </div>
              ))}
            </div>
          </Preview>

          <Preview label="Shadows">
            <div style={{ display: 'flex', gap: theme.spacing.lg }}>
              {Object.entries(theme.shadows).map(([name, value]) => (
                <div key={name} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.borderRadius.md,
                      boxShadow: value,
                      marginBottom: 8,
                    }}
                  />
                  <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600 }}>{name}</div>
                </div>
              ))}
            </div>
          </Preview>
        </CatalogSection>
      </div>

      {/* File Reference */}
      <Card>
        <h3 style={{ margin: 0, marginBottom: theme.spacing.md }}>Component File Reference</h3>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          <thead>
            <tr style={{ borderBottom: `2px solid ${theme.colors.gray200}`, textAlign: 'left' }}>
              <th style={{ padding: theme.spacing.sm }}>Component</th>
              <th style={{ padding: theme.spacing.sm }}>File Path</th>
              <th style={{ padding: theme.spacing.sm }}>Category</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: 'Button', file: 'common/Button.jsx', cat: 'Core' },
              { name: 'Card', file: 'common/Card.jsx', cat: 'Core' },
              { name: 'MetricCard', file: 'common/MetricCard.jsx', cat: 'Core' },
              { name: 'ErrorBoundary', file: 'common/ErrorBoundary.jsx', cat: 'Core' },
              { name: 'TradingViewChart', file: 'common/TradingViewChart.jsx', cat: 'Charts' },
              { name: 'PortfolioPerformanceChart', file: 'common/PortfolioPerformanceChart.jsx', cat: 'Charts' },
              { name: 'TradingLogPanel', file: 'common/TradingLogPanel.jsx', cat: 'Trading' },
              { name: 'ConfigPanel', file: 'common/ConfigPanel.jsx', cat: 'Trading' },
              { name: 'CheddarFlowCard', file: 'common/CheddarFlowCard.jsx', cat: 'Analysis' },
              { name: 'TechnicalRegimeCard', file: 'common/TechnicalRegimeCard.jsx', cat: 'Analysis' },
              { name: 'MarketTideCard', file: 'common/MarketTideCard.jsx', cat: 'Analysis' },
              { name: 'StrategyValidatorPanel', file: 'common/StrategyValidatorPanel.jsx', cat: 'Analysis' },
              { name: 'RegimeConfigPanel', file: 'common/RegimeConfigPanel.jsx', cat: 'Config' },
              { name: 'LeveragedEtfPanel', file: 'common/LeveragedEtfPanel.jsx', cat: 'Config' },
              { name: 'StrategyMonitorPanel', file: 'common/StrategyMonitorPanel.jsx', cat: 'Monitoring' },
              { name: 'WatchlistCharts', file: 'common/WatchlistCharts.jsx', cat: 'Charts' },
            ].map((c, idx) => (
              <tr key={c.name} style={{ borderBottom: `1px solid ${theme.colors.gray100}` }}>
                <td style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.medium }}>{c.name}</td>
                <td style={{ padding: theme.spacing.sm, fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>{c.file}</td>
                <td style={{ padding: theme.spacing.sm }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: theme.borderRadius.sm,
                      backgroundColor: theme.colors.gray100,
                      fontSize: theme.typography.fontSize.xs,
                    }}
                  >
                    {c.cat}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

export default ComponentCatalog;
