"use strict";
const SceneDB = {
  open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("reader-scenes", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("images");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  async run(mode, key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", mode);
      const store = tx.objectStore("images");
      const r =
        value === undefined
          ? store.get(key)
          : value === null
            ? store.delete(key)
            : store.put(value, key);
      let result;
      r.onsuccess = () => {
        result = r.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  },
};
