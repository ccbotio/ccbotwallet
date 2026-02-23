# Email Integration - TODO List

Bu oturumda yapılan değişiklikler ve kalan işler.

## Yapılanlar ✅

- [x] Resend paketi yüklendi (`pnpm add resend`)
- [x] `RESEND_API_KEY` ve `EMAIL_FROM` env değişkenleri eklendi
- [x] Email servisi Resend ile entegre edildi
- [x] HTML email şablonu eklendi (verification code)
- [x] `.env.example` güncellendi
- [x] Notification Worker implement edildi
- [x] Canton Sync Worker implement edildi (incoming transfer bildirimi)
- [x] Transfer sonrası bildirim eklendi (outgoing_transfer)
- [x] Email doğrulama sonrası bildirim eklendi (email_verified)
- [x] Users tablosuna `email` alanı eklendi (schema)
- [x] Kullanılmayan worker'lar silindi (transactions, verification)
- [x] TypeScript hataları düzeltildi

---

## Yapılacaklar

### 1. [x] DB Migration Oluştur ✅
**Öncelik:** Yüksek
**Dosya:** `apps/bot/src/db/migrations/0003_medical_cerise.sql`

~~Users tablosuna `email` alanı eklendi ama migration oluşturulmadı.~~

**Yapıldı:** Migration oluşturuldu ve çalıştırıldı.
- `users.email` kolonu eklendi
- `notifications` tablosu oluşturuldu

---

### 2. [x] RESEND_API_KEY'i Opsiyonel Yap (Development) ✅
**Öncelik:** Yüksek
**Dosya:** `apps/bot/src/config/env.ts`

~~Şu an `RESEND_API_KEY` zorunlu. Development'ta email göndermeden çalışabilmeli.~~

**Yapıldı:** API key opsiyonel, key yoksa log'a yazılıyor.

---

### 3. [x] Email Servisinde Latest Code Sorgusu Düzelt ✅
**Öncelik:** Orta
**Dosya:** `apps/bot/src/services/email/index.ts:157`

~~`verifyCode` fonksiyonunda en son kodu almak için `desc()` kullanılmalı.~~

**Yapıldı:** `desc(emailCodes.createdAt)` eklendi.

---

### 4. [x] Welcome Notification'ı Kullan ✅
**Öncelik:** Düşük
**Dosya:** `apps/bot/src/api/handlers/wallet.ts`

~~`notifyWelcome()` tanımlı ama hiçbir yerde çağrılmıyor. Yeni wallet oluşturulduğunda çağrılmalı.~~

**Yapıldı:** Wallet oluşturulduktan sonra `welcome` notification queue'ya ekleniyor.

---

### 5. [x] Unit Testler Ekle ✅
**Öncelik:** Düşük
**Dosyalar:**
- `apps/bot/src/services/email/__tests__/email.test.ts`
- `apps/bot/src/services/notification/__tests__/notification.test.ts`

**Yapıldı:** 21 yeni test eklendi:
- Email service: 11 test (sendCode, verifyCode, isEmailVerified, rate limiting)
- Notification service: 10 test (Telegram notifications, email notifications, job processing)

---

### 6. [x] Güvenli Kod Üretimi ✅
**Öncelik:** Orta

`Math.random()` yerine `crypto.randomInt()` kullanıldı - kriptografik olarak güvenli.

---

### 7. [x] Expired Kodları Temizleme ✅
**Öncelik:** Düşük

- `cleanupExpiredCodes()` metodu eklendi
- Canton Sync job'ında otomatik çalışıyor (her 2 dakikada)
- Süresi geçmiş kodlar DB'den siliniyor

---

## Dosya Değişiklikleri Özeti

| Dosya | Değişiklik |
|-------|------------|
| `apps/bot/package.json` | `resend` eklendi |
| `apps/bot/src/config/env.ts` | `RESEND_API_KEY`, `EMAIL_FROM` eklendi |
| `apps/bot/src/config/constants.ts` | Kullanılmayan queue'lar silindi |
| `apps/bot/src/db/schema.ts` | Users'a `email` alanı eklendi |
| `apps/bot/src/services/email/index.ts` | Resend entegrasyonu, HTML template |
| `apps/bot/src/services/notification/index.ts` | Job types, processJob, email bildirimleri |
| `apps/bot/src/services/transfer/index.ts` | Notification queue'ya ekleme |
| `apps/bot/src/jobs/index.ts` | Worker'lar güncellendi, Canton sync |
| `apps/bot/src/api/routes/email.ts` | Doğrulama sonrası bildirim |
| `apps/bot/src/api/handlers/notifications.ts` | Unused variable düzeltildi |
| `.env.example` | Email env vars eklendi |
