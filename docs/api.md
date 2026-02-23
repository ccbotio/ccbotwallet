# API Documentation

## Authentication

All API requests require the `x-telegram-id` header.

## Endpoints

### Wallet

#### GET /api/wallet/balance
Get wallet balances.

**Response:**
```json
{
  "success": true,
  "data": [
    { "token": "CC", "amount": "1000.00", "locked": "0" }
  ]
}
```

#### GET /api/wallet/transactions
Get transaction history.

**Query Parameters:**
- `page` (number, default: 1)
- `pageSize` (number, default: 20)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "send",
      "status": "confirmed",
      "amount": "100",
      "token": "CC",
      "toParty": "party-...",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### POST /api/wallet/send
Send tokens.

**Body:**
```json
{
  "toPartyId": "party-...",
  "amount": "100",
  "token": "CC",
  "memo": "optional"
}
```

### User

#### GET /api/user/profile
Get user profile.

#### POST /api/user/verify
Request verification.

**Body:**
```json
{
  "type": "telegram_age" | "botbasher" | "x_account"
}
```

## Error Responses

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Not enough tokens"
  }
}
```
