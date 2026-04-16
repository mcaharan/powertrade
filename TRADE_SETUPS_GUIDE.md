# Trade Setups Feature - Implementation Guide

## Overview
The Trade Setups system allows each trader to configure trading segments (NIFTY, SENSEX, CRUDE OIL, GOLD, etc.) with their specific lot sizes and default quantities. Each setup is saved per account in the database.

## What Was Created

### 1. Database Schema
**Table: `trade_setups`**
```sql
CREATE TABLE trade_setups (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  account_id      INT NOT NULL (FK to angelone_accounts),
  segment_name    VARCHAR(100) NOT NULL,      -- e.g., NIFTY 50, CRUDE OIL, GOLD
  instrument_type VARCHAR(50),                -- INDEX, COMMODITY, FOREX, CRYPTO, STOCK, OTHER
  lot_size        INT NOT NULL DEFAULT 1,     -- Standard lot size (e.g., 100 for CRUDE OIL)
  default_qty     INT NOT NULL DEFAULT 1,     -- Default quantity to trade
  max_qty         INT,                        -- Optional maximum limit
  is_active       TINYINT DEFAULT 1,          -- Enable/disable this setup
  notes           TEXT,                       -- Custom notes
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (account_id, segment_name)      -- One segment per account
);
```

### 2. Backend API Endpoints

#### `GET /api/trade-setups`
Get all trade setups with account information
```json
Response:
[
  {
    "id": 1,
    "account_id": 4,
    "segment_name": "NIFTY 50",
    "instrument_type": "INDEX",
    "lot_size": 1,
    "default_qty": 1,
    "max_qty": 10,
    "is_active": 1,
    "notes": "Test setup",
    "label": "vignesh",
    "client_code": "V58814372"
  }
]
```

#### `GET /api/trade-setups/account/:accountId`
Get all setups for a specific account

#### `GET /api/trade-setups/:setupId`
Get a single setup details

#### `POST /api/trade-setups/account/:accountId`
Create a new trade setup
```json
Request Body:
{
  "segment_name": "NIFTY 50",
  "instrument_type": "INDEX",
  "lot_size": 1,
  "default_qty": 1,
  "max_qty": 10,
  "notes": "Optional notes"
}

Response:
{
  "message": "Trade setup created",
  "setup": { ... }
}
```

#### `PUT /api/trade-setups/:setupId`
Update an existing setup (all fields optional)
```json
{
  "segment_name": "NIFTY 50",
  "lot_size": 1,
  "default_qty": 2,
  "is_active": 1
}
```

#### `DELETE /api/trade-setups/:setupId`
Delete a trade setup

### 3. Frontend Component

**Location:** `frontend/src/admin/TradeSetups.jsx`

**Features:**
- Account selector dropdown (shows only connected accounts)
- Quick-select buttons for common segments
- Add/Edit/Delete trade setup form
- Table view with:
  - Account name
  - Segment name
  - Instrument type
  - Lot size
  - Default quantity
  - Max quantity
  - Active/Inactive toggle
  - Notes
  - Edit/Delete buttons
- Statistics cards (Total Setups, Active, Accounts)
- Validation and error handling
- Glassmorphic UI design

**Navigation:** Menu > Trade Setups (or `/admin/trade-setups`)

### 4. Pre-configured Common Segments

Quick-select buttons for frequently used segments:

| Segment | Type | Default Lot |
|---------|------|------------|
| NIFTY 50 | INDEX | 1 |
| SENSEX | INDEX | 1 |
| BANK NIFTY | INDEX | 1 |
| CRUDE OIL | COMMODITY | 100 |
| GOLD | COMMODITY | 100 |
| SILVER | COMMODITY | 1 |
| NATURAL GAS | COMMODITY | 10000 |
| EUR/USD | FOREX | 1 |
| GBP/USD | FOREX | 1 |

Users can also create custom segments with any name.

## How to Use

### Step 1: Access Trade Setups
1. Log in to Admin Dashboard
2. Click "Trade Setups" in the left sidebar

### Step 2: Select an Account
1. Choose a connected AngelOne account from the dropdown
2. Only connected accounts are available

### Step 3: Add a Setup
**Option A - Quick Select:**
1. Click any of the predefined segment buttons (NIFTY, SENSEX, etc.)
2. The segment name, type, and lot size auto-fill
3. Adjust quantity if needed
4. Click "Add Setup"

**Option B - Custom Segment:**
1. Manually enter segment name
2. Select instrument type (INDEX, COMMODITY, FOREX, etc.)
3. Set lot size and default quantity
4. Optionally set max quantity and notes
5. Click "Add Setup"

### Step 4: Manage Setups
- **Edit:** Click "Edit" button → modify fields → click "Update Setup"
- **Toggle:** Click "Active"/"Inactive" button to enable/disable
- **Delete:** Click "Delete" and confirm

## Database Example

After creating setups for account with ID 4:

```sql
SELECT * FROM trade_setups WHERE account_id = 4;

id | account_id | segment_name | instrument_type | lot_size | default_qty | max_qty | is_active | notes
1  | 4          | NIFTY 50     | INDEX          | 1        | 1           | 10      | 1         | Test setup
2  | 4          | CRUDE OIL    | COMMODITY      | 100      | 1           | 5       | 1         | Oil hedging
3  | 4          | GOLD         | COMMODITY      | 100      | 2           | NULL    | 0         | Inactive
```

## API Response Examples

### Create Setup (201 Created)
```json
{
  "message": "Trade setup created",
  "setup": {
    "id": 1,
    "account_id": 4,
    "segment_name": "NIFTY 50",
    "instrument_type": "INDEX",
    "lot_size": 1,
    "default_qty": 1,
    "max_qty": 10,
    "is_active": 1,
    "notes": "Test setup",
    "created_at": "2026-04-10T20:18:55.000Z",
    "updated_at": "2026-04-10T20:18:55.000Z"
  }
}
```

### Error: Duplicate Segment (400 Bad Request)
```json
{
  "error": "Segment \"NIFTY 50\" already exists for this account"
}
```

### Error: Account Not Connected (400 Bad Request)
```json
{
  "error": "Account not connected"
}
```

## Files Created/Modified

### New Files:
- `backend/src/tradeSetupRoutes.js` - API route handlers
- `frontend/src/admin/TradeSetups.jsx` - React component

### Modified Files:
- `backend/src/schema.sql` - Added trade_setups table schema
- `backend/src/index.js` - Mounted trade setup routes
- `frontend/src/admin/Sidebar.jsx` - Added navigation link
- `frontend/src/main.jsx` - Added route and component import

### Database:
- Table `trade_setups` created with full schema

## Testing the API

### Create a setup:
```bash
curl -X POST http://localhost:5000/api/trade-setups/account/4 \
  -H "Content-Type: application/json" \
  -d '{
    "segment_name": "NIFTY 50",
    "instrument_type": "INDEX",
    "lot_size": 1,
    "default_qty": 1,
    "max_qty": 10,
    "notes": "Test setup"
  }'
```

### Get all setups:
```bash
curl http://localhost:5000/api/trade-setups
```

### Get setups for specific account:
```bash
curl http://localhost:5000/api/trade-setups/account/4
```

### Update a setup:
```bash
curl -X PUT http://localhost:5000/api/trade-setups/1 \
  -H "Content-Type: application/json" \
  -d '{"default_qty": 2, "max_qty": 15}'
```

### Delete a setup:
```bash
curl -X DELETE http://localhost:5000/api/trade-setups/1
```

## Key Features

✅ **Per-Account Configuration** - Each trader manages their own segment setups  
✅ **Flexible Segments** - Support for predefined and custom segments  
✅ **Quick Templates** - One-click setup for common instruments  
✅ **Full CRUD** - Create, read, update, delete operations  
✅ **Data Validation** - Prevents duplicate segments per account  
✅ **Active/Inactive Toggle** - Enable/disable setups without deleting  
✅ **Account Integration** - Only shows connected AngelOne accounts  
✅ **Database Persistence** - All data saved and retrievable  
✅ **Error Handling** - Clear error messages and validation  
✅ **UI Integration** - Matches existing glassmorphic design  

## Next Steps

This foundation is ready for:
1. **Order Placement** - Use lot_size and default_qty when placing trades
2. **Portfolio Tracking** - Link trade setups to actual orders
3. **Risk Management** - Use max_qty for position limits
4. **Automated Trading** - Integrate with strategy engine
5. **Backtesting** - Test strategies with configured segments
