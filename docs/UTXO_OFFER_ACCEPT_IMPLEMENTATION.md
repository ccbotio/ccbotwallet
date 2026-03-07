# UTXO & Offer/Accept Implementation Guide

## Overview
This document describes the implementation of UTXO management and Offer/Accept (2-step transfer) functionality for the Canton Telegram Wallet.

---

## 1. Database Schema Changes

**File:** `apps/bot/src/db/schema.ts`

### Users Table - New Columns
```typescript
// User preference: Auto-merge UTXOs when >10 (requires MergeDelegation)
autoMergeUtxo: boolean('auto_merge_utxo').default(true).notNull(),

// User preference: Enable 1-step transfers via TransferPreapproval
oneStepTransfers: boolean('one_step_transfers').default(true).notNull(),
```

### Wallets Table - New Columns
```typescript
// MergeDelegation contract ID - enables auto UTXO merge without PIN
mergeDelegationCid: varchar('merge_delegation_cid', { length: 256 }),

// TransferPreapproval contract ID - enables 1-step incoming transfers
transferPreapprovalCid: varchar('transfer_preapproval_cid', { length: 256 }),
```

### Migration SQL
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_merge_utxo BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS one_step_transfers BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS merge_delegation_cid VARCHAR(256);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS transfer_preapproval_cid VARCHAR(256);
```

---

## 2. API Endpoints

### Preferences API
**File:** `apps/bot/src/api/routes/wallet.ts`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wallet/preferences` | Get user wallet preferences |
| PUT | `/api/wallet/preferences` | Update user wallet preferences |

**Request Body (PUT):**
```json
{
  "autoMergeUtxo": true,
  "oneStepTransfers": true
}
```

### Reject Transfer API
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/wallet/reject-transfer` | Reject a pending transfer |

**Request Body:**
```json
{
  "transferInstructionCid": "00...",
  "userShareHex": "abc123..."
}
```

---

## 3. SDK Methods

**File:** `packages/canton-client/src/official-sdk.ts`

### rejectTransferInstruction
```typescript
async rejectTransferInstruction(
  partyId: string,
  transferInstructionCid: string,
  privateKeyHex: string
): Promise<{ success: boolean; error?: string }>
```

Exercises the `Reject` choice on a `TransferInstruction` contract, declining the incoming transfer and returning funds to sender.

---

## 4. Frontend Integration

### API Client
**File:** `apps/mini-app/lib/api.ts`

```typescript
// Reject a pending transfer
async rejectPendingTransfer(
  transferInstructionCid: string,
  userShareHex: string,
  signal?: AbortSignal
)

// Get wallet preferences
async getPreferences(signal?: AbortSignal)

// Update wallet preferences
async updatePreferences(
  preferences: { autoMergeUtxo?: boolean; oneStepTransfers?: boolean },
  signal?: AbortSignal
)
```

### WalletContext
**File:** `apps/mini-app/context/WalletContext.tsx`

```typescript
// New method in context
rejectPendingTransfer: (contractId: string, pin: string) => Promise<{ success: boolean; error?: string }>;
```

### Settings Screen
**File:** `apps/mini-app/app/page.tsx`

Settings toggles now:
- Load preferences from backend on mount
- Save preferences when changed
- Show loading/saving state
- Revert on error

---

## 5. Transfer Flow Comparison

### 2-Step Transfer (Offer/Accept) - Without TransferPreapproval
```
Sender                          Receiver
  |                                |
  |-- createTransfer() ---------->|
  |   (TransferInstruction)       |
  |                                |
  |                         [Pending in UI]
  |                                |
  |<-- exerciseChoice('Accept') --|
  |   OR                           |
  |<-- exerciseChoice('Reject') --|
```

### 1-Step Transfer - With TransferPreapproval
```
Sender                          Receiver
  |                                |
  |-- createTransfer() ---------->|
  |   (Auto-accepted via          |
  |    TransferPreapproval)       |
  |                                |
  |                         [Instant balance]
```

---

## 6. UTXO Management

### Current Implementation
- **Manual Merge:** User triggers merge with PIN via Settings
- **Auto-Check Job:** Every 5 minutes, checks if UTXO count >10
- **Notification:** If merge needed, user is notified

### MergeDelegation (Future Enhancement)
Requires validator-level setup:

1. Upload `splice-util-token-standard-wallet.dar` to validator
2. Grant `CanReadAsAnyParty` right to wallet provider party
3. Create `BatchMergeUtility` contract
4. Modify wallet onboarding to sign `MergeDelegationProposal`

**Daml Templates:**
```
MergeDelegationProposal
  delegation: MergeDelegation

MergeDelegation
  operator: Party   -- Wallet provider
  owner: Party      -- User
  meta: Metadata

MergeDelegation_Merge Choice
  optMergeTransfer: Optional TransferCall
  optExtraTransfer: Optional TransferCall
  optFeaturedAppRight: Optional FeaturedAppRightCall
```

---

## 7. Dev Mode Enhancements

### Email Verification Bypass
**File:** `apps/mini-app/app/page.tsx`

```typescript
const isDevBypass = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const handleContinue = () => {
  if (isDevBypass) {
    // DEV MODE: Skip email verification, go directly to PIN setup
    setIsEmailVerified(true);
    navigate("pin-setup");
  } else {
    navigate("email-setup");
  }
};
```

---

## 8. File Summary

| File | Changes |
|------|---------|
| `apps/bot/src/db/schema.ts` | Added user preferences and wallet contract ID columns |
| `apps/bot/src/api/routes/wallet.ts` | Added preferences and reject-transfer routes |
| `apps/bot/src/api/handlers/wallet.ts` | Added rejectPendingTransfer, getPreferences, updatePreferences handlers |
| `apps/bot/src/services/wallet/index.ts` | Added rejectPendingTransfer service method |
| `packages/canton-client/src/official-sdk.ts` | Added rejectTransferInstruction method |
| `apps/mini-app/lib/api.ts` | Added rejectPendingTransfer, getPreferences, updatePreferences |
| `apps/mini-app/context/WalletContext.tsx` | Added rejectPendingTransfer to context |
| `apps/mini-app/app/page.tsx` | Connected settings toggles to backend, added dev email bypass |

---

## 9. Sources & References

- [Token Standard APIs - Splice Docs](https://docs.global.canton.network.sync.global/app_dev/token_standard/index.html)
- [MergeDelegation Template](https://docs.test.global.canton.network.sync.global/app_dev/api/splice-util-token-standard-wallet/Splice-Util-Token-Wallet-MergeDelegation.html)
- [Wallet SDK Release Notes](https://docs.digitalasset.com/integrate/devnet/release-notes/index.html)
- [Circle xReserve Developer Docs](https://developers.circle.com/xreserve)

---

*Last Updated: 2026-03-05*
