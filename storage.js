const DB_KEY = 'audit-bovin-v10-core';
const DRAFT_KEY = 'audit-bovin-v10-draft';

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
function writeCoreDb(db){
  const raw=JSON.stringify(db);
  try{
    localStorage.setItem(DB_KEY, raw);
    return {persisted:true};
  }catch(error){
    if(!isQuotaError(error)) throw error;
    freeLegacyLocalSpace();
    try{
      localStorage.setItem(DB_KEY, raw);
      return {persisted:true, recovered:true};
    }catch(error2){
      window.__auditBovinMemoryDb = db;
      console.error('Stockage local saturé : base gardée en mémoire en attendant la synchro cloud.', error2);
      return {persisted:false, quota:true, error:error2};
    }
  }
}

export function loadDatabase() {
  try {
    if(window.__auditBovinMemoryDb) return window.__auditBovinMemoryDb;
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return createEmptyDatabase();
    const parsed = JSON.parse(raw);
    window.__auditBovinMemoryDb = parsed;
    return { ...createEmptyDatabase(), ...parsed };
  } catch (error) {
    console.error('Impossible de charger la base locale', error);
    return createEmptyDatabase();
  }
}

export function saveDatabase(db) {
  db.updatedAt = new Date().toISOString();
  window.__auditBovinMemoryDb = db;
  const result=writeCoreDb(db);
  window.dispatchEvent(new CustomEvent('audit-bovin-db-saved', { detail: { updatedAt: db.updatedAt, localPersisted:result.persisted, quota:!!result.quota } }));
  if(result.quota){
    window.dispatchEvent(new CustomEvent('audit-bovin-local-quota', {detail:{message:'Stockage local saturé : la saisie reste active et sera envoyée au cloud dès que possible.'}}));
  }
}

export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
  catch { return null; }
}

export function saveDraft(draft) {
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() })); }
  catch(error){ if(isQuotaError(error)) freeLegacyLocalSpace(); }
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export function replaceDatabase(nextDb) {
  const normalized = { ...createEmptyDatabase(), ...nextDb, updatedAt: new Date().toISOString() };
  window.__auditBovinMemoryDb = normalized;
  writeCoreDb(normalized);
  window.dispatchEvent(new CustomEvent('audit-bovin-db-saved', { detail: { updatedAt: normalized.updatedAt } }));
  return normalized;
}
