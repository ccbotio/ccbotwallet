const DB_NAME = 'ccbot-wallet';
const STORE_NAME = 'keys';
const DB_VERSION = 2;

interface StoredKey {
  id: string;
  encryptedShare: string;
  iv: string;
  salt: string;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function storeEncryptedShare(
  id: string,
  encryptedShare: string,
  iv: string,
  salt: string
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const data: StoredKey = {
      id,
      encryptedShare,
      iv,
      salt,
      createdAt: Date.now(),
    };

    const request = store.put(data);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getEncryptedShare(id: string): Promise<StoredKey | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export async function deleteEncryptedShare(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const request = store.delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function hasStoredShare(id: string): Promise<boolean> {
  const share = await getEncryptedShare(id);
  return share !== null;
}

// PIN verification storage
const PIN_CHECK_VALUE = 'CCBOT_PIN_VERIFIED';
const PIN_STORE_NAME = 'pin';

function openPinDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Increment version for new store

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PIN_STORE_NAME)) {
        db.createObjectStore(PIN_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export interface StoredPin {
  id: string;
  encryptedCheck: string;
  iv: string;
  salt: string;
  createdAt: number;
}

export async function storePinCheck(
  id: string,
  encryptedCheck: string,
  iv: string,
  salt: string
): Promise<void> {
  const db = await openPinDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PIN_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PIN_STORE_NAME);

    const data: StoredPin = {
      id,
      encryptedCheck,
      iv,
      salt,
      createdAt: Date.now(),
    };

    const request = store.put(data);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getPinCheck(id: string): Promise<StoredPin | null> {
  const db = await openPinDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PIN_STORE_NAME, 'readonly');
    const store = tx.objectStore(PIN_STORE_NAME);

    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export async function hasPinSet(id: string): Promise<boolean> {
  try {
    const pin = await getPinCheck(id);
    return pin !== null;
  } catch {
    return false;
  }
}

export { PIN_CHECK_VALUE };
