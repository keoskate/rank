/**
 * DATA VALIDATION TEST PAGE
 *
 * Tests and displays the multi-source validation system.
 * Shows before/after comparison for data quality improvements.
 *
 * Access at: http://localhost:8080/test-validation
 */

import React, { useState } from 'react';
import { getStockData, getValidatedStockData } from '../api/unifiedAPI';

const DataValidationTest = () => {
  const [testResults, setTestResults] = useState([]);
  const [testing, setTesting] = useState(false);
  const [currentSymbol, setCurrentSymbol] = useState('');

  const TEST_SYMBOLS = ['NVDA', 'AAPL', 'TSLA', 'MSFT'];

  const runTest = async () => {
    setTesting(true);
    setTestResults([]);

    for (const symbol of TEST_SYMBOLS) {
      setCurrentSymbol(symbol);

      try {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 Testing ${symbol}`);

        // Fetch unvalidated data
        const oldData = await getStockData(symbol);
        if (!oldData) {
          console.error(`❌ Failed to fetch old data for ${symbol}`);
          continue;
        }

        // Fetch validated data
        const newData = await getValidatedStockData(symbol);
        if (!newData) {
          console.error(`❌ Failed to fetch validated data for ${symbol}`);
          continue;
        }

        // Calculate differences
        const yearHighDiff = newData.yearHigh - oldData.yearHigh;
        const yearHighPct = ((yearHighDiff / oldData.yearHigh) * 100).toFixed(2);

        const result = {
          symbol,
          oldData,
          newData,
          yearHighDiff,
          yearHighPct: parseFloat(yearHighPct),
          overallConfidence: newData._validation?.overallConfidence || 0,
          status: newData._validation?.status || 'unknown',
          verifiedMetrics: newData._validation?.verifiedMetrics || 0,
          totalMetrics: newData._validation?.totalMetrics || 0
        };

        setTestResults(prev => [...prev, result]);
      } catch (error) {
        console.error(`❌ Error testing ${symbol}:`, error);
      }
    }

    setTesting(false);
    setCurrentSymbol('');
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.95) return '#28a745';
    if (confidence >= 0.80) return '#ffc107';
    if (confidence >= 0.60) return '#fd7e14';
    return '#dc3545';
  };

  const getConfidenceLabel = (confidence) => {
    if (confidence >= 0.95) return 'High';
    if (confidence >= 0.80) return 'Medium';
    if (confidence >= 0.60) return 'Low';
    return 'Unreliable';
  };

  return (
    <div style={{ padding: '40px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{
        textAlign: 'center',
        marginBottom: '40px',
        borderBottom: '2px solid #e0e6ed',
        paddingBottom: '20px'
      }}>
        <h1 style={{ margin: '0 0 10px 0', color: '#2c3e50' }}>
          🧪 Data Validation Test
        </h1>
        <p style={{ margin: 0, color: '#6c757d', fontSize: '16px' }}>
          Multi-source validation system test - comparing old vs new data quality
        </p>
      </div>

      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <button
          onClick={runTest}
          disabled={testing}
          style={{
            padding: '15px 30px',
            fontSize: '18px',
            backgroundColor: testing ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: testing ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}
        >
          {testing
            ? `Testing ${currentSymbol || '...'}`
            : `Run Validation Test (${TEST_SYMBOLS.join(', ')})`}
        </button>
      </div>

      {testResults.length > 0 && (
        <div>
          {testResults.map((result, index) => (
            <div
              key={result.symbol}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e0e6ed',
                borderRadius: '8px',
                padding: '30px',
                marginBottom: '30px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              {/* Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '25px',
                borderBottom: '2px solid #e0e6ed',
                paddingBottom: '15px'
              }}>
                <h2 style={{ margin: 0, color: '#2c3e50' }}>
                  {result.symbol}
                </h2>
                <div style={{
                  padding: '8px 16px',
                  backgroundColor: getConfidenceColor(result.overallConfidence),
                  color: 'white',
                  borderRadius: '20px',
                  fontWeight: '600',
                  fontSize: '14px'
                }}>
                  {(result.overallConfidence * 100).toFixed(1)}% - {getConfidenceLabel(result.overallConfidence)}
                </div>
              </div>

              {/* Comparison Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '30px',
                marginBottom: '25px'
              }}>
                {/* Old Data */}
                <div style={{
                  backgroundColor: '#fff5f5',
                  border: '2px solid #ffcccb',
                  borderRadius: '8px',
                  padding: '20px'
                }}>
                  <h3 style={{
                    margin: '0 0 15px 0',
                    color: '#dc3545',
                    fontSize: '18px'
                  }}>
                    ❌ BEFORE (Unvalidated)
                  </h3>
                  <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
                    <div><strong>Price:</strong> ${result.oldData.price?.toFixed(2)}</div>
                    <div><strong>52W High:</strong> ${result.oldData.yearHigh?.toFixed(2)}
                      {result.oldData._dataQuality?.metrics?.yearHigh === 'estimated' &&
                        <span style={{ color: '#dc3545', marginLeft: '8px' }}>⚠️ ESTIMATED</span>
                      }
                    </div>
                    <div><strong>Market Cap:</strong> ${(result.oldData.marketCap / 1000000000).toFixed(2)}B</div>
                    <div><strong>P/E Ratio:</strong> {result.oldData.peRatio?.toFixed(2)}
                      {result.oldData._dataQuality?.metrics?.peRatio === 'estimated' &&
                        <span style={{ color: '#dc3545', marginLeft: '8px' }}>⚠️ ESTIMATED</span>
                      }
                    </div>
                    <div><strong>Beta:</strong> {result.oldData.beta?.toFixed(2)}
                      {result.oldData._dataQuality?.metrics?.beta === 'estimated' &&
                        <span style={{ color: '#dc3545', marginLeft: '8px' }}>⚠️ ESTIMATED</span>
                      }
                    </div>
                  </div>
                </div>

                {/* New Data */}
                <div style={{
                  backgroundColor: '#f0f9ff',
                  border: '2px solid #a5d6ff',
                  borderRadius: '8px',
                  padding: '20px'
                }}>
                  <h3 style={{
                    margin: '0 0 15px 0',
                    color: '#007bff',
                    fontSize: '18px'
                  }}>
                    ✅ AFTER (Validated)
                  </h3>
                  <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
                    <div><strong>Price:</strong> ${result.newData.price?.toFixed(2)}
                      <span style={{ color: '#28a745', marginLeft: '8px', fontSize: '12px' }}>
                        ({result.newData._validation?.metrics?.price?.status})
                      </span>
                    </div>
                    <div><strong>52W High:</strong> ${result.newData.yearHigh?.toFixed(2)}
                      <span style={{ color: '#28a745', marginLeft: '8px', fontSize: '12px' }}>
                        ({result.newData._validation?.metrics?.yearHigh?.status})
                      </span>
                    </div>
                    <div><strong>Market Cap:</strong> ${(result.newData.marketCap / 1000000000).toFixed(2)}B
                      <span style={{ color: '#28a745', marginLeft: '8px', fontSize: '12px' }}>
                        ({result.newData._validation?.metrics?.marketCap?.status})
                      </span>
                    </div>
                    <div><strong>P/E Ratio:</strong> {result.newData.peRatio?.toFixed(2)}
                      <span style={{ color: '#28a745', marginLeft: '8px', fontSize: '12px' }}>
                        ({result.newData._validation?.metrics?.peRatio?.status})
                      </span>
                    </div>
                    <div><strong>Beta:</strong> {result.newData.beta?.toFixed(2)}
                      <span style={{ color: '#28a745', marginLeft: '8px', fontSize: '12px' }}>
                        ({result.newData._validation?.metrics?.beta?.status})
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Key Findings */}
              <div style={{
                backgroundColor: Math.abs(result.yearHighPct) > 10 ? '#fff3cd' : '#d4edda',
                border: `2px solid ${Math.abs(result.yearHighPct) > 10 ? '#ffc107' : '#28a745'}`,
                borderRadius: '8px',
                padding: '20px'
              }}>
                <h3 style={{
                  margin: '0 0 15px 0',
                  color: '#2c3e50',
                  fontSize: '18px'
                }}>
                  🔍 Key Findings
                </h3>
                <div style={{ fontSize: '15px', lineHeight: '1.8' }}>
                  {Math.abs(result.yearHighPct) > 10 ? (
                    <div style={{ color: '#856404', fontWeight: '600' }}>
                      🚨 52-Week High was <strong>{Math.abs(result.yearHighPct).toFixed(1)}% WRONG!</strong>
                    </div>
                  ) : Math.abs(result.yearHighPct) > 5 ? (
                    <div style={{ color: '#856404' }}>
                      ⚠️ 52-Week High had {Math.abs(result.yearHighPct).toFixed(1)}% deviation
                    </div>
                  ) : (
                    <div style={{ color: '#155724' }}>
                      ✅ 52-Week High was reasonably accurate ({Math.abs(result.yearHighPct).toFixed(1)}% difference)
                    </div>
                  )}

                  <div style={{ marginTop: '10px' }}>
                    <strong>Validation Status:</strong> {result.verifiedMetrics}/{result.totalMetrics} metrics verified across multiple sources
                  </div>

                  <div style={{ marginTop: '10px', fontSize: '13px', color: '#6c757d' }}>
                    Data sources: {result.newData._validation?.metrics?.yearHigh?.sources?.join(', ') || 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {testResults.length > 0 && (
        <div style={{
          marginTop: '40px',
          padding: '30px',
          backgroundColor: '#e7f3ff',
          border: '2px solid #007bff',
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          <h2 style={{ margin: '0 0 15px 0', color: '#2c3e50' }}>
            ✅ Test Complete!
          </h2>
          <p style={{ margin: 0, fontSize: '16px', color: '#6c757d' }}>
            Validated {testResults.length} stocks. Check the console for detailed logs.
          </p>
        </div>
      )}
    </div>
  );
};

export default DataValidationTest;
