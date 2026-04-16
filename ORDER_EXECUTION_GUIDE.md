# Order Execution System - Implementation Guide

## Overview
The Order Execution System integrates with Trade Setups to allow traders to place orders efficiently. When executing a trade, the system:
1. **Validates** the setup exists and is active
2. **Calculates** lot sizes automatically
3. **Checks** against max quantity limits
4. **Records** order in database with full details
5. **Stores** calculation metadata for audit trail

## Architecture

### Database Schema

#### `orders` Table
```sql
CREATE TABLE orders (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  account_id      INT NOT NULL (FK: angelone_accounts),
  setup_id        INT (FK: trade_setups),
  segment_name    VARCHAR(100) NOT NULL,
  side            ENUM('BUY','SELL') NOT NULL,
  quantity        INT NOT NULL,
  price           DECIMAL(18,8),
  order_type      VARCHAR(20) DEFAULT 'MARKET',
  status          ENUM('PENDING','ACCEPTED','FILLED','PARTIAL','CANCELLED','REJECTED','FAILED'),
  details         JSON (lot calc data),
  error_message   TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  executed_at     TIMESTAMP NULL,
  cancelled_at    TIMESTAMP NULL,
  FOREIGN KEY (account_id) REFERENCES angelone_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (setup_id) REFERENCES trade_setups(id) ON DELETE SET NULL,
  KEY (status),
  KEY (created_at),
  KEY (account_id)
);
```

## Backend API

### File: `backend/src/orderRoutes.js`

#### `POST /api/orders/execute`
Place a new order using trade setup configuration

**Request:**
```json
{
  "account_id": 4,
  "setup_id": 1,
  "quantity": 1,
  "side": "BUY",
  "price": 50000,
  "order_type": "MARKET"
}
```

**Validation:**
- Account must be connected
- Setup must exist and be active
- Quantity must be > 0
- Side must be BUY or SELL
- Quantity cannot exceed setup.max_qty

**Response (201 Created):**
```json
{
  "message": "Order submitted successfully",
  "order_id": 5,
  "account": {
    "id": 4,
    "label": "vignesh",
    "client_code": "V58814372"
  },
  "setup": {
    "segment": "NIFTY 50",
    "instrument_type": "INDEX",
    "lot_size": 1,
    "quantity_requested": 1,
    "num_lots": 1,
    "quantity_final": 1,
    "notes": "Test setup"
  },
  "order": { ...order details }
}
```

**Auto-Calculations:**
- `num_lots`: ceil(quantity / lot_size)
- `quantity_final`: num_lots * lot_size
- All calculation details stored in `orders.details` as JSON

#### `GET /api/orders`
Get all orders across all accounts
```json
Response: [
  {
    "id": 1,
    "account_id": 4,
    "segment_name": "NIFTY 50",
    "side": "BUY",
    "quantity": 1,
    "status": "ACCEPTED",
    "account_label": "vignesh"
  }
]
```

#### `GET /api/orders/account/:accountId`
Get orders for specific account
```json
GET /api/orders/account/4
Response: [orders for account 4]
```

#### `GET /api/orders/:orderId`
Get detailed order information with setup details
```json
Response:
{
  "id": 1,
  "account_id": 4,
  "setup_id": 1,
  "segment_name": "NIFTY 50",
  "side": "BUY",
  "quantity": 1,
  "price": 50000,
  "order_type": "MARKET",
  "status": "ACCEPTED",
  "details": {
    "segment": "NIFTY 50",
    "instrument_type": "INDEX",
    "lot_size": 1,
    "quantity_requested": 1,
    "num_lots": 1,
    "quantity_final": 1,
    "notes": "Test setup"
  },
  "created_at": "2026-04-10T20:30:00Z",
  "executed_at": "2026-04-10T20:30:05Z"
}
```

#### `PUT /api/orders/:orderId/cancel`
Cancel a pending or accepted order

**Allowed statuses to cancel:** PENDING, ACCEPTED
```json
Response:
{
  "message": "Order cancelled",
  "order": { ...updated order }
}
```

#### `GET /api/orders/stats/summary`
Get order statistics
```json
Response:
{
  "pending": 2,
  "accepted": 5,
  "filled": 12,
  "partial": 1,
  "cancelled": 3,
  "rejected": 0,
  "failed": 1,
  "total": 24
}
```

## Frontend Component

### File: `frontend/src/admin/Orders.jsx`

**Features:**
1. **Account Selection** - Dropdown to select connected account
2. **Setup Selection** - Dropdown populated from selected account's setups
3. **Setup Display** - Shows setup details (type, lot, default qty, max qty, notes)
4. **Form Fields:**
   - Side: BUY / SELL radio
   - Quantity: Number input with default from setup
   - Order Type: MARKET / LIMIT / STOP dropdown
   - Price: Optional field for LIMIT/STOP orders

5. **Statistics Cards** - Real-time counts:
   - Pending
   - Accepted
   - Filled
   - Cancelled
   - Failed

6. **Order Table:**
   - ID, Account, Segment, Side, Quantity, Price, Type, Status, Created, Actions
   - Status color-coded by state
   - Cancel button for PENDING/ACCEPTED orders
   - Account filtering by selected account

7. **Validation:**
   - Warns if qty > setup.max_qty
   - Prevents submit if setup inactive
   - Shows setup metadata before placing order

## How to Use

### 1. Place an Order

Navigate to **Orders** in sidebar

1. **Select Account** → Choose from connected accounts dropdown
2. **Select Setup** → Choose segment (auto-populated with setup details)
3. **Review Setup** → See lot size, default qty, max qty, and notes
4. **Set Quantity** → Default is setup.default_qty
5. **Choose Side** → BUY or SELL
6. **Set Order Type** → MARKET (default) or LIMIT or STOP
7. **Set Price** → If using LIMIT/STOP
8. **Click Button** → "🚀 Buy [SEGMENT]" or "🚀 Sell [SEGMENT]"

### 2. Validation Flow

```
User Input
    ↓
Check Account Connected?
    ↓ NO → Error: "Account not connected"
    ↓ YES
Check Setup Exists & Active?
    ↓ NO → Error: "Setup not found or inactive"
    ↓ YES
Check Quantity > 0?
    ↓ NO → Error: "Quantity must be > 0"
    ↓ YES
Check Quantity ≤ Max Qty?
    ↓ NO → Error: "Exceeds max_qty limit"
    ↓ YES
Calculate Lots (ceil(qty/lot_size))
    ↓
Create Order Record (PENDING)
    ↓
Store Calculation Details (JSON)
    ↓
Return Order ID
    ↓
Update Stats
    ↓
Refresh Order Table
```

### 3. Example Order Workflow

**Scenario:** Trade NIFTY 50 where setup has lot_size=1, max_qty=10

```
User Input:
  - Account: "vignesh" (V58814372)
  - Setup: "NIFTY 50" (Lot: 1, Default: 1, Max: 10)
  - Quantity: 5
  - Side: BUY
  - Order Type: MARKET

Calculation:
  - num_lots = ceil(5 / 1) = 5
  - quantity_final = 5 * 1 = 5
  - Quantity ≤ Max? 5 ≤ 10 ✓

Result:
  - Order created with ID #123
  - Status: PENDING → ACCEPTED
  - Details stored with calculation metadata
  - Table updates immediately
```

## Integration with Trade Setups

### Order ↔ Setup Relationship

```
Setup Definition
├─ segment_name: "NIFTY 50"
├─ instrument_type: "INDEX"
├─ lot_size: 1
├─ default_qty: 1
├─ max_qty: 10
└─ is_active: 1

    ↓ (Used to validate & calculate)

Order Placement
├─ setup_id: FK to setup
├─ segment_name: "NIFTY 50" (copied from setup)
├─ quantity: 5 (user input)
├─ details: {
│   lot_size: 1,
│   num_lots: 5,
│   quantity_final: 5,
│   ...
│ }
└─ status: PENDING
```

## Error Handling

### Validation Errors (400 Bad Request)
```json
{
  "error": "Segment \"NIFTY 50\" already exists at setup level"
}
```

### Account Errors (400 Bad Request)
```json
{
  "error": "Account not found or not connected"
}
```

### Qty Validation (400 Bad Request)
```json
{
  "error": "Order quantity 15 exceeds max allowed 10 for NIFTY 50"
}
```

## Status Workflow

```
PENDING
  ├─ (Awaiting execution)
  ├─ → ACCEPTED (Order acknowledged)
  ├─ → REJECTED (Broker rejected)
  └─ → FAILED (Error during placement)

ACCEPTED
  ├─ → FILLED (Full execution)
  ├─ → PARTIAL (Partial fill)
  ├─ → CANCELLED (User cancelled)
  └─ → FAILED (Execution error)

FILLED / PARTIAL / CANCELLED / FAILED
  └─ Final states
```

## Database Integration Points

1. **Create Order:**
   - Insert into `orders` table
   - Validate against `trade_setups` table
   - Validate `angelone_accounts.connected`

2. **Query Orders:**
   - JOIN with `angelone_accounts` for account_label
   - JOIN with `trade_setups` for segment details
   - Filter by status, date range, account

3. **Cancel Order:**
   - UPDATE `orders.status = 'CANCELLED'`
   - SET `orders.cancelled_at = NOW()`

## Features

✅ **Automatic Lot Calculation** - Orders auto-calculate based on setup lot size  
✅ **Max Qty Validation** - Prevents orders exceeding setup limits  
✅ **Setup Auto-display** - Shows setup metadata before placing  
✅ **Order History** - Full audit trail with timestamps  
✅ **Status Tracking** - Real-time order status updates  
✅ **Statistics Dashboard** - Summary of all orders by status  
✅ **Cancel Orders** - Ability to cancel PENDING/ACCEPTED orders  
✅ **Account Filtering** - View orders by account  
✅ **Detailed Calculation** - Store lot calculations in JSON  
✅ **Error Messages** - Clear validation feedback  

## Testing

### Create Test Order (via API)
```bash
curl -X POST http://localhost:5000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": 4,
    "setup_id": 1,
    "quantity": 1,
    "side": "BUY",
    "price": 50000,
    "order_type": "MARKET"
  }'
```

### Get All Orders
```bash
curl http://localhost:5000/api/orders
```

### Get Account Orders
```bash
curl http://localhost:5000/api/orders/account/4
```

### Get Order Stats
```bash
curl http://localhost:5000/api/orders/stats/summary
```

### Cancel Order
```bash
curl -X PUT http://localhost:5000/api/orders/1/cancel
```

## Files Modified

1. **backend/src/orderRoutes.js** - NEW: Full order management API
2. **backend/src/index.js** - Updated: Mount orderRoutes
3. **backend/src/schema.sql** - Updated: Added orders table schema
4. **frontend/src/admin/Orders.jsx** - NEW: Order placement UI component
5. **frontend/src/admin/Sidebar.jsx** - Updated: Added Orders navigation link
6. **frontend/src/main.jsx** - Updated: Import Orders component and routing

## Next Steps

1. **Restart Backend** - Backend needs to be restarted to load order routes
2. **Create Orders Table** - Run schema migration or manual DB creation
3. **Test UI** - Access /admin/orders and test placing orders
4. **Integrate SmartAPI** - Connect actual order placement to AngelOne broker
5. **Add Real-time Updates** - WebSocket for live order status
6. **Advanced Features** - Bracket orders, OCO orders, algorithmic execution
