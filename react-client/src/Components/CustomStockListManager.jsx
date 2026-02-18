import React, { useState, useEffect, useRef } from 'react';

const CUSTOM_STOCK_LISTS_KEY = 'keo_stonks_custom_stock_lists';

const CustomStockListManager = ({ onListCreated, onListUpdated, onClose }) => {
  const [listName, setListName] = useState('');
  const [listDescription, setListDescription] = useState('');
  const [stockInput, setStockInput] = useState('');
  const [stocks, setStocks] = useState([]);
  const [customLists, setCustomLists] = useState([]);
  const [editingListId, setEditingListId] = useState(null);
  const [activeTab, setActiveTab] = useState('create'); // 'create' or 'manage'
  const inputRef = useRef(null);

  // Load custom lists from localStorage
  useEffect(() => {
    loadCustomLists();
  }, []);

  const loadCustomLists = () => {
    try {
      const saved = localStorage.getItem(CUSTOM_STOCK_LISTS_KEY);
      if (saved) {
        setCustomLists(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Failed to load custom lists:', error);
    }
  };

  const saveCustomLists = lists => {
    try {
      localStorage.setItem(CUSTOM_STOCK_LISTS_KEY, JSON.stringify(lists));
      setCustomLists(lists);
    } catch (error) {
      console.error('Failed to save custom lists:', error);
    }
  };

  const handleAddStock = e => {
    e.preventDefault();

    if (!stockInput.trim()) return;

    // Parse input - support comma/space separated symbols
    const newStocks = stockInput
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(s => s.length > 0)
      .filter(s => !stocks.includes(s));

    if (newStocks.length > 0) {
      setStocks([...stocks, ...newStocks]);
      setStockInput('');
      inputRef.current?.focus();
    }
  };

  const handleRemoveStock = symbol => {
    setStocks(stocks.filter(s => s !== symbol));
  };

  const handleSaveList = () => {
    if (!listName.trim() || stocks.length === 0) {
      alert('Please provide a list name and add at least one stock');
      return;
    }

    const newList = {
      id: editingListId || `CUSTOM_${Date.now()}`,
      name: listName.trim(),
      description: listDescription.trim() || 'User-created stock list',
      stocks: [...stocks],
      color: '#' + Math.floor(Math.random() * 16777215).toString(16),
      createdAt: editingListId
        ? customLists.find(l => l.id === editingListId)?.createdAt
        : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let updatedLists;
    if (editingListId) {
      updatedLists = customLists.map(l =>
        l.id === editingListId ? newList : l
      );
    } else {
      updatedLists = [...customLists, newList];
    }

    saveCustomLists(updatedLists);

    if (editingListId) {
      onListUpdated?.(newList);
    } else {
      onListCreated?.(newList);
    }

    // Reset form
    setListName('');
    setListDescription('');
    setStocks([]);
    setEditingListId(null);
    setActiveTab('manage');
  };

  const handleEditList = list => {
    setEditingListId(list.id);
    setListName(list.name);
    setListDescription(list.description);
    setStocks([...list.stocks]);
    setActiveTab('create');
  };

  const handleDeleteList = listId => {
    if (confirm('Are you sure you want to delete this list?')) {
      const updatedLists = customLists.filter(l => l.id !== listId);
      saveCustomLists(updatedLists);
    }
  };

  const handlePasteStocks = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pastedStocks = text
        .toUpperCase()
        .split(/[\s,\n]+/)
        .filter(s => s.length > 0 && /^[A-Z]+$/.test(s))
        .filter(s => !stocks.includes(s));

      if (pastedStocks.length > 0) {
        setStocks([...stocks, ...pastedStocks]);
      }
    } catch (error) {
      console.error('Failed to paste:', error);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '600px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px',
            borderBottom: '1px solid #e9ecef',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: '600',
              color: '#2c3e50',
            }}
          >
            Custom Stock Lists
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6c757d',
              padding: '0',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #e9ecef',
            backgroundColor: '#f8f9fa',
          }}
        >
          <button
            onClick={() => setActiveTab('create')}
            style={{
              flex: 1,
              padding: '12px',
              border: 'none',
              backgroundColor:
                activeTab === 'create' ? '#ffffff' : 'transparent',
              borderBottom:
                activeTab === 'create' ? '2px solid #007bff' : 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === 'create' ? '600' : '500',
              color: activeTab === 'create' ? '#007bff' : '#6c757d',
            }}
          >
            {editingListId ? '✏️ Edit List' : '➕ Create New List'}
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            style={{
              flex: 1,
              padding: '12px',
              border: 'none',
              backgroundColor:
                activeTab === 'manage' ? '#ffffff' : 'transparent',
              borderBottom:
                activeTab === 'manage' ? '2px solid #007bff' : 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === 'manage' ? '600' : '500',
              color: activeTab === 'manage' ? '#007bff' : '#6c757d',
            }}
          >
            📋 Manage Lists ({customLists.length})
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
          }}
        >
          {activeTab === 'create' ? (
            <div>
              {/* List Name */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#495057',
                  }}
                >
                  List Name
                </label>
                <input
                  type="text"
                  value={listName}
                  onChange={e => setListName(e.target.value)}
                  placeholder="e.g., Tech Favorites, Growth Picks"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ced4da',
                    borderRadius: '6px',
                    fontSize: '14px',
                  }}
                />
              </div>

              {/* Description */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#495057',
                  }}
                >
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={listDescription}
                  onChange={e => setListDescription(e.target.value)}
                  placeholder="Brief description of your stock list"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ced4da',
                    borderRadius: '6px',
                    fontSize: '14px',
                  }}
                />
              </div>

              {/* Stock Input */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#495057',
                  }}
                >
                  Add Stocks
                </label>
                <form
                  onSubmit={handleAddStock}
                  style={{ display: 'flex', gap: '8px' }}
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={stockInput}
                    onChange={e => setStockInput(e.target.value.toUpperCase())}
                    placeholder="Enter symbols (e.g., AAPL MSFT GOOGL)"
                    style={{
                      flex: 1,
                      padding: '10px',
                      border: '1px solid #ced4da',
                      borderRadius: '6px',
                      fontSize: '14px',
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                    }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteStocks}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                    }}
                    title="Paste symbols from clipboard"
                  >
                    📋 Paste
                  </button>
                </form>
                <div
                  style={{
                    marginTop: '6px',
                    fontSize: '12px',
                    color: '#6c757d',
                  }}
                >
                  💡 Tip: Enter multiple symbols separated by spaces or commas.
                  You can also paste a list.
                </div>
              </div>

              {/* Current Stocks */}
              {stocks.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '6px',
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#495057',
                    }}
                  >
                    Stocks in List ({stocks.length})
                  </label>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px',
                      padding: '12px',
                      backgroundColor: '#f8f9fa',
                      borderRadius: '6px',
                      border: '1px solid #e9ecef',
                    }}
                  >
                    {stocks.map(symbol => (
                      <div
                        key={symbol}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '6px 10px',
                          backgroundColor: '#ffffff',
                          border: '1px solid #dee2e6',
                          borderRadius: '20px',
                          fontSize: '13px',
                          fontWeight: '500',
                        }}
                      >
                        {symbol}
                        <button
                          onClick={() => handleRemoveStock(symbol)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '0',
                            marginLeft: '4px',
                            color: '#dc3545',
                            fontSize: '16px',
                            lineHeight: '1',
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save Button */}
              <button
                onClick={handleSaveList}
                disabled={!listName.trim() || stocks.length === 0}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor:
                    !listName.trim() || stocks.length === 0
                      ? '#6c757d'
                      : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor:
                    !listName.trim() || stocks.length === 0
                      ? 'not-allowed'
                      : 'pointer',
                  fontSize: '16px',
                  fontWeight: '600',
                  opacity: !listName.trim() || stocks.length === 0 ? 0.6 : 1,
                }}
              >
                {editingListId ? 'Update List' : 'Create List'}
              </button>
            </div>
          ) : (
            <div>
              {customLists.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px',
                    color: '#6c757d',
                  }}
                >
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                    📋
                  </div>
                  <p style={{ fontSize: '16px', margin: '0 0 8px 0' }}>
                    No custom lists yet
                  </p>
                  <p style={{ fontSize: '14px', margin: '0' }}>
                    Create your first custom stock list to get started
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {customLists.map(list => (
                    <div
                      key={list.id}
                      style={{
                        padding: '16px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '8px',
                        border: '1px solid #e9ecef',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'start',
                          marginBottom: '8px',
                        }}
                      >
                        <div>
                          <h4
                            style={{
                              margin: '0 0 4px 0',
                              fontSize: '16px',
                              fontWeight: '600',
                              color: '#2c3e50',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-block',
                                width: '12px',
                                height: '12px',
                                borderRadius: '50%',
                                backgroundColor: list.color,
                              }}
                            />
                            {list.name}
                          </h4>
                          <p
                            style={{
                              margin: '0 0 8px 0',
                              fontSize: '13px',
                              color: '#6c757d',
                            }}
                          >
                            {list.description}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => handleEditList(list)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#007bff',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteList(list.id)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#dc3545',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#495057',
                        }}
                      >
                        <strong>{list.stocks.length} stocks:</strong>{' '}
                        {list.stocks.slice(0, 10).join(', ')}
                        {list.stocks.length > 10 &&
                          ` ... +${list.stocks.length - 10} more`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomStockListManager;

// Export utility functions for accessing custom lists
export const getCustomStockLists = () => {
  try {
    const saved = localStorage.getItem(CUSTOM_STOCK_LISTS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error('Failed to load custom lists:', error);
    return [];
  }
};

export const getCustomStockList = listId => {
  const lists = getCustomStockLists();
  return lists.find(l => l.id === listId);
};
