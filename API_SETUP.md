# Alpha Vantage API Setup Guide

## Overview

The application has been updated to use **Alpha Vantage API** instead of the outdated Yahoo Finance API. Alpha Vantage provides reliable, real-time financial data with a generous free tier.

## Quick Setup (2 minutes)

### 1. Get Your Free API Key

1. Visit: https://www.alphavantage.co/support/#api-key
2. Enter your email address
3. Copy the API key (looks like: `ABCD1234EFGH5678`)

### 2. Update Environment Variables

1. Open the `.env` file in the project root
2. Your API key should already be set:
   ```
   REACT_APP_ALPHA_VANTAGE_API_KEY=1KEVFA9KIQVOBJUE
   ```
3. **IMPORTANT**: If you change the API key:
   - Save the .env file
   - Stop the development server (Ctrl+C)
   - Restart with `npm run dev`
   - Environment variables are loaded at build/start time in React

### 3. Test the Integration

```bash
node test-alpha-vantage.js
```

## API Limits

- **Free Tier**: 500 API calls per day, 5 calls per minute
- **Perfect for development and testing**
- **Automatic rate limiting built into the app**

## What Changed

- ✅ Modern, reliable Alpha Vantage API
- ✅ Secure API key storage in environment variables
- ✅ Built-in rate limiting and error handling
- ✅ Better data quality and availability
- ✅ No more stream reading complexity

## Benefits

- **More reliable**: No more API timeouts or malformed responses
- **Better security**: API key stored in environment variables
- **Higher limits**: 500 calls/day vs 500 calls/month
- **Better support**: Active API with good documentation
- **Future-proof**: Modern, maintained API service

## Usage

Once set up, the DEBUG toggle will work perfectly:

- **🔒 CACHED DATA**: Uses local cached data (no API calls)
- **🌐 LIVE API**: Fetches fresh data from Alpha Vantage

The app automatically respects rate limits with 12-second delays between calls.
