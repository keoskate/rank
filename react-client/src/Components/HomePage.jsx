/**
 * HOME PAGE - Main Application View
 * 
 * This component serves as the main dashboard and handles:
 * - Board type selection (CEF vs Stock rankings)
 * - Renders either Scoreboard (CEF data) or ModernStonkBoard (Stock data)
 * - Contains the primary user interface logic
 * 
 * CRITICAL PATH: This is the main view users see. Changes here directly
 * impact the user experience and board switching functionality.
 * 
 * UPDATED: Converted to React 18 functional component with hooks
 * MODERN: Uses ModernStonkBoard with TanStack Table
 */
import { useState } from 'react';
// import Scoreboard from './Scoreboard'; // TODO: Modernize Scoreboard with TanStack Table
import ModernStonkBoard from './ModernStonkBoard';

function HomePage() {
    const [currentBoard, setCurrentBoard] = useState('stock');

    const handleBoardToggle = () => {
        setCurrentBoard(currentBoard === 'stock' ? 'cef' : 'stock');
    };

    return (
        <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '20px' }}>
                <h2>Investment Ranking Dashboard</h2>
                <div style={{ marginBottom: '15px' }}>
                    <button 
                        onClick={handleBoardToggle}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: currentBoard === 'stock' ? '#007bff' : '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            marginRight: '10px',
                            cursor: 'pointer'
                        }}
                    >
                        {currentBoard === 'stock' ? 'Switch to CEF' : 'Switch to Stocks'}
                    </button>
                    <span style={{ color: '#666', fontSize: '14px' }}>
                        Currently viewing: {currentBoard === 'stock' ? 'Stock Rankings' : 'CEF Rankings'}
                    </span>
                </div>
            </div>

            {currentBoard === 'stock' ? (
                <ModernStonkBoard />
            ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                    <h3>CEF Scoreboard</h3>
                    <p>Coming soon! The CEF scoreboard will be modernized with the new table system.</p>
                    <p>For now, please use the Stock Rankings.</p>
                </div>
            )}

            <div style={{ marginTop: '30px', fontSize: '12px', color: '#999', textAlign: 'center' }}>
                <p>
                    KEO STONKS V2 • React 18 • Modern Security • TanStack Table
                </p>
                <p>
                    Investment rankings are calculated using dual algorithms: 
                    relative position ranking and statistical deviation analysis
                </p>
            </div>
        </div>
    );
}

export default HomePage;