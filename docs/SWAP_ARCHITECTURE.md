# CC Bot Swap Architecture

## Overview

Bu doküman CC Bot'un swap altyapısını tasarlar. Kullanıcılar CC↔USDCx arasında swap yapabilecek.

---

## 1. Mimari Genel Bakış

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CC BOT SWAP SYSTEM                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────┐         ┌─────────────────┐         ┌─────────────┐      │
│   │   User      │         │   CC Bot        │         │  Treasury   │      │
│   │  Wallet     │◄───────►│   Backend       │◄───────►│   Party     │      │
│   │ (Mini App)  │         │                 │         │ (Liquidity) │      │
│   └─────────────┘         └─────────────────┘         └─────────────┘      │
│         │                         │                         │              │
│         │ 1. Request Quote        │                         │              │
│         │─────────────────────────►                         │              │
│         │                         │                         │              │
│         │ 2. Return Quote         │                         │              │
│         │◄─────────────────────────                         │              │
│         │                         │                         │              │
│         │ 3. Execute Swap         │                         │              │
│         │─────────────────────────►                         │              │
│         │                         │                         │              │
│         │                         │ 4. DvP Settlement       │              │
│         │                         │────────────────────────►│              │
│         │                         │                         │              │
│         │ 5. Confirm              │                         │              │
│         │◄─────────────────────────                         │              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Bileşenler

### 2.1 Treasury Party

Treasury, swap işlemleri için likidite sağlayan özel bir Canton party'sidir.

**Özellikler:**
- CC ve USDCx holding'leri tutar
- CC Bot backend tarafından kontrol edilir
- TransferPreapproval ile gelen transferleri otomatik kabul eder
- MergeDelegation ile UTXO'ları otomatik birleştirir

**Konfigürasyon:**
```typescript
interface TreasuryConfig {
  partyId: string;           // Treasury Canton party ID
  privateKeyHex: string;     // Treasury private key (secure storage)
  ccReserve: number;         // Minimum CC reserve
  usdcxReserve: number;      // Minimum USDCx reserve
  maxSwapAmount: number;     // Maximum single swap amount
  feePercentage: number;     // Swap fee (e.g., 0.3%)
}
```

### 2.2 Swap Engine

Backend servisi olarak implemente edilir.

**Görevler:**
1. Quote hesaplama (fiyat + fee)
2. Swap işlemlerini koordine etme
3. DvP settlement yürütme
4. Likidite yönetimi

### 2.3 Price Oracle

CC/USDCx fiyatını belirler.

**Seçenekler:**

| Yöntem | Açıklama | Avantaj | Dezavantaj |
|--------|----------|---------|------------|
| Fixed Rate | Sabit kur (örn: 1 CC = $0.16) | Basit | Piyasa takibi yok |
| Canton Price | amuletPrice from mining rounds | Resmi fiyat | Sadece CC/USD |
| External Oracle | CoinGecko, CoinMarketCap API | Güncel | Bağımlılık |
| AMM Formula | x*y=k | Otomatik | Likidite gerekli |

**Önerilen:** Canton Price (amuletPrice) + USDCx için 1:1 USD peg

---

## 3. Swap Akışları

### 3.1 CC → USDCx Swap

```
User                    Backend                   Treasury
  │                        │                          │
  │ 1. getSwapQuote        │                          │
  │    (CC → USDCx, 100)   │                          │
  │───────────────────────►│                          │
  │                        │                          │
  │ 2. Quote Response      │                          │
  │    (get: 15.68 USDCx)  │                          │
  │◄───────────────────────│                          │
  │                        │                          │
  │ 3. executeSwap         │                          │
  │    (PIN + quote)       │                          │
  │───────────────────────►│                          │
  │                        │                          │
  │                        │ 4. User sends CC         │
  │                        │    to Treasury           │
  │                        │─────────────────────────►│
  │                        │                          │
  │                        │ 5. Treasury sends USDCx  │
  │                        │    to User               │
  │                        │◄─────────────────────────│
  │                        │                          │
  │ 6. Swap Confirmed      │                          │
  │◄───────────────────────│                          │
```

### 3.2 USDCx → CC Swap

Aynı akış, ters yönde.

---

## 4. Daml Kontratları (Opsiyonel)

### 4.1 SwapOffer Template

```daml
template SwapOffer
  with
    user: Party
    treasury: Party
    fromToken: Text       -- "CC" or "USDCx"
    toToken: Text         -- "CC" or "USDCx"
    fromAmount: Decimal
    toAmount: Decimal
    fee: Decimal
    expiresAt: Time
    validator: Party
  where
    signatory user
    observer treasury, validator

    choice Accept : ()
      controller treasury
      do
        -- Execute DvP settlement
        -- Transfer fromAmount from user to treasury
        -- Transfer toAmount from treasury to user
        pure ()

    choice Reject : ()
      controller treasury
      do
        pure ()

    choice Expire : ()
      controller validator
      do
        now <- getTime
        assertMsg "Not expired" (now >= expiresAt)
        pure ()
```

### 4.2 Atomic Settlement

Canton Token Standard zaten atomic DvP destekliyor. Swap için:

1. User CC'yi Treasury'ye transfer eder (TransferInstruction)
2. Treasury USDCx'i User'a transfer eder (TransferInstruction)
3. İki transfer atomic olarak settle edilir

---

## 5. API Endpoints

### 5.1 Quote API

```
GET /api/swap/quote
Query: {
  fromToken: "CC" | "USDCx"
  toToken: "CC" | "USDCx"
  amount: string
  direction: "exactIn" | "exactOut"
}

Response: {
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  rate: string
  fee: string
  feePercentage: number
  priceImpact: string
  expiresAt: number
  quoteId: string
}
```

### 5.2 Execute Swap API

```
POST /api/swap/execute
Body: {
  quoteId: string
  userShareHex: string  // For signing
}

Response: {
  success: boolean
  txHash: string
  fromAmount: string
  toAmount: string
  fee: string
}
```

### 5.3 Swap History API

```
GET /api/swap/history
Query: {
  limit?: number
  offset?: number
}

Response: {
  swaps: Array<{
    id: string
    fromToken: string
    toToken: string
    fromAmount: string
    toAmount: string
    fee: string
    status: "pending" | "completed" | "failed"
    createdAt: string
    completedAt?: string
  }>
  total: number
}
```

---

## 6. Fiyat Hesaplama

### 6.1 CC → USDCx

```typescript
function calculateSwapQuote(
  fromToken: 'CC' | 'USDCx',
  toToken: 'CC' | 'USDCx',
  amount: number,
  ccPriceUsd: number,  // From Canton mining round
  feePercentage: number = 0.3
): SwapQuote {
  // USDCx is pegged 1:1 to USD
  const usdcxPriceUsd = 1.0;

  let fromAmountUsd: number;
  let toAmount: number;

  if (fromToken === 'CC') {
    fromAmountUsd = amount * ccPriceUsd;
    const feeUsd = fromAmountUsd * (feePercentage / 100);
    toAmount = (fromAmountUsd - feeUsd) / usdcxPriceUsd;
  } else {
    fromAmountUsd = amount * usdcxPriceUsd;
    const feeUsd = fromAmountUsd * (feePercentage / 100);
    toAmount = (fromAmountUsd - feeUsd) / ccPriceUsd;
  }

  return {
    fromToken,
    toToken,
    fromAmount: amount,
    toAmount,
    rate: fromToken === 'CC' ? ccPriceUsd : 1 / ccPriceUsd,
    fee: fromAmountUsd * (feePercentage / 100),
    feePercentage,
  };
}
```

---

## 7. Güvenlik

### 7.1 Slippage Protection

- Quote'lar 60 saniye geçerli
- Fiyat değişimi >1% ise swap reddedilir
- Maximum swap limiti

### 7.2 Treasury Security

- Private key HSM'de saklanır (production)
- Multi-sig approval for large swaps
- Daily/monthly swap limits

### 7.3 Rate Limiting

- User başına: 10 swap/saat
- Total: 1000 swap/saat

---

## 8. Implementation Roadmap

| Phase | Task | Complexity |
|-------|------|------------|
| 1 | Treasury party oluştur | Low |
| 2 | Price oracle entegrasyonu (Canton amuletPrice) | Low |
| 3 | Quote API implementasyonu | Medium |
| 4 | Execute swap (sequential transfers) | Medium |
| 5 | Swap history DB + API | Low |
| 6 | Frontend swap UI | Medium |
| 7 | Atomic DvP settlement | High |
| 8 | Slippage protection | Low |

---

## 9. Alternatif: Temple DEX Entegrasyonu

Temple zaten Canton'da DEX sunuyor. Alternatif olarak:

1. Temple DEX API'sine redirect
2. Kullanıcı Temple'da swap yapar
3. Sonucu CC Bot'a geri göster

**Avantaj:** Daha az geliştirme
**Dezavantaj:** Kullanıcı deneyimi kesintili

---

## 10. Sonuç

Önerilen yaklaşım:

1. **Başlangıç:** Basit sequential transfer swap (Phase 1-6)
2. **Gelişmiş:** Atomic DvP settlement (Phase 7-8)

İlk versiyon için Treasury party + basit fiyat hesaplaması + sequential transfer yeterli.

---

*Created: 2026-03-05*
*Author: Claude (Senior Daml Developer)*
