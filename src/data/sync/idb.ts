"use client";
// One value per signed-in person in IndexedDB (localStorage is too small for a year of activities).
// Every function resolves quietly when IndexedDB is missing or refuses: the engine then runs from memory.
const DB = "clink-sync", STORE = "state";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(request ? request.result : null); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export const idbGet = <T,>(key: string): Promise<T | null> => run<T>("readonly", (s) => s.get(key) as IDBRequest<T>);
export const idbSet = (key: string, value: unknown): Promise<unknown> => run("readwrite", (s) => s.put(value, key));
export const idbClear = (): Promise<unknown> => run("readwrite", (s) => s.clear());
