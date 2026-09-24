const DB_KEY = 'audit-bovin-v10-core';
const DRAFT_KEY = 'audit-bovin-v10-draft';
const IDB_NAME = 'audit-bovin-gds-32-65';
const IDB_VERSION = 1;
const IDB_STORE = 'core';
const IDB_MAIN_KEY = 'main';

export function createEmptyDatabase() {
  return { schemaVersion: 1, farms: [], visits: [], updatedAt: new Date().toISOString() };
}

function isQuotaError(error){
  return !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014);
}
function freeLegacyLocalSpace(){
  const removable = ['audit-bovin-v10-backup-before-10-7','audit-bovin-open-details-v35'];
  removable.forEach(k=>{ try{ localStorage.removeItem(k); }catch(_){} });
  try{
    for(let i=localStorage.length-1;i>=0;i--){
      const k=localStorage.key(i)||'';
      if(/^audit-bovin-v10-backup/i.test(k) && k!==DB_KEY) localStorage.removeItem(k);
    }
  }catch(_){}
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return reject(new Error('IndexedDB indisponible'));
    const req=indexedDB.open(IDB_NAME,IDB_VERSION);
    req.onupgradeneeded=()=>{const idb=req.result;if(!idb.objectStoreNames.contains(IDB_STORE))idb.createObjectStore(IDB_STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Ouverture IndexedDB impossible'));
  });
}
async function idbGet(){
  const idb=await openDb();
  try{return await new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readonly');const req=tx.objectStore(IDB_STORE).get(IDB_MAIN_KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
  finally{idb.close();}
}
async function idbPut(db){
  const idb=await openDb();
  try{await new Promise((resolve,reject)=>{const tx=idb.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(db,IDB_MAIN_KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Écriture IndexedDB annulée'));});return true;}
  finally{idb.close();}
}

export async function persistDatabaseDurably(db,{cleanupLegacy=true}={}){
  window.__auditBovinMemoryDb=db;
  try{
    await idbPut(db);
    window.__auditBovinIndexedDbReady=true;
    if(cleanupLegacy){
      try{localStorage.removeItem(DB_KEY);}catch(_){}
      freeLegacyLocalSpace();
    }
    return {persisted:true,backend:'indexeddb'};
  }catch(error){
    console.warn('IndexedDB indisponible, tentative de sauvegarde locale de secours.',error);
    const raw=JSON.stringify(db);
    try{localStorage.setItem(DB_KEY,raw);return {persisted:true,backend:'localstorage',fallback:true};}
    catch(error2){
      if(isQuotaError(error2))freeLegacyLocalSpace();
      try{localStorage.setItem(DB_KEY,raw);return {persisted:true,backend:'localstorage',fallback:true,recovered:true};}
      catch(error3){window.__auditBovinMemoryDb=db;return {persisted:false,quota:isQuotaError(error3),error:error3};}
    }
  }
}

export async function loadDatabase() {
  if(window.__auditBovinMemoryDb) return window.__auditBovinMemoryDb;
  let idbValue=null;
  try{idbValue=await idbGet();}catch(error){console.warn('Lecture IndexedDB indisponible',error);}
  let legacy=null;
  try{const raw=localStorage.getItem(DB_KEY);if(raw)legacy=JSON.parse(raw);}catch(error){console.warn('Lecture ancienne base locale impossible',error);}
  let selected=idbValue||legacy||createEmptyDatabase();
  if(idbValue&&legacy){
    const ti=Date.parse(idbValue.updatedAt||0)||0,tl=Date.parse(legacy.updatedAt||0)||0;
    selected=tl>ti?legacy:idbValue;
  }
  selected={...createEmptyDatabase(),...selected};
  window.__auditBovinMemoryDb=selected;
  // Migration transparente vers IndexedDB. La suppression du gros JSON local libère immédiatement le quota.
  persistDatabaseDurably(selected).catch(()=>{});
  return selected;
}

let persistChain=Promise.resolve();
export function saveDatabase(db) {
  db.updatedAt = new Date().toISOString();
  window.__auditBovinMemoryDb = db;
  // La sauvegarde est sérialisée pour éviter qu'une ancienne écriture asynchrone écrase une plus récente.
  const snapshot=structuredClone ? structuredClone(db) : JSON.parse(JSON.stringify(db));
  persistChain=persistChain.catch(()=>{}).then(()=>persistDatabaseDurably(snapshot));
  window.dispatchEvent(new CustomEvent('audit-bovin-db-saved', { detail: { updatedAt: db.updatedAt, localPersisted:true, durablePending:true } }));
  persistChain.then(result=>{
    window.dispatchEvent(new CustomEvent('audit-bovin-local-persisted',{detail:{updatedAt:snapshot.updatedAt,...result}}));
    if(!result.persisted){window.dispatchEvent(new CustomEvent('audit-bovin-local-quota',{detail:{message:'Sauvegarde locale impossible. Gardez l’application ouverte et synchronisez immédiatement.'}}));}
  }).catch(error=>console.error('Sauvegarde durable',error));
}

export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
  catch { return null; }
}
export function saveDraft(draft) {
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() })); }
  catch(error){ if(isQuotaError(error)) freeLegacyLocalSpace(); }
}
export function clearDraft() { try{localStorage.removeItem(DRAFT_KEY);}catch(_){} }

export async function replaceDatabase(nextDb) {
  const normalized = { ...createEmptyDatabase(), ...nextDb, updatedAt: new Date().toISOString() };
  window.__auditBovinMemoryDb = normalized;
  await persistDatabaseDurably(normalized);
  window.dispatchEvent(new CustomEvent('audit-bovin-db-saved', { detail: { updatedAt: normalized.updatedAt, localPersisted:true } }));
  return normalized;
}

// Pont utilisé par cloud-sync.js (script classique) pour ne plus écrire le gros JSON dans localStorage.
window.__auditBovinPersistDb = persistDatabaseDurably;
window.__auditBovinReplaceDb = replaceDatabase;
