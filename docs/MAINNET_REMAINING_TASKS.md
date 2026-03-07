# MainNet Remaining Tasks

Bu doküman CC Bot'un MainNet'e çıkması için tamamlanması gereken işleri listeler.

---

## 1. Bridge (USDCx ↔ USDC)

### 1.1 Backend - Tamamlanan
| Özellik | Durum | Dosya |
|---------|-------|-------|
| Bridge config endpoint | ✅ | `apps/bot/src/api/routes/bridge.ts` |
| Quote hesaplama | ✅ | `apps/bot/src/services/bridge/xreserve.ts` |
| xReserve kontrat adresleri | ✅ | MainNet + TestNet |
| Domain ID'ler (Canton/Ethereum) | ✅ | Canton: 10001, Ethereum: 0 |

### 1.2 Backend - Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| `depositToCanon()` implementasyonu | ✅ | Ethereum → Canton USDC deposit (viem ile implemente edildi) |
| `initiateWithdrawal()` implementasyonu | ✅ | Canton → Ethereum USDCx withdrawal (SDK entegrasyonu) |
| `mintFromAttestation()` | ✅ | DepositAttestation ile USDCx mint |
| Bridge transaction tracking | ✅ | DB'de bridge tx kayıtları (bridge_transactions table) |
| Attestation polling | ✅ | Circle attestation status check (background job) |
| Bridge history endpoint | ✅ | `/api/bridge/history` - gerçek data |

### 1.3 SDK - Tamamlanan
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| `mintUSDCx()` implementasyonu | ✅ | DepositAttestation → USDCx mint |
| `burnUSDCx()` implementasyonu | ✅ | USDCx → BurnIntent creation |
| `createBridgeUserAgreementRequest()` | ✅ | User onboarding for bridge |
| `hasBridgeUserAgreement()` | ✅ | Check if user can use bridge |
| `getBridgeUserAgreementCid()` | ✅ | Get user's agreement contract ID |
| `listPendingDepositAttestations()` | ✅ | List pending attestations for minting |
| `listPendingBurnIntents()` | ✅ | List pending burn intents |
| `fetchBurnMintFactoryContext()` | ✅ | Get factory context for operations |

### 1.4 Frontend - Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Bridge UI screen | ⏳ | Deposit/Withdraw tabs |
| Ethereum wallet connection | ⏳ | WalletConnect veya injected |
| Bridge transaction status | ⏳ | Progress indicator |
| Bridge history view | ⏳ | Past bridge transactions |

### 1.5 Gereksinimler
```
1. Circle xReserve API erişimi (MainNet)
   - Endpoint: https://xreserve-api.circle.com
   - API key gerekli olabilir

2. Ethereum RPC endpoint
   - MainNet: Alchemy/Infura/Public RPC
   - Gas fee estimation

3. BridgeUserAgreement onboarding
   - Kullanıcı ilk bridge işleminden önce
   - Canton kontratı imzalaması gerekli
```

---

## 2. Multi-Token (CC + USDCx)

### 2.1 Backend - Tamamlanan
| Özellik | Durum |
|---------|-------|
| Token type definitions | ✅ |
| Instrument configurations | ✅ |
| `sendToken()` with token param | ✅ |
| `getTokenBalance()` | ✅ |
| `getAllBalances()` | ✅ |
| Transfer endpoint token param | ✅ |

### 2.2 Frontend - Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Multi-token balance display | ⏳ | CC + USDCx ayrı gösterim |
| Token selector in send | ⏳ | Hangi token gönderileceği |
| Token icon/logo assets | ⏳ | CC ve USDCx logoları |
| Token-specific decimals | ⏳ | CC: 10, USDCx: 6 |

---

## 3. Swap (CC ↔ USDCx)

### 3.1 Tasarım - Tamamlanan
| Özellik | Durum | Dosya |
|---------|-------|-------|
| Swap architecture doc | ✅ | `docs/SWAP_ARCHITECTURE.md` |
| Treasury party design | ✅ | Liquidity provider |
| Price oracle strategy | ✅ | Canton amuletPrice |
| DvP settlement design | ✅ | Atomic swap |

### 3.2 Backend - Tamamlanan
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Treasury service | ✅ | TreasuryService class, balance sync, sendToUser |
| Swap service | ✅ | SwapService class, quote generation, execution |
| Quote API (`/api/swap/quote`) | ✅ | Price + fee calculation with Canton amuletPrice |
| Execute swap API (`/api/swap/execute`) | ✅ | Sequential transfer settlement |
| Swap history API (`/api/swap/history`) | ✅ | Past swaps with pagination |
| Swap status API (`/api/swap/status`) | ✅ | Service status + CC price |
| Price oracle integration | ✅ | Canton amuletPrice from mining rounds |
| Slippage protection | ✅ | Max 1% price change |
| Database schema | ✅ | swap_quotes, swap_transactions, treasury_state tables |

### 3.3 Backend - Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Treasury party setup | ⏳ | TREASURY_PARTY_ID + TREASURY_PRIVATE_KEY env vars |
| Treasury private key management | ⏳ | HSM veya secure storage |
| Rate limiting | ⏳ | 10 swap/hour per user |
| ~~Atomic DvP settlement~~ | ✅ | Enhanced Sequential + Automatic Refund implemented |

### 3.4 Enhanced Sequential Settlement (Implemented)
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Refund tracking DB columns | ✅ | userPartyId, refundTxHash, refundAmount, refundedAt, refundReason, refundAttempts |
| Auto refund on Treasury failure | ✅ | SwapService.executeSwap() with retry + refund |
| Background refund retry job | ✅ | BullMQ job every 1 minute |
| Retry with exponential backoff | ✅ | Treasury send: 1s, 2s, 4s; Refund: 2s, 4s, 8s |
| Status flow | ✅ | pending → user_sent → completed OR failed → refund_pending → refunded |

### 3.3 Frontend - Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Swap UI screen | ⏳ | From/To token selection |
| Quote display | ⏳ | Real-time quote |
| Slippage settings | ⏳ | User configurable |
| Swap confirmation | ⏳ | PIN + review |
| Swap history view | ⏳ | Past swaps |

---

## 4. Validator Integration

### 4.1 Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| MergeDelegation setup | ⏳ | Auto UTXO merge without PIN |
| DAR upload | ⏳ | `splice-util-token-standard-wallet.dar` |
| CanReadAsAnyParty grant | ⏳ | Wallet provider party |
| BatchMergeUtility contract | ⏳ | Batch merge operations |

### 4.2 Gereksinimler
```
1. Validator admin erişimi
2. DAR dosyası yükleme yetkisi
3. Party rights yönetimi
```

---

## 5. Production Security

### 5.1 Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Treasury key HSM | ⏳ | Hardware security module |
| Rate limiting tune | ⏳ | Production değerleri |
| DDoS protection | ⏳ | Cloudflare/AWS Shield |
| Audit logging | ⏳ | All sensitive operations |
| Backup strategy | ⏳ | DB + key backups |
| Incident response | ⏳ | Runbook |

---

## 6. ANS (Amulet Name Service)

### 6.1 Backend - Tamamlanan
| Özellik | Durum |
|---------|-------|
| ANS config endpoint | ✅ |
| Name availability check | ✅ |
| Name lookup | ✅ |
| Reverse lookup | ✅ |
| Name registration | ✅ |

### 6.2 Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Payment flow | ⏳ | CC payment for registration |
| Renewal flow | ⏳ | Extend name subscription |
| Name transfer | ⏳ | Transfer ownership |

---

## 7. Notifications

### 7.1 Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Push notifications | ⏳ | Telegram push |
| Email notifications | ⏳ | Resend integration |
| Bridge status alerts | ⏳ | Bridge completion |
| Large transfer alerts | ⏳ | Security alerts |

---

## 8. Monitoring & Analytics

### 8.1 Kalan İşler
| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Prometheus metrics | ⏳ | API metrics |
| Grafana dashboards | ⏳ | Visualization |
| Error tracking | ⏳ | Sentry integration |
| User analytics | ⏳ | Usage patterns |
| Canton health monitoring | ⏳ | Node status |

---

## Öncelik Sıralaması

### P0 - MainNet Launch Blocker
1. Bridge `depositToCanon()` + `mintUSDCx()`
2. Bridge `burnUSDCx()` + withdrawal
3. Frontend multi-token UI
4. Production security review

### P1 - Should Have
1. Swap infrastructure
2. Treasury party setup
3. MergeDelegation (auto UTXO)
4. Bridge history tracking

### P2 - Nice to Have
1. ANS payment flow
2. Push notifications
3. Monitoring dashboards
4. Advanced analytics

---

## Tahmini Efor

| Kategori | Efor | Notlar |
|----------|------|--------|
| Bridge completion | 3-5 gün | Circle API + testing |
| Multi-token frontend | 1-2 gün | UI components |
| Swap infrastructure | 5-7 gün | Treasury + DvP |
| Validator setup | 1-2 gün | Requires admin access |
| Security hardening | 2-3 gün | Audit + fixes |
| **Toplam** | **~15-20 gün** | |

---

*Created: 2026-03-05*
*Last Updated: 2026-03-05 22:00*

---

## Session 3 Updates (2026-03-05 22:00)

### Tamamlanan İşler
- ✅ DevNet bağlantısı düzeltildi (JSON Ledger API: json-ledger-api.localhost)
- ✅ Database bağlantı hatası düzeltildi (DB_USER=canton)
- ✅ Dev auth bypass eklendi (DEV_AUTH_BYPASS=true)
- ✅ Bot port expose edildi (3000:3000)
- ✅ Swap database tabloları oluşturuldu (swap_quotes, swap_transactions, treasury_state)

### Doğrulanan
- ✅ Canton Network bağlantısı: 48ms latency
- ✅ Wallet balance: 465 CC çekiliyor
- ✅ Tüm API endpoint'leri çalışıyor

---

## Session 4 Updates (2026-03-06)

### Enhanced Sequential Settlement with Automatic Refund

Canton Token Standard analiz edildi ve cross-party atomic DvP için SDK'da native destek olmadığı tespit edildi. Canton'da her transaction tek parti tarafından imzalanıyor - bu nedenle true atomic swap için custom Daml contract gerekiyor.

**Çözüm:** Enhanced Sequential Settlement with Automatic Refund pattern implemente edildi.

### Tamamlanan İşler

#### Database Schema Updates
- ✅ `swapTransactions` tablosuna refund tracking kolonları eklendi:
  - `user_party_id` - Refund için kullanıcı party ID
  - `refund_tx_hash` - Refund işleminin transaction hash'i
  - `refund_amount` - Refund miktarı
  - `refunded_at` - Refund zamanı
  - `refund_reason` - Refund sebebi
  - `refund_attempts` - Refund deneme sayısı
- ✅ Status flow güncellendi: `pending → user_sent → completed` VEYA `failed → refund_pending → refunded/refund_failed`
- ✅ Migration SQL oluşturuldu: `0003_swap_refund_columns.sql`

#### TreasuryService Enhancements
- ✅ `issueRefund()` metodu eklendi - Başarısız swap'lar için otomatik refund

#### SwapService Enhancements
- ✅ `executeSwap()` tamamen yeniden yazıldı:
  - Phase 1: Validation (quote, expiry, slippage)
  - Phase 2: Create swap record with userPartyId
  - Phase 3: User → Treasury transfer
  - Phase 4: Treasury → User transfer (with retry)
  - Phase 5A: Treasury failure → automatic refund
  - Phase 5B: Success → mark completed
  - Phase 6: Unexpected error handling with refund
- ✅ `attemptTreasurySendWithRetry()` - Exponential backoff (1s, 2s, 4s)
- ✅ `attemptRefundWithRetry()` - Exponential backoff (2s, 4s, 8s)

#### Background Job
- ✅ Swap refund retry job eklendi (BullMQ)
- ✅ Her 1 dakikada `refund_pending` durumundaki swap'ları kontrol ediyor
- ✅ Max 5 retry, 60 dakika max age
- ✅ TREASURY_PARTY_ID ve TREASURY_PRIVATE_KEY env vars gerekli

### Dosya Değişiklikleri
```
apps/bot/src/db/schema.ts                          - Refund columns
apps/bot/src/db/migrations/0003_swap_refund_columns.sql - Migration
apps/bot/src/services/swap/index.ts                - Enhanced executeSwap
apps/bot/src/services/swap/treasury.ts             - issueRefund method
apps/bot/src/jobs/index.ts                         - Swap refund worker
apps/bot/src/config/constants.ts                   - SWAP_REFUND_CONFIG
```

### Güvenlik Analizi
- ✅ User funds korumalı: Treasury transfer başarısız olursa otomatik refund
- ✅ Retry logic: Geçici hatalar için exponential backoff
- ✅ Background recovery: refund_pending durumundaki swap'lar için background job
- ⚠️ refund_failed durumu: Manuel müdahale gerektirir (admin alert TODO)

### Kalan İşler (P0 için)
- ⏳ Treasury party setup (TREASURY_PARTY_ID, TREASURY_PRIVATE_KEY)
- ⏳ Database migration çalıştırılması
- ⏳ Admin alert for refund_failed status

### Bridge Transaction Tracking (Implemented)

Circle xReserve bridge için full lifecycle tracking implemente edildi.

#### Database Schema
- ✅ `bridge_transactions` tablosu oluşturuldu
- ✅ Status tracking: `deposit_initiated → eth_tx_confirmed → attestation_pending → minted → completed`
- ✅ Retry tracking: `retry_count`, `last_retry_at`, `next_retry_at`
- ✅ Attestation tracking: `attestation_hash`, `attestation_status`, `attestation_received_at`
- ✅ Migration SQL: `0004_bridge_transactions.sql`

#### BridgeService
- ✅ `createDeposit()` - Ethereum deposit kaydı
- ✅ `createWithdrawal()` - Canton withdrawal kaydı
- ✅ `pollAttestation()` - Circle API polling
- ✅ `receiveAttestation()` - Attestation kaydı
- ✅ `getHistory()` - User history with pagination
- ✅ `getPendingAttestations()` - Background job için
- ✅ `getAttestationsReadyForMint()` - Mint ready txs

#### Background Job
- ✅ Bridge polling job (30 saniyede bir)
- ✅ Circle Iris API integration
- ✅ Max 120 retry (1 saat)
- ✅ Max 24 saat age limit

#### API Endpoints
- ✅ `GET /api/bridge/history` - Real data with pagination
- ✅ `POST /api/bridge/record-deposit` - Record ETH deposit
- ✅ `GET /api/bridge/transaction/:id` - Get single tx
- ✅ `GET /api/bridge/stats` - Bridge statistics

### Dosya Değişiklikleri (Bridge)
```
apps/bot/src/db/schema.ts                          - bridge_transactions table
apps/bot/src/db/migrations/0004_bridge_transactions.sql
apps/bot/src/services/bridge/index.ts              - BridgeService class
apps/bot/src/api/routes/bridge.ts                  - Updated routes
apps/bot/src/jobs/index.ts                         - Bridge polling worker
apps/bot/src/config/constants.ts                   - BRIDGE_POLLING_CONFIG
```

*Last Updated: 2026-03-06*
