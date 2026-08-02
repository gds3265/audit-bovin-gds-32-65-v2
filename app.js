import { loadDatabase, saveDatabase, loadDraft, saveDraft, clearDraft, replaceDatabase } from './storage.js';
import { uid, formatDate, formatDateTime, escapeHtml, downloadJson, slugify } from './utils.js';
import { THRESHOLDS, CATEGORY_RULE_MAP } from './analysis-rules.js';

let db = loadDatabase();
let currentView = 'dashboard';
let editingVisitId = null;
let activeVisitId = localStorage.getItem('audit-bovin-active-visit') || localStorage.getItem('audit-bovin-active-visit') || localStorage.getItem('audit-bovin-active-visit') || '';
let openSubjectId = null;
let activeAnalysisSection = localStorage.getItem('audit-bovin-active-analysis-section') || 'numeric';
let activeAnalysisFamily = localStorage.getItem('audit-bovin-active-analysis-family') || 'Urines';
let activeGeneralKind = localStorage.getItem('audit-bovin-active-general-kind') || 'tamis';
let focusedAnalysisSubjectId = localStorage.getItem('audit-bovin-focused-analysis-subject') || '';
const app = document.getElementById('app');
const fileInput = document.getElementById('json-file-input');

const visitTypes = ['Bilan 5MVet', 'Audit complet', 'Visite métabolique', 'Audit bâtiment', 'Audit alimentation', 'Audit sanitaire', 'Audit vêlage', 'Audit veaux', 'Suivi', 'Autre'];
const categories = ['Non classé', 'Veau 0–15 jours', 'Veau 15–60 jours', 'Génisse', 'Engraissement', 'Préparation vêlage', 'Tarie', 'Fraîche vêlée', 'Début lactation', 'Pic de lactation', 'Milieu lactation', 'Fin lactation', 'Vache allaitante', 'Autre'];
const physiologicalStages = ['Non renseigné', 'Vide', 'Synchronisation des chaleurs', 'Pleine', 'Lactation'];
const feedingCategories = ['Veaux', 'Génisses', 'Engraissement', 'Vaches en production', 'Préparation vêlage', 'Vaches taries', 'Vaches allaitantes', 'Taureaux', 'Autre'];
const feedTypes = ['Ensilage', 'Enrubanné', 'Foin', 'Regain', 'Paille', 'Concentré', 'Correcteur', 'Minéral', 'Sel', 'Bicarbonate', 'Levures', 'Mélasse / sucre', 'Autre'];
const feedUnits = ['kg brut/j', 'kg MS/j', 'g/j', 'L/j', 'À volonté', 'Autre'];
const distributionModes = ['Mélangeuse', 'Désileuse', 'Râtelier', 'Cornadis', 'DAC', 'Robot', 'Libre-service', 'Manuel', 'Pâturage', 'Autre'];
const buildingTypes = ['Stabulation libre', 'Stabulation entravée', 'Aire paillée', 'Logettes', 'Nurserie', 'Bâtiment veaux', 'Bâtiment engraissement', 'Mixte', 'Autre'];
const buildingOrientations = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest', 'Non renseignée'];
const ventilationTypes = ['Naturelle', 'Mécanique', 'Mixte', 'Non renseignée'];
const drinkerTypes = ['Bac collectif', 'Bol individuel', 'Abreuvoir à niveau constant', 'Abreuvoir à palette', 'Abreuvoir à pipette', 'Abreuvoir chauffant', 'Autre'];
const drinkerMaterials = ['Inox', 'Plastique', 'Béton', 'Fonte', 'Acier galvanisé', 'Résine / composite', 'Autre'];
const waterOrigins = ['Réseau', 'Source', 'Forage', 'Puits', 'Eau de pluie', 'Mixte', 'Autre'];
const litterTypes = ['Paille', 'Sciure', 'Copeaux', 'Sable', 'Matelas', 'Compost', 'Mixte', 'Autre'];
const buildingQuestionGroups = [
  ['Eau et abreuvement', ['Accès à l’eau suffisant pour tous les animaux', 'Nombre de points d’eau adapté', 'Débit satisfaisant', 'Hauteur adaptée', 'Abreuvoirs propres', 'Absence de concurrence excessive']],
  ['Couchage et litière', ['Surface de couchage suffisante', 'Litière sèche et confortable', 'Paillage régulier', 'Curage adapté', 'Absence de zones glissantes', 'Absence de blessures liées au couchage']],
  ['Ventilation et ambiance', ['Entrées d’air suffisantes', 'Sorties d’air efficaces', 'Absence de condensation', 'Absence d’odeur forte d’ammoniac', 'Luminosité suffisante', 'Absence de courants d’air directs sur les animaux']],
  ['Circulation et sécurité', ['Circulation fluide des animaux', 'Sols en bon état', 'Barrières et cornadis sécurisés', 'Absence de points dangereux', 'Zone d’isolement disponible', 'Accès facile pour les soins']],
  ['Veaux et mise bas', ['Cases de vêlage propres', 'Zone veaux adaptée', 'Séparation des malades possible', 'Nettoyage et désinfection organisés', 'Matériel de soins disponible']],
  ['Hygiène et biosécurité', ['Gestion des nuisibles', 'Stockage des aliments protégé', 'Nettoyage du matériel', 'Gestion des cadavres', 'Accès visiteurs maîtrisé']]
];
const measurementFamilies = [
  ['urine', 'Urines', '🟡'], ['blood', 'Sang', '🔴'], ['feces', 'Bouses', '🟤'],
  ['physical', 'Observations physiques', '🟢'], ['milk', 'Lait', '🔵'], ['colostrum', 'Colostrum', '🟣']
];

function migrateDatabase() {
  // Conserver une copie locale avant toute normalisation de structure.
  try {
    if (!localStorage.getItem('audit-bovin-v10-backup-before-10-7')) {
      localStorage.setItem('audit-bovin-v10-backup-before-10-7', JSON.stringify(db));
    }
  } catch (error) { console.warn('Sauvegarde de sécurité impossible', error); }

  const legacyKeys = ['nec','urineColor','urinePH','urineRedox','urineBrix','urineDensity','glucose','boh','bloodPH','urea','fecesPH','fecesRedox','milkPH','milkBrix','colostrumBrix','colostrumDensity','colostrumPH'];
  db.farms = Array.isArray(db.farms) ? db.farms : [];
  db.visits = Array.isArray(db.visits) ? db.visits : [];
  db.visits.forEach(visit => {
    visit.subjects = Array.isArray(visit.subjects) ? visit.subjects : [];
    visit.subjects.forEach(subject => {
      subject.measurements = subject.measurements && typeof subject.measurements === 'object' ? subject.measurements : {};
      const current = subject.measurements.analysis && typeof subject.measurements.analysis === 'object' ? subject.measurements.analysis : {};
      const candidates = [
        subject.analysis,
        subject.measurements.numeric,
        subject.measurements.values,
        subject.measurements,
        visit.analysisBySubject?.[subject.id],
        ...(Array.isArray(visit.analysisRecords) ? visit.analysisRecords.filter(r => [r.subjectId,r.animalId,r.id].includes(subject.id)).map(r => r.measurements || r.values || r) : [])
      ].filter(x => x && typeof x === 'object');
      candidates.forEach(source => legacyKeys.forEach(key => {
        if ((current[key] === undefined || current[key] === null || current[key] === '') && source[key] !== undefined && source[key] !== null && source[key] !== '') current[key] = source[key];
      }));
      subject.measurements.analysis = current;
      subject.measurements.observations = subject.measurements.observations && typeof subject.measurements.observations === 'object' ? subject.measurements.observations : {};
      subject.measurements.comments = subject.measurements.comments && typeof subject.measurements.comments === 'object' ? subject.measurements.comments : {};
    });
    visit.feeding = visit.feeding && typeof visit.feeding === 'object' ? visit.feeding : {};
    visit.feeding.rations = Array.isArray(visit.feeding.rations) ? visit.feeding.rations : [];
    visit.feeding.settings = visit.feeding.settings && typeof visit.feeding.settings === 'object' ? visit.feeding.settings : {};
    visit.feeding.history = Array.isArray(visit.feeding.history) ? visit.feeding.history : [];
    visit.buildingAudits = visit.buildingAudits && typeof visit.buildingAudits === 'object' ? visit.buildingAudits : {};
  });
  db.farms.forEach(farm => {
    farm.buildings = Array.isArray(farm.buildings) ? farm.buildings : [];
    farm.buildings.forEach(building => {
      building.plan = building.plan && typeof building.plan === 'object' ? building.plan : { shapes: [] };
      building.plan.shapes = Array.isArray(building.plan.shapes) ? building.plan.shapes : [];
    });
  });
  if (activeVisitId && !db.visits.some(v => v.id === activeVisitId)) setActiveVisit('');
  saveDatabase(db);
}
migrateDatabase();

function showToast(message) {
  const node = document.getElementById('toast-template').content.firstElementChild.cloneNode(true);
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function addJournal(visit, message) {
  visit.journal = Array.isArray(visit.journal) ? visit.journal : [];
  visit.journal.unshift({ at: new Date().toISOString(), message });
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  render();
  app.focus({ preventScroll: true });
}

document.querySelector('.top-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});

function farmName(farmId) {
  return db.farms.find(farm => farm.id === farmId)?.name || 'Exploitation non renseignée';
}

function visitLabel(visit) {
  return `${farmName(visit.farmId)} — ${formatDate(visit.date)} — ${visit.type || 'Visite'}`;
}

function setActiveVisit(id) {
  activeVisitId = id || '';
  if (activeVisitId) localStorage.setItem('audit-bovin-active-visit', activeVisitId);
  else localStorage.removeItem('audit-bovin-active-visit');
}
function activeVisit() { return db.visits.find(v => v.id === activeVisitId) || null; }
function activeVisitBanner(visit) {
  if (!visit) return `<section class="card notice warning"><strong>Aucune visite active.</strong><br><span class="muted">Choisissez une visite dans l’onglet Visites.</span></section>`;
  return `<section class="card active-visit-banner"><div><span class="muted">Visite active — verrouillée pour la saisie</span><strong>${escapeHtml(visitLabel(visit))}</strong></div><span class="badge complete">${visit.subjects?.length || 0} sujet(s)</span><span class="muted small-text">La visite ne peut être changée que depuis l’onglet Visites.</span></section>`;
}

function render() {
  const renderers = { dashboard: renderDashboard, farms: renderFarms, visits: renderVisits, animals: renderAnimals, analysis: renderAnalysis, feeding: renderFeeding, building: renderBuilding, backup: renderBackup };
  app.innerHTML = '';
  renderers[currentView]?.();
}

function renderDashboard() {
  const inProgress = db.visits.filter(v => v.status === 'in-progress');
  const complete = db.visits.filter(v => v.status === 'complete');
  const subjectCount = db.visits.reduce((sum, visit) => sum + (visit.subjects?.length || 0), 0);
  const draft = loadDraft();
  app.innerHTML = `
    <section class="grid cols-4">
      <article class="card"><div class="muted">Exploitations</div><div class="metric">${db.farms.length}</div></article>
      <article class="card"><div class="muted">Visites en cours</div><div class="metric">${inProgress.length}</div></article>
      <article class="card"><div class="muted">Visites terminées</div><div class="metric">${complete.length}</div></article>
      <article class="card"><div class="muted">Sujets enregistrés</div><div class="metric">${subjectCount}</div></article>
    </section>
    ${draft ? `<section class="card notice warning" style="margin-top:16px"><strong>Une saisie non finalisée a été retrouvée.</strong><div class="actions" style="margin-top:10px"><button class="btn primary" id="resume-draft">Reprendre la saisie</button><button class="btn secondary" id="discard-draft">Ignorer</button></div></section>` : ''}
    <section class="grid cols-2" style="margin-top:16px">
      <article class="card">
        <h2>Commencer</h2>
        <p class="muted">Les données sont enregistrées automatiquement. Créez une visite, puis ajoutez les sujets dans l’onglet Animaux.</p>
        <div class="actions"><button class="btn primary" id="new-farm">Nouvelle exploitation</button><button class="btn" id="new-visit">Nouvelle visite</button><button class="btn" id="open-animals">Ouvrir les animaux</button></div>
      </article>
      <article class="card">
        <h2>Dernières visites</h2>
        ${db.visits.length ? `<ul class="journal">${db.visits.slice().sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5).map(v => `<li><strong>${escapeHtml(farmName(v.farmId))}</strong> — ${formatDate(v.date)}<br><span class="muted">${escapeHtml(v.type || 'Visite')} · ${v.subjects?.length || 0} sujet(s) · ${escapeHtml(v.status === 'complete' ? 'Terminée' : 'En cours')}</span></li>`).join('')}</ul>` : '<div class="empty">Aucune visite enregistrée.</div>'}
      </article>
    </section>`;

  document.getElementById('new-farm').onclick = () => { setView('farms'); setTimeout(() => document.getElementById('farm-name')?.focus(), 0); };
  document.getElementById('new-visit').onclick = () => { setView('visits'); setTimeout(() => document.getElementById('visit-farm')?.focus(), 0); };
  document.getElementById('open-animals').onclick = () => setView('animals');
  document.getElementById('resume-draft')?.addEventListener('click', () => { setView(draft.kind === 'farm' ? 'farms' : 'visits'); });
  document.getElementById('discard-draft')?.addEventListener('click', () => { clearDraft(); renderDashboard(); });
}

function renderFarms() {
  const draft = loadDraft();
  const farmDraft = draft?.kind === 'farm' ? draft.data : {};
  app.innerHTML = `
    <div class="section-title"><h2>Exploitations</h2><span class="muted">${db.farms.length} exploitation(s)</span></div>
    <section class="grid cols-2">
      <form id="farm-form" class="card">
        <h3>Ajouter une exploitation</h3>
        <div class="field"><label for="farm-name">Nom de l’exploitation *</label><input id="farm-name" name="name" required value="${escapeHtml(farmDraft.name || '')}" /></div>
        <div class="row"><div class="field"><label>Éleveur</label><input name="farmer" value="${escapeHtml(farmDraft.farmer || '')}" /></div><div class="field"><label>Commune</label><input name="commune" value="${escapeHtml(farmDraft.commune || '')}" /></div></div>
        <div class="row"><div class="field"><label>Téléphone</label><input name="phone" inputmode="tel" value="${escapeHtml(farmDraft.phone || '')}" /></div><div class="field"><label>Courriel</label><input name="email" type="email" value="${escapeHtml(farmDraft.email || '')}" /></div></div>
        <div class="field"><label>Informations permanentes</label><textarea name="notes">${escapeHtml(farmDraft.notes || '')}</textarea></div>
        <button class="btn primary" type="submit">Ajouter l’exploitation</button>
      </form>
      <section class="card">
        <h3>Liste des exploitations</h3>
        ${db.farms.length ? `<div class="table-wrap"><table><thead><tr><th>Exploitation</th><th>Commune</th><th>Visites</th><th></th></tr></thead><tbody>${db.farms.map(f => `<tr><td><strong>${escapeHtml(f.name)}</strong><br><span class="muted">${escapeHtml(f.farmer || '')}</span></td><td>${escapeHtml(f.commune || '—')}</td><td>${db.visits.filter(v => v.farmId === f.id).length}</td><td><button class="btn small danger" data-delete-farm="${f.id}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune exploitation.</div>'}
      </section>
    </section>`;
  const form = document.getElementById('farm-form');
  form.addEventListener('input', () => saveDraft({ kind: 'farm', data: Object.fromEntries(new FormData(form)) }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim()) return;
    db.farms.push({ id: uid('farm'), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    saveDatabase(db); clearDraft(); showToast('Exploitation ajoutée.'); renderFarms();
  });
  app.querySelectorAll('[data-delete-farm]').forEach(button => button.onclick = () => {
    const id = button.dataset.deleteFarm;
    if (db.visits.some(v => v.farmId === id)) return showToast('Suppression impossible : cette exploitation possède des visites.');
    if (confirm('Supprimer cette exploitation ?')) { db.farms = db.farms.filter(f => f.id !== id); saveDatabase(db); renderFarms(); }
  });
}

function visitFormHtml(visit = {}) {
  const draft = loadDraft();
  const visitDraft = draft?.kind === 'visit' ? draft.data : {};
  const data = { ...visitDraft, ...visit };
  return `<form id="visit-form" class="card">
    <h3>${visit.id ? 'Modifier la visite' : 'Nouvelle visite'}</h3>
    ${!db.farms.length ? '<div class="notice warning">Ajoutez d’abord une exploitation.</div>' : ''}
    <div class="field"><label for="visit-farm">Exploitation *</label><select id="visit-farm" name="farmId" required><option value="">Sélectionner…</option>${db.farms.map(f => `<option value="${f.id}" ${data.farmId===f.id?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}</select></div>
    <div class="row"><div class="field"><label>Date *</label><input name="date" type="date" required value="${escapeHtml(data.date || new Date().toISOString().slice(0,10))}" /></div><div class="field"><label>Technicien</label><input name="technician" value="${escapeHtml(data.technician || '')}" /></div></div>
    <div class="field"><label>Type de visite</label><select name="type">${visitTypes.map(type => `<option ${data.type===type?'selected':''}>${type}</option>`).join('')}</select></div>
    <div class="field"><label>Objectif / attentes</label><textarea name="objective">${escapeHtml(data.objective || '')}</textarea></div>
    <div class="field"><label>Statut</label><select name="status"><option value="in-progress" ${data.status!=='complete'?'selected':''}>En cours</option><option value="complete" ${data.status==='complete'?'selected':''}>Terminée</option></select></div>
    <div class="actions"><button class="btn primary" type="submit">${visit.id ? 'Mettre à jour' : 'Créer la visite'}</button>${visit.id ? '<button type="button" class="btn secondary" id="cancel-edit">Annuler</button>' : ''}</div>
  </form>`;
}

function renderVisits() {
  const editVisit = editingVisitId ? db.visits.find(v => v.id === editingVisitId) : null;
  app.innerHTML = `
    <div class="section-title"><h2>Visites</h2><span class="muted">Sauvegarde automatique active</span></div>
    <section class="grid cols-2">
      ${visitFormHtml(editVisit || {})}
      <section class="card">
        <h3>Historique</h3>
        ${db.visits.length ? `<div class="table-wrap"><table><thead><tr><th>Exploitation</th><th>Date</th><th>Type</th><th>Sujets</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${db.visits.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(v => `<tr><td><strong>${escapeHtml(farmName(v.farmId))}</strong><br><span class="muted">${escapeHtml(v.technician || '')}</span></td><td>${formatDate(v.date)}</td><td>${escapeHtml(v.type || '—')}</td><td>${v.subjects?.length || 0}</td><td><span class="badge ${v.status==='complete'?'complete':'in-progress'}">${v.status==='complete'?'Terminée':'En cours'}</span></td><td><div class="actions"><button class="btn small" data-edit-visit="${v.id}">Ouvrir</button><button class="btn small" data-open-animals="${v.id}">Animaux</button><button class="btn small" data-export-visit="${v.id}">JSON</button><button class="btn small danger" data-delete-visit="${v.id}">Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune visite.</div>'}
      </section>
    </section>
    ${editVisit ? `<section class="card" style="margin-top:16px"><h3>Journal de la visite</h3>${editVisit.journal?.length ? `<ul class="journal">${editVisit.journal.map(j => `<li><strong>${formatDateTime(j.at)}</strong><br>${escapeHtml(j.message)}</li>`).join('')}</ul>` : '<div class="empty">Aucune modification enregistrée.</div>'}</section>` : ''}`;

  const form = document.getElementById('visit-form');
  form.addEventListener('input', () => saveDraft({ kind: 'visit', data: Object.fromEntries(new FormData(form)) }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.farmId || !data.date) return showToast('Exploitation et date obligatoires.');
    if (editVisit) {
      Object.assign(editVisit, data, { updatedAt: new Date().toISOString() });
      addJournal(editVisit, 'Informations générales mises à jour.');
      showToast('Visite mise à jour.');
    } else {
      const visit = { id: uid('visit'), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), journal: [], subjects: [] };
      addJournal(visit, 'Visite créée.');
      db.visits.push(visit);
      setActiveVisit(visit.id);
      showToast('Visite créée.');
    }
    saveDatabase(db); clearDraft(); editingVisitId = null; renderVisits();
  });
  document.getElementById('cancel-edit')?.addEventListener('click', () => { editingVisitId = null; clearDraft(); renderVisits(); });
  app.querySelectorAll('[data-edit-visit]').forEach(button => button.onclick = () => { setActiveVisit(button.dataset.editVisit); editingVisitId = button.dataset.editVisit; clearDraft(); renderVisits(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  app.querySelectorAll('[data-open-animals]').forEach(button => button.onclick = () => {
    setActiveVisit(button.dataset.openAnimals);
    setView('animals');
  });
  app.querySelectorAll('[data-export-visit]').forEach(button => button.onclick = () => {
    const visit = db.visits.find(v => v.id === button.dataset.exportVisit);
    downloadJson(`${slugify(farmName(visit.farmId))}-${visit.date || 'visite'}.json`, { schemaVersion: 2, farm: db.farms.find(f => f.id === visit.farmId), visit });
  });
  app.querySelectorAll('[data-delete-visit]').forEach(button => button.onclick = () => {
    if (confirm('Supprimer cette visite et tous ses sujets ?')) {
      db.visits = db.visits.filter(v => v.id !== button.dataset.deleteVisit);
      if (activeVisitId === button.dataset.deleteVisit) setActiveVisit('');
      saveDatabase(db); renderVisits();
    }
  });
}

function classificationCompleteness(subject) {
  const fields = [subject.category, subject.stage, subject.age, subject.rank, subject.lot];
  return fields.filter(value => value && !['Non classé', 'Non renseigné'].includes(value)).length;
}

function measurementStatus(subject, key) {
  const analysis = subject.measurements?.analysis || {};
  const observations = subject.measurements?.observations || {};
  const familyKeys = {
    urine: ['urineColor','urinePH','urineRedox','urineBrix','urineDensity'],
    blood: ['glucose','boh','bloodPH','urea'],
    feces: ['fecesPH','fecesRedox'],
    physical: ['nec'],
    milk: ['milkPH','milkBrix'],
    colostrum: ['colostrumBrix','colostrumDensity','colostrumPH']
  };
  const obsKeys = { feces:['fecesAspect'], physical:['muscles','coat','limbs','locomotion','rumenFill','temperature'] };
  const values = [...(familyKeys[key] || []).map(k => analysis[k]), ...(obsKeys[key] || []).map(k => observations[k])];
  const filled = values.filter(v => Array.isArray(v) ? v.length : v !== '' && v !== null && v !== undefined).length;
  if (!filled) return 'none';
  return filled >= Math.max(1, Math.ceil(values.length * 0.6)) ? 'complete' : 'partial';
}

function subjectCardHtml(subject, index) {
  const isOpen = openSubjectId === subject.id;
  const category = subject.category || 'Non classé';
  const stageDetail = subject.stage === 'Pleine' && subject.gestationMonths ? `${subject.gestationMonths} mois` : subject.stage === 'Lactation' && subject.lactationDays ? `${subject.lactationDays} JEL` : subject.stage || 'Non renseigné';
  return `<article class="subject-card ${isOpen ? 'open' : ''}" data-subject-card="${subject.id}">
    <button type="button" class="subject-summary" data-toggle-subject="${subject.id}" aria-expanded="${isOpen}">
      <span class="subject-number">${index + 1}</span>
      <span class="subject-main"><strong>${escapeHtml(subject.tag || `Sujet ${index + 1}`)}</strong><small>${escapeHtml(subject.location || 'Emplacement non renseigné')}</small></span>
      <span class="subject-class"><span class="badge ${category === 'Non classé' ? 'unclassified' : 'complete'}">${escapeHtml(category)}</span><small>${escapeHtml(stageDetail)}</small></span>
      <span class="chevron">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen ? subjectDetailsHtml(subject) : ''}
  </article>`;
}

function subjectDetailsHtml(subject) {
  return `<form class="subject-details" data-subject-form="${subject.id}">
    <div class="grid cols-2">
      <section>
        <h4>Identification</h4>
        <div class="row"><div class="field"><label>Numéro de boucle / repère</label><input name="tag" value="${escapeHtml(subject.tag || '')}" required /></div><div class="field"><label>Nom (facultatif)</label><input name="name" value="${escapeHtml(subject.name || '')}" /></div></div>
        <div class="field"><label>Emplacement</label><input name="location" value="${escapeHtml(subject.location || '')}" placeholder="Ex. 2e place, 3e travée" /></div>
        <div class="field"><label>Observation d’identification</label><textarea name="notes" placeholder="Ex. corne cassée, robe particulière…">${escapeHtml(subject.notes || '')}</textarea></div>
      </section>
      <section>
        <h4>Classement</h4>
        <div class="field"><label>Catégorie</label><select name="category">${categories.map(value => `<option ${subject.category === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div class="field"><label>Stade physiologique</label><select name="stage">${physiologicalStages.map(value => `<option ${subject.stage === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div class="row"><div class="field"><label>Mois de gestation</label><input name="gestationMonths" type="number" min="1" max="9" inputmode="numeric" value="${escapeHtml(subject.gestationMonths || '')}" /></div><div class="field"><label>Jours en lactation</label><input name="lactationDays" type="number" min="0" inputmode="numeric" value="${escapeHtml(subject.lactationDays || '')}" /></div></div>
        <div class="row"><div class="field"><label>Âge</label><input name="age" value="${escapeHtml(subject.age || '')}" placeholder="Ex. 4 ans" /></div><div class="field"><label>Rang</label><input name="rank" type="number" min="0" inputmode="numeric" value="${escapeHtml(subject.rank || '')}" /></div></div>
        <div class="field"><label>Lot</label><input name="lot" value="${escapeHtml(subject.lot || '')}" /></div>
      </section>
    </div>
    <section class="measurement-overview"><h4>Suivi des mesures</h4><div class="measure-chips">${measurementFamilies.map(([key,label,icon]) => { const status = measurementStatus(subject,key); return `<button type="button" class="measure-chip ${status}" data-open-measure="${key}" data-subject-id="${subject.id}">${icon} ${label}<small>${status === 'complete' ? 'Fait' : status === 'partial' ? 'Partiel' : 'Non réalisé'}</small></button>`; }).join('')}</div><p class="muted small-text">Cliquez sur une famille pour ouvrir directement sa matrice et la ligne de cet animal.</p></section>
    <div class="actions subject-actions"><span class="autosave-indicator">✓ Enregistrement automatique</span><button type="button" class="btn danger" data-delete-subject="${subject.id}">Supprimer le sujet</button></div>
  </form>`;
}

function renderAnimals() {
  const visits = db.visits.slice().sort((a,b) => (b.date || '').localeCompare(a.date || ''));
  if (!activeVisitId && visits.length) setActiveVisit(visits[0].id);
  const visit = activeVisit();
  app.innerHTML = `
    <div class="section-title"><div><h2>Animaux / sujets de la visite</h2><div class="muted">Saisir d’abord le numéro de boucle et l’emplacement. Le classement peut être complété plus tard.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
    ${activeVisitBanner(visit)}
    ${!visit ? `<section class="empty" style="margin-top:16px">Créez ou sélectionnez une visite avant d’ajouter des sujets.</section>` : `
      <section class="grid cols-2 animal-workspace" style="margin-top:16px">
        <form id="quick-subject-form" class="card quick-subject-form">
          <h3>Ajouter un sujet</h3>
          <p class="muted">Seuls le numéro de boucle et l’emplacement sont nécessaires au départ.</p>
          <div class="field"><label for="subject-tag">Numéro de boucle / repère *</label><input id="subject-tag" name="tag" required autocomplete="off" placeholder="Ex. FR6501234567" /></div>
          <div class="field"><label for="subject-location">Emplacement</label><input id="subject-location" name="location" autocomplete="off" placeholder="Ex. 2e place, 3e travée" /></div>
          <button type="submit" class="btn primary">Ajouter le sujet</button>
        </form>
        <article class="card">
          <h3>Avancement du classement</h3>
          ${visit.subjects?.length ? `<div class="progress-list">${visit.subjects.map(s => `<div><span>${escapeHtml(s.tag || 'Sujet')}</span><div class="progress-track"><div style="width:${classificationCompleteness(s) / 5 * 100}%"></div></div><small>${classificationCompleteness(s)}/5 informations</small></div>`).join('')}</div>` : '<div class="empty">Aucun sujet pour cette visite.</div>'}
        </article>
      </section>
      <section style="margin-top:16px">
        <div class="section-title"><h3>Liste des sujets</h3><span class="muted">Cliquez sur une fiche pour la compléter</span></div>
        <div class="subject-list">${visit.subjects?.length ? visit.subjects.map(subjectCardHtml).join('') : '<div class="empty">Aucun sujet. Ajoutez le premier animal avec le formulaire ci-dessus.</div>'}</div>
      </section>`}`;


  const quickForm = document.getElementById('quick-subject-form');
  quickForm?.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(quickForm));
    const tag = data.tag.trim();
    if (!tag) return showToast('Le numéro de boucle ou le repère est obligatoire.');
    if (visit.subjects.some(subject => subject.tag?.trim().toLowerCase() === tag.toLowerCase())) return showToast('Ce numéro est déjà présent dans la visite.');
    const subject = {
      id: uid('subject'), tag, location: data.location.trim(), name: '', category: 'Non classé', stage: 'Non renseigné',
      gestationMonths: '', lactationDays: '', age: '', rank: '', lot: '', notes: '', measurements: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    visit.subjects.push(subject);
    visit.updatedAt = new Date().toISOString();
    addJournal(visit, `Sujet ajouté : ${tag}.`);
    saveDatabase(db);
    openSubjectId = subject.id;
    showToast('Sujet ajouté et enregistré.');
    renderAnimals();
    setTimeout(() => document.querySelector(`[data-subject-card="${subject.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  });

  app.querySelectorAll('[data-toggle-subject]').forEach(button => button.addEventListener('click', () => {
    openSubjectId = openSubjectId === button.dataset.toggleSubject ? null : button.dataset.toggleSubject;
    renderAnimals();
    if (openSubjectId) setTimeout(() => document.querySelector(`[data-subject-card="${openSubjectId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }));

  app.querySelectorAll('[data-subject-form]').forEach(form => {
    const subject = visit.subjects.find(item => item.id === form.dataset.subjectForm);
    const autosave = () => {
      const values = Object.fromEntries(new FormData(form));
      Object.assign(subject, values, { updatedAt: new Date().toISOString() });
      visit.updatedAt = new Date().toISOString();
      saveDatabase(db);
      const indicator = form.querySelector('.autosave-indicator');
      if (indicator) { indicator.textContent = '✓ Enregistré'; setTimeout(() => { indicator.textContent = '✓ Enregistrement automatique'; }, 1200); }
      const headerBadge = document.querySelector(`[data-subject-card="${subject.id}"] .subject-class .badge`);
      if (headerBadge) headerBadge.textContent = subject.category || 'Non classé';
    };
    form.addEventListener('input', autosave);
    form.addEventListener('change', autosave);
  });

  app.querySelectorAll('[data-open-measure]').forEach(button => button.addEventListener('click', () => {
    const familyMap = { urine:'Urines', blood:'Sang', feces:'Bouses', physical:'Physique', milk:'Lait', colostrum:'Colostrum' };
    setActiveVisit(visit.id);
    activeAnalysisSection = 'numeric';
    activeAnalysisFamily = familyMap[button.dataset.openMeasure] || 'Urines';
    focusedAnalysisSubjectId = button.dataset.subjectId || '';
    localStorage.setItem('audit-bovin-active-analysis-section', activeAnalysisSection);
    localStorage.setItem('audit-bovin-active-analysis-family', activeAnalysisFamily);
    localStorage.setItem('audit-bovin-focused-analysis-subject', focusedAnalysisSubjectId);
    setView('analysis');
  }));

  app.querySelectorAll('[data-delete-subject]').forEach(button => button.addEventListener('click', () => {
    const subject = visit.subjects.find(item => item.id === button.dataset.deleteSubject);
    if (!subject || !confirm(`Supprimer le sujet ${subject.tag || ''} ?`)) return;
    visit.subjects = visit.subjects.filter(item => item.id !== subject.id);
    visit.updatedAt = new Date().toISOString();
    addJournal(visit, `Sujet supprimé : ${subject.tag || 'sans numéro'}.`);
    saveDatabase(db); openSubjectId = null; showToast('Sujet supprimé.'); renderAnimals();
  }));
}


// V10.4 — Module Analyse complet
const analysisParameters = [
  { key: 'nec', label: 'NEC', short: 'NEC', step: '0.25', group: 'Physique' },
  { key: 'urineColor', label: 'Couleur urine', short: 'Coul.', step: '1', min: '1', max: '5', group: 'Urines' },
  { key: 'urinePH', label: 'pH urine', short: 'pH U', step: '0.01', group: 'Urines' },
  { key: 'urineRedox', label: 'Redox urine', short: 'Redox U', step: '1', group: 'Urines' },
  { key: 'urineBrix', label: 'Brix urine (%)', short: 'Brix U', step: '0.1', group: 'Urines' },
  { key: 'urineDensity', label: 'Densité urine', short: 'Densité', step: '1', group: 'Urines' },
  { key: 'glucose', label: 'Glycémie', short: 'Gly', step: '0.1', group: 'Sang' },
  { key: 'boh', label: 'BOH', short: 'BOH', step: '0.01', group: 'Sang' },
  { key: 'bloodPH', label: 'pH sanguin', short: 'pH S', step: '0.01', group: 'Sang' },
  { key: 'urea', label: 'Urémie', short: 'Urée', step: '0.01', group: 'Sang' },
  { key: 'fecesPH', label: 'pH bouses', short: 'pH B', step: '0.01', group: 'Bouses' },
  { key: 'fecesRedox', label: 'Redox bouses', short: 'Redox B', step: '1', group: 'Bouses' },
  { key: 'milkPH', label: 'pH lait', short: 'pH lait', step: '0.01', group: 'Lait' },
  { key: 'milkBrix', label: 'Brix lait (%)', short: 'Brix lait', step: '0.1', group: 'Lait' },
  { key: 'colostrumBrix', label: 'Brix colostrum (%)', short: 'Brix colo.', step: '0.1', group: 'Colostrum' },
  { key: 'colostrumDensity', label: 'Densité colostrum', short: 'Dens. colo.', step: '1', group: 'Colostrum' },
  { key: 'colostrumPH', label: 'pH colostrum', short: 'pH colo.', step: '0.01', group: 'Colostrum' }
];

const observationFields = [
  { key:'muscles', label:'Muscles', type:'single', options:['--','-','0','+','++'] },
  { key:'coat', label:'Poils', type:'multi', options:['Fins','Soyeux','Piqués','Hirsutes','Pelucheux','Mue','Ternes'] },
  { key:'fecesAspect', label:'Aspect des bouses', type:'multi', options:['Dures','Avec mucus','Collantes','Liquides','Moulées','Molles','Fibres longues','Fibres courtes','Grains','Bulles'] },
  { key:'limbs', label:'Membres', type:'multi', options:['Blessures','Cagneux','Panard','Coudés','Boiterie','Enflammé'] },
  { key:'locomotion', label:'Score locomotion', type:'single', options:['1','2','3'] },
  { key:'rumenFill', label:'Remplissage du rumen', type:'single', options:['1','2','3','4','5'] },
  { key:'temperature', label:'Température (°C)', type:'number', step:'0.1' },
  { key:'notes', label:'Observations', type:'text' }
];

const generalConfigs = {
  tamis: { title:'Tamis à bouses', icon:'🟤', fields:[
    ['date','Date du relevé','date'], ['category','Catégorie','select',['Veaux','Engraissement','Génisses','Vaches en production','Taries','Autre']],
    ['represented','Nombre d’animaux représentés','number'], ['total','Poids total (g)','number'], ['t1','Tamis 1 — 5 mm (g)','number'], ['t2','Tamis 2 — 2 mm (g)','number'], ['comment','Commentaire','text']
  ]},
  silos: { title:'Silos / ensilages', icon:'🌽', fields:[
    ['date','Date du relevé','date'], ['name','Nom / repère','text'], ['type','Type','select',['Ensilage maïs','Ensilage herbe','Méteil','Silo couloir','Silo boudin','Autre']], ['ph','pH','number'], ['redox','Redox','number'], ['dm','MS (%)','number'],
    ['earing','Stade','select',['Épié','Non épié','Non renseigné']], ['mowTime','Heure de fauche','time'], ['mowHeight','Hauteur de fauche (cm)','number'],
    ['conditioned','Conditionnement','select',['Conditionné','Non conditionné','Non renseigné']], ['preservative','Conservateur','text'], ['doubleCover','Bâchage','select',['Double bâche','Bâche simple','Autre']], ['comment','Réalisation / stockage / distribution','text']
  ]},
  soils: { title:'Sol', icon:'🌱', fields:[
    ['date','Date du relevé','date'], ['name','Parcelle / repère','text'], ['type','Type de sol','select',['Argileux','Limoneux','Sableux','Argilo-limoneux','Limono-argileux','Calcaire','Hydromorphe','Tourbeux','Autre']], ['ph','pH','number'], ['redox','Redox','number'], ['conditions','Conditions de mesure','text'], ['fertilization','Fertilisation / amendements','text'], ['comment','Observation','text']
  ]},
  plants: { title:'Plantes / herbe', icon:'🌾', fields:[
    ['date','Date du relevé','date'], ['name','Parcelle / plante','text'], ['weather','Météo','multi',['Ensoleillé','Couvert','Pluie récente','Pluie en cours','Chaud','Sec','Froid','Venté','Rosée','Autre']], ['time','Heure de mesure','time'],
    ['brix','Brix (%)','number'], ['redox','Redox','number'], ['ph','pH','number'], ['height','Hauteur (cm)','number'], ['grazing','Temps de pâturage','text'], ['fertilization','Fertilisation','text'],
    ['potassium','Potassium','number'], ['calcium','Calcium','number'], ['nitrates','Nitrates','number'], ['sodium','Sodium','number'], ['comment','Commentaire','text']
  ]}
};

function numericValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}
function thresholdFor(subject, key) { const mapped = CATEGORY_RULE_MAP[subject.category]; return mapped ? THRESHOLDS[mapped]?.[key] || null : null; }
function classifyValue(value, rule) {
  const number = numericValue(value);
  if (number === null) return { status:'empty', label:'Non mesuré' };
  if (!rule) return { status:'pending', label:'Référence indisponible' };
  const { redLow, greenLow, greenHigh, redHigh, labels = {} } = rule;
  if (redLow !== null && number <= redLow) return { status:'red-low', label:labels.redLow || 'Très bas' };
  if (greenLow !== null && number < greenLow) return { status:'yellow-low', label:labels.yellowLow || 'Bas' };
  if (greenHigh !== null && number <= greenHigh && (greenLow === null || number >= greenLow)) return { status:'green', label:labels.green || 'Référence' };
  if (redHigh !== null && number >= redHigh) return { status:'red-high', label:labels.redHigh || 'Très haut' };
  if (greenHigh !== null && number > greenHigh) return { status:'yellow-high', label:labels.yellowHigh || 'Haut' };
  if (greenLow !== null && number >= greenLow) return { status:'green', label:labels.green || 'Référence' };
  return { status:'pending', label:'À interpréter' };
}
function referenceText(rule) { return rule ? (rule.labels?.green || 'Plage disponible') : 'Pas de seuil validé'; }
function statusSeverity(status) { return { 'red-low':3,'red-high':3,'yellow-low':2,'yellow-high':2,pending:1,green:0,empty:0 }[status] ?? 0; }
function ensureAnalysisVisit(visit) {
  visit.analysisConclusions = visit.analysisConclusions || {};
  visit.analysisGeneral = visit.analysisGeneral || { tamis:[], silos:[], soils:[], plants:[] };
  Object.keys(generalConfigs).forEach(key => visit.analysisGeneral[key] = Array.isArray(visit.analysisGeneral[key]) ? visit.analysisGeneral[key] : []);
  visit.analysisActions = Array.isArray(visit.analysisActions) ? visit.analysisActions : [];
  (visit.subjects || []).forEach(subject => {
    subject.measurements = subject.measurements && typeof subject.measurements === 'object' ? subject.measurements : {};
    subject.measurements.analysis = subject.measurements.analysis && typeof subject.measurements.analysis === 'object' ? subject.measurements.analysis : {};
    subject.measurements.observations = subject.measurements.observations && typeof subject.measurements.observations === 'object' ? subject.measurements.observations : {};
    subject.measurements.comments = subject.measurements.comments && typeof subject.measurements.comments === 'object' ? subject.measurements.comments : {};
  });
}
function analysisCell(subject, parameter) {
  const value = subject.measurements.analysis?.[parameter.key] ?? '';
  const rule = thresholdFor(subject, parameter.key);
  const result = subject.category && subject.category !== 'Non classé' ? classifyValue(value, rule) : (value === '' ? {status:'empty',label:'Non mesuré'} : {status:'unclassified',label:'Classer le sujet'});
  return `<td class="analysis-value-cell ${result.status}" title="${escapeHtml(result.label)} · ${escapeHtml(referenceText(rule))}"><input class="analysis-input" data-subject-id="${subject.id}" data-param="${parameter.key}" type="number" inputmode="decimal" step="${parameter.step}" ${parameter.min ? `min="${parameter.min}"` : ''} ${parameter.max ? `max="${parameter.max}"` : ''} value="${escapeHtml(value)}"/><small>${escapeHtml(result.label)}</small></td>`;
}
function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a,b)=>a+b,0)/values.length;
  return Math.sqrt(values.reduce((sum,v)=>sum+((v-mean)**2),0)/values.length);
}
function categoryAnalysis(visit) {
  const groups = new Map();
  (visit.subjects || []).filter(s => s.category && s.category !== 'Non classé').forEach(subject => {
    if(!groups.has(subject.category)) groups.set(subject.category,[]);
    groups.get(subject.category).push(subject);
  });
  return [...groups.entries()].map(([category,subjects]) => ({
    category, subjects,
    parameterResults: analysisParameters.map(parameter => {
      const measured = subjects.map(subject => {
        const value = numericValue(subject.measurements.analysis?.[parameter.key]);
        if(value===null) return null;
        const rule = thresholdFor(subject,parameter.key);
        return { value, result:classifyValue(value,rule), rule, subject };
      }).filter(Boolean);
      if(!measured.length) return null;
      const values = measured.map(i=>i.value);
      const average = values.reduce((a,b)=>a+b,0)/values.length;
      const worst = measured.slice().sort((a,b)=>statusSeverity(b.result.status)-statusSeverity(a.result.status))[0];
      return { parameter, measured, average, minimum:Math.min(...values), maximum:Math.max(...values), standardDeviation:standardDeviation(values), outOfRange:measured.filter(i=>statusSeverity(i.result.status)>=2).length, worst, rule:measured[0].rule };
    }).filter(Boolean)
  }));
}

function dominantValues(subjects,key) {
  const counts={}; subjects.forEach(s=>{const raw=s.measurements.observations?.[key]; const vals=Array.isArray(raw)?raw:(raw?[raw]:[]); vals.forEach(v=>counts[v]=(counts[v]||0)+1);});
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,4);
}
function interpretationItems(group) {
  const byKey=Object.fromEntries(group.parameterResults.map(i=>[i.parameter.key,i])); const items=[];
  const abnormal=i=>i&&statusSeverity(i.worst.result.status)>=2, high=i=>i&&['yellow-high','red-high'].includes(i.worst.result.status), low=i=>i&&['yellow-low','red-low'].includes(i.worst.result.status);
  if(high(byKey.urineDensity)||high(byKey.urineColor))items.push({level:'warning',theme:'Hydratation',title:'Accès à l’eau à vérifier',text:'Urines concentrées ou foncées : croiser avec débit, nombre d’abreuvoirs, concurrence, météo et durée avant prélèvement.',action:'Contrôler les débits, la propreté et l’accessibilité des abreuvoirs.'});
  if(abnormal(byKey.urinePH)||abnormal(byKey.urineRedox))items.push({level:'warning',theme:'Équilibre acido-basique',title:'Profil urinaire à investiguer',text:'Le pH ou le redox urinaire s’écarte du repère catégoriel. Croiser avec la ration, les minéraux, les fourrages et le stade physiologique.',action:'Revoir ration, minéralisation et analyses des fourrages.'});
  if(high(byKey.boh)||low(byKey.glucose))items.push({level:'danger',theme:'Énergie',title:'Déficit énergétique possible',text:'Le couple BOH/glycémie comporte un écart. Vérifier ingestion, densité énergétique, transition, état corporel et compétition alimentaire.',action:'Contrôler ingestion et transition alimentaire puis recontrôler BOH/glycémie.'});
  if(abnormal(byKey.urea))items.push({level:'warning',theme:'Azote',title:'Équilibre azoté à vérifier',text:'L’urémie s’écarte du repère. Croiser avec énergie fermentescible, azote soluble, ration et hydratation.',action:'Vérifier les apports azotés et leur synchronisation avec l’énergie.'});
  if(abnormal(byKey.fecesPH)||abnormal(byKey.fecesRedox))items.push({level:'warning',theme:'Digestion',title:'Fermentations digestives à vérifier',text:'Les mesures fécales suggèrent de contrôler transit, fibrosité, tri et transitions.',action:'Observer la ration, le tri, les fibres et réaliser/relire le tamis.'});
  if(abnormal(byKey.nec))items.push({level:'warning',theme:'État corporel',title:'NEC à surveiller',text:'La NEC moyenne ou certaines valeurs s’écartent du repère de la catégorie.',action:'Suivre la dynamique de NEC et adapter la conduite du lot.'});
  const feces=dominantValues(group.subjects,'fecesAspect'); if(feces.some(([v])=>['Liquides','Collantes','Grains','Fibres longues'].includes(v)))items.push({level:'warning',theme:'Bouses',title:'Observations de bouses défavorables',text:`Observations dominantes : ${feces.map(([v,n])=>`${v} (${n})`).join(', ')}.`,action:'Croiser avec le tamis, la fibrosité et la vitesse de transition.'});
  const limbs=dominantValues(group.subjects,'limbs'); if(limbs.some(([v])=>['Boiterie','Enflammé','Blessures'].includes(v)))items.push({level:'danger',theme:'Locomotion',title:'Atteintes des membres observées',text:`Signes relevés : ${limbs.map(([v,n])=>`${v} (${n})`).join(', ')}.`,action:'Examiner couchage, sols, parage et prise en charge des animaux atteints.'});
  if(!items.length&&group.parameterResults.length)items.push({level:'good',theme:'Ensemble',title:'Profil globalement dans les repères',text:'Les valeurs renseignées sont majoritairement dans les plages utilisées. À confronter aux observations et aux autres volets.',action:'Maintenir les pratiques et surveiller l’évolution.'});
  return items;
}
function ratioCount(subjects, predicate) {
  const matching = subjects.filter(predicate).length;
  return { matching, total:subjects.length, ratio:subjects.length ? matching/subjects.length : 0 };
}
function resultFor(subject,key) {
  const value=numericValue(subject.measurements.analysis?.[key]);
  return value===null ? null : {value,classification:classifyValue(value,thresholdFor(subject,key))};
}
function isLow(subject,key){const r=resultFor(subject,key);return r&&['red-low','yellow-low'].includes(r.classification.status);}
function isHigh(subject,key){const r=resultFor(subject,key);return r&&['red-high','yellow-high'].includes(r.classification.status);}
function hasObservation(subject,key,values){const raw=subject.measurements.observations?.[key];const list=Array.isArray(raw)?raw:(raw?[raw]:[]);return list.some(v=>values.includes(v));}
function confidenceLabel(score,evidenceCount,contradictionsCount){
  if(evidenceCount>=3&&score>=5&&contradictionsCount===0)return{label:'élevée',className:'high'};
  if(evidenceCount>=2&&score>=3)return{label:'modérée',className:'medium'};
  return{label:'faible',className:'low'};
}
function buildHypotheses(group) {
  const subjects=group.subjects, hypotheses=[];
  {
    const evidence=[],nuance=[],missing=[];let score=0;
    const lowGly=ratioCount(subjects,s=>isLow(s,'glucose')), highBoh=ratioCount(subjects,s=>isHigh(s,'boh')), lowNec=ratioCount(subjects,s=>isLow(s,'nec')), poorMuscles=ratioCount(subjects,s=>['--','-'].includes(s.measurements.observations?.muscles));
    if(lowGly.matching){evidence.push(`${lowGly.matching}/${lowGly.total} glycémie(s) basse(s)`);score+=lowGly.ratio>=.5?2:1;}
    if(highBoh.matching){evidence.push(`${highBoh.matching}/${highBoh.total} BOH élevé(s)`);score+=highBoh.ratio>=.5?3:2;}
    if(lowNec.matching){evidence.push(`${lowNec.matching}/${lowNec.total} NEC basse(s)`);score+=lowNec.ratio>=.5?2:1;}
    if(poorMuscles.matching){evidence.push(`${poorMuscles.matching}/${poorMuscles.total} musculature(s) faible(s)`);score+=1;}
    const normalGly=ratioCount(subjects,s=>resultFor(s,'glucose')?.classification.status==='green');if(normalGly.ratio>=.7)nuance.push('La majorité des glycémies est dans la plage de référence.');
    if(!subjects.some(s=>numericValue(s.measurements.analysis?.glucose)!==null))missing.push('Glycémies non renseignées');
    if(!subjects.some(s=>numericValue(s.measurements.analysis?.boh)!==null))missing.push('BOH non renseignés');
    if(!subjects.some(s=>numericValue(s.measurements.analysis?.nec)!==null))missing.push('NEC non renseignées');
    if(evidence.length)hypotheses.push({domain:'Métabolisme énergétique',title:'Équilibre énergétique à approfondir',confidence:confidenceLabel(score,evidence.length,nuance.length),summary:'Les éléments observés peuvent être compatibles avec un déficit énergétique. Cette piste doit être confrontée au stade physiologique, à la ration et à la dynamique du lot.',evidence,nuance,missing,checks:['Vérifier la transition alimentaire et l’ingestion réelle','Confronter avec la ration et la qualité des fourrages','Compléter les mesures manquantes sur un nombre représentatif de sujets']});
  }
  {
    const evidence=[],nuance=[],missing=[];let score=0;
    const dense=ratioCount(subjects,s=>isHigh(s,'urineDensity')),dark=ratioCount(subjects,s=>isHigh(s,'urineColor')),highBrix=ratioCount(subjects,s=>isHigh(s,'urineBrix'));
    if(dense.matching){evidence.push(`${dense.matching}/${dense.total} densité(s) urinaire(s) élevée(s)`);score+=dense.ratio>=.5?3:2;}
    if(dark.matching){evidence.push(`${dark.matching}/${dark.total} urine(s) foncée(s)`);score+=dark.ratio>=.5?2:1;}
    if(highBrix.matching){evidence.push(`${highBrix.matching}/${highBrix.total} Brix urinaire(s) élevé(s)`);score+=1;}
    const normal=ratioCount(subjects,s=>resultFor(s,'urineDensity')?.classification.status==='green');if(normal.ratio>=.7)nuance.push('La majorité des densités urinaires est dans la plage de référence.');
    if(!subjects.some(s=>numericValue(s.measurements.analysis?.urineDensity)!==null))missing.push('Densités urinaires non renseignées');
    if(evidence.length)hypotheses.push({domain:'Hydratation',title:'Accès à l’eau / hydratation à vérifier',confidence:confidenceLabel(score,evidence.length,nuance.length),summary:'La concentration ou la couleur des urines peut inviter à vérifier l’accès à l’eau, le débit et les conditions d’abreuvement. Ces résultats ne suffisent pas à attribuer une cause.',evidence,nuance,missing,checks:['Mesurer les débits des abreuvoirs','Vérifier le nombre, la propreté et l’accessibilité des points d’eau','Confronter aux conditions météorologiques et à la consommation estimée']});
  }
  {
    const evidence=[],nuance=[],missing=[];let score=0;
    const ph=ratioCount(subjects,s=>{const r=resultFor(s,'fecesPH');return r&&statusSeverity(r.classification.status)>=2;}), redox=ratioCount(subjects,s=>{const r=resultFor(s,'fecesRedox');return r&&statusSeverity(r.classification.status)>=2;}), aspect=ratioCount(subjects,s=>hasObservation(s,'fecesAspect',['Liquides','Molles','Collantes','Grains','Fibres longues'])), rumen=ratioCount(subjects,s=>['1','2'].includes(String(s.measurements.observations?.rumenFill||'')));
    if(ph.matching){evidence.push(`${ph.matching}/${ph.total} pH de bouses hors plage`);score+=2;}
    if(redox.matching){evidence.push(`${redox.matching}/${redox.total} redox de bouses hors plage`);score+=2;}
    if(aspect.matching){evidence.push(`${aspect.matching}/${aspect.total} aspect(s) de bouses à surveiller`);score+=aspect.ratio>=.5?2:1;}
    if(rumen.matching){evidence.push(`${rumen.matching}/${rumen.total} remplissage(s) du rumen faible(s)`);score+=1;}
    const normal=ratioCount(subjects,s=>resultFor(s,'fecesPH')?.classification.status==='green'&&resultFor(s,'fecesRedox')?.classification.status==='green');if(normal.ratio>=.7)nuance.push('La majorité des couples pH/redox des bouses est dans la plage de référence.');
    if(!subjects.some(s=>numericValue(s.measurements.analysis?.fecesPH)!==null))missing.push('pH des bouses non renseigné');
    if(!subjects.some(s=>numericValue(s.measurements.analysis?.fecesRedox)!==null))missing.push('Redox des bouses non renseigné');
    if(evidence.length)hypotheses.push({domain:'Digestion',title:'Digestion et structure de ration à approfondir',confidence:confidenceLabel(score,evidence.length,nuance.length),summary:'La combinaison des mesures et des observations de bouses peut justifier une vérification de la digestion et de la structure physique de la ration.',evidence,nuance,missing,checks:['Confronter avec le tamis à bouses','Vérifier la fibrosité, le tri et l’ordre de distribution','Examiner la qualité et la conservation des fourrages']});
  }
  return hypotheses;
}
function renderHypothesisCard(h){
  const list=(title,items,cls)=>items.length?`<div class="reason-block ${cls}"><strong>${title}</strong><ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`:'';
  return `<article class="reason-card"><div class="reason-head"><div><span class="reason-domain">${escapeHtml(h.domain)}</span><h4>${escapeHtml(h.title)}</h4></div><span class="confidence ${h.confidence.className}">Confiance ${h.confidence.label}</span></div><p>${escapeHtml(h.summary)}</p>${list('Éléments qui vont dans ce sens',h.evidence,'supports')}${list('Éléments qui invitent à la prudence',h.nuance,'nuances')}${list('Données manquantes',h.missing,'missing')}${list('À vérifier pour approfondir',h.checks,'checks')}</article>`;
}
function renderReasoningSection(visit){
  const groups=categoryAnalysis(visit);if(!groups.length)return'<div class="empty">Classez les sujets et saisissez des valeurs pour générer le raisonnement.</div>';
  return `<div class="notice"><strong>Lecture transparente :</strong> chaque piste est justifiée par les données qui la soutiennent, les éléments qui la nuancent et les informations manquantes. Le technicien conserve la conclusion.</div><div class="reason-groups">${groups.map(group=>{const hypotheses=buildHypotheses(group);return `<section class="card"><div class="section-title"><div><h3>${escapeHtml(group.category)}</h3><span class="muted">${group.subjects.length} sujet(s)</span></div></div>${hypotheses.length?`<div class="reason-grid">${hypotheses.map(renderHypothesisCard).join('')}</div>`:'<div class="empty">Aucune hypothèse suffisamment étayée avec les données actuelles.</div>'}</section>`;}).join('')}</div>`;
}

function renderAnalysisSummary(visit) {
  const groups=categoryAnalysis(visit), unclassified=(visit.subjects||[]).filter(s=>!s.category||s.category==='Non classé');
  if(!groups.length)return '<div class="empty">Classez les sujets et saisissez des mesures pour obtenir une synthèse.</div>';
  return `<div class="analysis-summary-groups">${groups.map(group=>{const interpretations=interpretationItems(group);return `<article class="card analysis-category-card"><div class="section-title"><div><h3>${escapeHtml(group.category)}</h3><span class="muted">${group.subjects.length} sujet(s)</span></div><span class="analysis-category-score">${group.parameterResults.length} paramètre(s)</span></div><div class="table-wrap"><table class="stats-table"><thead><tr><th>Paramètre</th><th>n</th><th>Min</th><th>Moyenne</th><th>Max</th><th>Hors réf.</th><th>Référence</th></tr></thead><tbody>${group.parameterResults.map(i=>`<tr><td><strong>${escapeHtml(i.parameter.label)}</strong></td><td>${i.measured.length}</td><td>${i.minimum.toLocaleString('fr-FR',{maximumFractionDigits:2})}</td><td class="stat-main ${i.worst.result.status}">${i.average.toLocaleString('fr-FR',{maximumFractionDigits:2})}</td><td>${i.maximum.toLocaleString('fr-FR',{maximumFractionDigits:2})}</td><td>${i.outOfRange}/${i.measured.length}</td><td>${escapeHtml(referenceText(i.rule))}</td></tr>`).join('')}</tbody></table></div><div class="analysis-interpretations">${interpretations.map(i=>`<div class="analysis-message ${i.level}"><strong>${escapeHtml(i.title)}</strong><span>${escapeHtml(i.text)}</span><small>Action proposée : ${escapeHtml(i.action)}</small></div>`).join('')}</div><div class="field"><label>Conclusion du technicien</label><textarea data-analysis-conclusion="${escapeHtml(group.category)}">${escapeHtml(visit.analysisConclusions?.[group.category]||'')}</textarea></div></article>`;}).join('')}</div>${unclassified.length?`<div class="notice warning" style="margin-top:14px"><strong>${unclassified.length} sujet(s) non classé(s)</strong> : pas d’interprétation catégorielle.</div>`:''}`;
}

function renderNumericSection(visit) {
  const families = ['Urines','Sang','Bouses','Physique','Lait','Colostrum'];
  if (!families.includes(activeAnalysisFamily)) activeAnalysisFamily = 'Urines';
  const params = analysisParameters.filter(p => p.group === activeAnalysisFamily);
  const minWidth = 150 + 170 + (params.length * 125) + 290;
  const rows = visit.subjects.map(subject => `<tr data-analysis-subject-row="${subject.id}" class="${focusedAnalysisSubjectId===subject.id?'focused-subject-row':''}">
    <td class="sticky-col" style="min-width:150px"><strong>${escapeHtml(subject.tag||'Sujet')}</strong><br><small>${escapeHtml(subject.location||'')}</small></td>
    <td class="sticky-col-2" style="min-width:170px"><span class="badge ${subject.category&&subject.category!=='Non classé'?'complete':'unclassified'}">${escapeHtml(subject.category||'Non classé')}</span></td>
    ${params.map(p=>analysisCell(subject,p)).join('')}
    <td class="matrix-comment-cell" style="min-width:280px"><textarea class="matrix-comment" data-family-comment data-subject-id="${subject.id}" data-family="${activeAnalysisFamily}" placeholder="Commentaire libre…">${escapeHtml(subject.measurements.comments?.[activeAnalysisFamily]||'')}</textarea></td>
  </tr>`).join('');
  return `<section class="card"><div class="section-title"><div><h3>Mesures numériques par famille</h3><span class="muted">Les sujets sont repris automatiquement. La valeur est sauvegardée quand vous quittez la cellule.</span></div><span class="analysis-legend"><i class="green"></i> Référence <i class="yellow"></i> Vigilance <i class="red"></i> Écart <i class="grey"></i> En attente</span></div>
  <nav class="family-tabs">${families.map(f=>`<button class="family-tab ${activeAnalysisFamily===f?'active':''}" data-analysis-family="${f}">${f}</button>`).join('')}</nav>
  ${params.length ? `<div class="table-wrap analysis-table-wrap"><table class="analysis-table matrix-table" style="min-width:${minWidth}px;width:${minWidth}px"><thead><tr><th class="sticky-col" style="min-width:150px">Sujet</th><th class="sticky-col-2" style="min-width:170px">Catégorie</th>${params.map(p=>`<th style="min-width:125px">${escapeHtml(p.short)}</th>`).join('')}<th class="comment-head" style="min-width:280px">Commentaire / observation</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="notice warning"><strong>Aucun paramètre configuré pour ${escapeHtml(activeAnalysisFamily)}.</strong></div>`}
  </section>`;
}

function obsControl(subject,field) { const data=subject.measurements.observations||{}; const current=data[field.key]; if(field.type==='number')return `<input data-observation data-subject-id="${subject.id}" data-key="${field.key}" type="number" step="${field.step||'1'}" value="${escapeHtml(current??'')}"/>`; if(field.type==='text')return `<input data-observation data-subject-id="${subject.id}" data-key="${field.key}" value="${escapeHtml(current??'')}"/>`; if(field.type==='single')return `<select data-observation data-subject-id="${subject.id}" data-key="${field.key}"><option value="">—</option>${field.options.map(o=>`<option ${current===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select>`; const selected=Array.isArray(current)?current:[]; return `<div class="chip-options">${field.options.map(o=>`<label class="choice-chip ${selected.includes(o)?'selected':''}"><input type="checkbox" data-observation-multi data-subject-id="${subject.id}" data-key="${field.key}" value="${escapeHtml(o)}" ${selected.includes(o)?'checked':''}/>${escapeHtml(o)}</label>`).join('')}</div>`; }
function renderObservationsSection(visit) { return `<div class="subject-observation-list">${visit.subjects.map((s,i)=>`<details class="card observation-card" ${i===0?'open':''}><summary><strong>${escapeHtml(s.tag||`Sujet ${i+1}`)}</strong><span>${escapeHtml(s.category||'Non classé')} · ${escapeHtml(s.location||'')}</span></summary><div class="observation-grid">${observationFields.map(f=>`<div class="field"><label>${escapeHtml(f.label)}</label>${obsControl(s,f)}</div>`).join('')}</div></details>`).join('')}</div>`; }
function generalField(record,configKey,field) { const [key,label,type,options]=field; const value=record[key]??''; if(type==='select')return `<div class="field"><label>${label}</label><select data-general-field data-kind="${configKey}" data-id="${record.id}" data-key="${key}"><option value="">—</option>${options.map(o=>`<option ${value===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div>`; if(type==='multi'){const selected=Array.isArray(value)?value:[];return `<div class="field field-wide"><label>${label}</label><div class="chip-options">${options.map(o=>`<label class="choice-chip ${selected.includes(o)?'selected':''}"><input type="checkbox" data-general-multi data-kind="${configKey}" data-id="${record.id}" data-key="${key}" value="${escapeHtml(o)}" ${selected.includes(o)?'checked':''}/>${escapeHtml(o)}</label>`).join('')}</div></div>`;} return `<div class="field ${type==='text'&&key==='comment'?'field-wide':''}"><label>${label}</label><input data-general-field data-kind="${configKey}" data-id="${record.id}" data-key="${key}" type="${type}" ${type==='number'?'step="any" inputmode="decimal"':''} value="${escapeHtml(value)}"/></div>`; }
function renderGeneralSection(visit) {
  const kinds = Object.keys(generalConfigs);
  if (!generalConfigs[activeGeneralKind]) activeGeneralKind = 'tamis';
  const cfg = generalConfigs[activeGeneralKind];
  const records = visit.analysisGeneral[activeGeneralKind] || [];
  const tabs = kinds.map(kind => {
    const item = generalConfigs[kind];
    const count = (visit.analysisGeneral[kind] || []).length;
    return `<button class="general-kind-tab ${activeGeneralKind===kind?'active':''}" data-general-kind="${kind}">${item.icon} ${escapeHtml(item.title)} <span class="count-badge">${count}</span></button>`;
  }).join('');
  return `<nav class="general-kind-tabs">${tabs}</nav>
  <section class="card general-active-card">
    <div class="section-title"><div><h3>${cfg.icon} ${cfg.title}</h3><span class="muted">Relevés indépendants des animaux · sauvegarde automatique.</span></div><button class="btn primary" data-add-general="${activeGeneralKind}">Ajouter un relevé</button></div>
    <div class="general-records">${records.length?records.map((r,i)=>`<article class="general-record"><div class="section-title"><strong>${escapeHtml(cfg.title)} ${i+1}</strong><button class="btn small danger" data-remove-general="${activeGeneralKind}" data-id="${r.id}">Supprimer</button></div><div class="general-grid">${cfg.fields.map(f=>generalField(r,activeGeneralKind,f)).join('')}${activeGeneralKind==='tamis'?`<div class="calculated-box"><strong>Pourcentages automatiques</strong><span>Tamis 1 : ${numericValue(r.total)>0&&numericValue(r.t1)!==null?(100*numericValue(r.t1)/numericValue(r.total)).toFixed(1):'—'} %</span><span>Tamis 2 : ${numericValue(r.total)>0&&numericValue(r.t2)!==null?(100*numericValue(r.t2)/numericValue(r.total)).toFixed(1):'—'} %</span></div>`:''}</div></article>`).join(''):`<div class="empty">Aucun relevé. Cliquez sur « Ajouter un relevé ».</div>`}</div>
  </section>`;
}
function suggestedActions(visit) { const out=[]; categoryAnalysis(visit).forEach(g=>interpretationItems(g).filter(i=>i.level!=='good').forEach(i=>out.push({category:g.category,...i}))); return out; }
function renderSynthesisSection(visit) { const suggestions=suggestedActions(visit); return `<div id="analysis-summary">${renderAnalysisSummary(visit)}</div><section class="card" style="margin-top:16px"><div class="section-title"><div><h3>Plan d’action</h3><span class="muted">Propositions issues des écarts. Le technicien valide et reformule.</span></div><button class="btn" id="add-custom-action">Ajouter une action libre</button></div><div class="action-suggestions">${suggestions.length?suggestions.map((a,i)=>`<div class="action-line"><span class="badge ${a.level==='danger'?'in-progress':'archived'}">${a.level==='danger'?'Priorité haute':'À surveiller'}</span><div><strong>${escapeHtml(a.category)} — ${escapeHtml(a.theme)}</strong><br><span>${escapeHtml(a.action)}</span></div><button class="btn small" data-accept-action="${i}">Ajouter</button></div>`).join(''):'<div class="empty">Aucune action automatique proposée à ce stade.</div>'}</div><div class="action-list">${visit.analysisActions.length?visit.analysisActions.map(a=>`<div class="action-edit"><select data-action-field="status" data-action-id="${a.id}"><option ${a.status==='À faire'?'selected':''}>À faire</option><option ${a.status==='En cours'?'selected':''}>En cours</option><option ${a.status==='Réalisé'?'selected':''}>Réalisé</option></select><input data-action-field="text" data-action-id="${a.id}" value="${escapeHtml(a.text||'')}"/><input data-action-field="responsible" data-action-id="${a.id}" placeholder="Responsable" value="${escapeHtml(a.responsible||'')}"/><button class="btn small danger" data-remove-action="${a.id}">×</button></div>`).join(''):''}</div></section>`; }
function renderAnalysis() {
  const visits=db.visits.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(!activeVisitId&&visits.length)setActiveVisit(visits[0].id);
  const visit=activeVisit();
  if(visit)ensureAnalysisVisit(visit);
  const tabs=[['numeric','Matrices par famille'],['observations','Observations'],['general','Tamis · Silos · Sol · Plantes'],['reasoning','Raisonnement'],['summary','Statistiques & actions']];
  app.innerHTML=`<div class="section-title"><div><h2>Analyse complète</h2><div class="muted">Mesures, observations, relevés généraux et synthèse croisée. Aide à l’interprétation, sans valeur diagnostique.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
  ${activeVisitBanner(visit)}
  ${!visit?'<div class="empty" style="margin-top:16px">Choisissez une visite dans l’onglet Visites.</div>':!visit.subjects?.length?'<div class="empty" style="margin-top:16px">Ajoutez des sujets dans l’onglet Animaux.</div>':`<section class="card analysis-utilities"><div class="actions"><button class="btn" id="analysis-demo">Jeu d’essai</button><button class="btn secondary" id="analysis-clear">Effacer l’analyse</button></div></section><nav class="analysis-tabs">${tabs.map(([k,l])=>`<button class="analysis-tab ${activeAnalysisSection===k?'active':''}" data-analysis-section="${k}">${l}</button>`).join('')}</nav><section class="analysis-content">${activeAnalysisSection==='numeric'?renderNumericSection(visit):activeAnalysisSection==='observations'?renderObservationsSection(visit):activeAnalysisSection==='general'?renderGeneralSection(visit):activeAnalysisSection==='reasoning'?renderReasoningSection(visit):renderSynthesisSection(visit)}</section>`}`;
  app.querySelectorAll('[data-analysis-section]').forEach(b=>b.onclick=()=>{activeAnalysisSection=b.dataset.analysisSection;localStorage.setItem('audit-bovin-active-analysis-section',activeAnalysisSection);renderAnalysis();});
  app.querySelectorAll('[data-analysis-family]').forEach(b=>b.onclick=()=>{activeAnalysisFamily=b.dataset.analysisFamily;localStorage.setItem('audit-bovin-active-analysis-family',activeAnalysisFamily);renderAnalysis();});
  app.querySelectorAll('[data-general-kind]').forEach(b=>b.onclick=()=>{activeGeneralKind=b.dataset.generalKind;localStorage.setItem('audit-bovin-active-general-kind',activeGeneralKind);renderAnalysis();});
  bindAnalysisEvents(visit);
  if (focusedAnalysisSubjectId && activeAnalysisSection === 'numeric') {
    setTimeout(() => {
      const row = app.querySelector(`[data-analysis-subject-row="${focusedAnalysisSubjectId}"]`);
      row?.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' });
      row?.querySelector('input')?.focus({ preventScroll:true });
      focusedAnalysisSubjectId='';
      localStorage.removeItem('audit-bovin-focused-analysis-subject');
    }, 80);
  }
}

function bindAnalysisEvents(visit) {
  if(!visit)return;
  app.querySelectorAll('.analysis-input').forEach(input=>{const persist=()=>{const s=visit.subjects.find(x=>x.id===input.dataset.subjectId);if(!s)return;s.measurements.analysis[input.dataset.param]=input.value;s.updatedAt=new Date().toISOString();visit.updatedAt=new Date().toISOString();saveDatabase(db);const result=s.category&&s.category!=='Non classé'?classifyValue(input.value,thresholdFor(s,input.dataset.param)):(input.value===''?{status:'empty',label:'Non mesuré'}:{status:'unclassified',label:'Classer le sujet'});const cell=input.closest('.analysis-value-cell');cell.className=`analysis-value-cell ${result.status}`;cell.querySelector('small').textContent=result.label;};input.onchange=persist;input.onblur=persist;});
  app.querySelectorAll('[data-family-comment]').forEach(el=>{const save=()=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);if(!s)return;s.measurements.comments=s.measurements.comments||{};s.measurements.comments[el.dataset.family]=el.value;s.updatedAt=new Date().toISOString();visit.updatedAt=new Date().toISOString();saveDatabase(db);};el.oninput=save;el.onchange=save;el.onblur=save;});
  app.querySelectorAll('[data-observation]').forEach(el=>{const save=()=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);s.measurements.observations[el.dataset.key]=el.value;visit.updatedAt=new Date().toISOString();saveDatabase(db);};el.oninput=save;el.onchange=save;});
  app.querySelectorAll('[data-observation-multi]').forEach(el=>el.onchange=()=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);const key=el.dataset.key;s.measurements.observations[key]=[...app.querySelectorAll(`[data-observation-multi][data-subject-id="${s.id}"][data-key="${key}"]:checked`)].map(x=>x.value);visit.updatedAt=new Date().toISOString();saveDatabase(db);el.closest('.choice-chip')?.classList.toggle('selected',el.checked);});
  app.querySelectorAll('[data-add-general]').forEach(b=>b.onclick=()=>{visit.analysisGeneral[b.dataset.addGeneral].push({id:uid(b.dataset.addGeneral),date:new Date().toISOString().slice(0,10)});saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-remove-general]').forEach(b=>b.onclick=()=>{visit.analysisGeneral[b.dataset.removeGeneral]=visit.analysisGeneral[b.dataset.removeGeneral].filter(r=>r.id!==b.dataset.id);saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-general-field]').forEach(el=>{const save=()=>{const r=visit.analysisGeneral[el.dataset.kind].find(x=>x.id===el.dataset.id);if(!r)return;r[el.dataset.key]=el.value;visit.updatedAt=new Date().toISOString();saveDatabase(db);if(el.dataset.kind==='tamis'&&['total','t1','t2'].includes(el.dataset.key)){const box=el.closest('.general-record')?.querySelector('.calculated-box');if(box){const total=numericValue(r.total),t1=numericValue(r.t1),t2=numericValue(r.t2),spans=box.querySelectorAll('span');if(spans[0])spans[0].textContent=`Tamis 1 : ${total>0&&t1!==null?(100*t1/total).toFixed(1):'—'} %`;if(spans[1])spans[1].textContent=`Tamis 2 : ${total>0&&t2!==null?(100*t2/total).toFixed(1):'—'} %`;}}};el.oninput=save;el.onchange=save;el.onblur=save;});
  app.querySelectorAll('[data-general-multi]').forEach(el=>el.onchange=()=>{const r=visit.analysisGeneral[el.dataset.kind].find(x=>x.id===el.dataset.id);r[el.dataset.key]=[...app.querySelectorAll(`[data-general-multi][data-kind="${el.dataset.kind}"][data-id="${el.dataset.id}"][data-key="${el.dataset.key}"]:checked`)].map(x=>x.value);saveDatabase(db);el.closest('.choice-chip')?.classList.toggle('selected',el.checked);});
  app.querySelectorAll('[data-analysis-conclusion]').forEach(el=>el.oninput=()=>{visit.analysisConclusions[el.dataset.analysisConclusion]=el.value;saveDatabase(db);});
  const suggestions=suggestedActions(visit); app.querySelectorAll('[data-accept-action]').forEach(b=>b.onclick=()=>{const s=suggestions[Number(b.dataset.acceptAction)];visit.analysisActions.push({id:uid('action'),text:`${s.category} — ${s.action}`,responsible:'',status:'À faire'});saveDatabase(db);renderAnalysis();});
  document.getElementById('add-custom-action')?.addEventListener('click',()=>{visit.analysisActions.push({id:uid('action'),text:'',responsible:'',status:'À faire'});saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-action-field]').forEach(el=>{const save=()=>{const a=visit.analysisActions.find(x=>x.id===el.dataset.actionId);a[el.dataset.actionField]=el.value;saveDatabase(db);};el.oninput=save;el.onchange=save;});
  app.querySelectorAll('[data-remove-action]').forEach(b=>b.onclick=()=>{visit.analysisActions=visit.analysisActions.filter(a=>a.id!==b.dataset.removeAction);saveDatabase(db);renderAnalysis();});
  document.getElementById('analysis-demo')?.addEventListener('click',()=>{if(!confirm('Charger un jeu d’essai ?'))return;const cats=['Fraîche vêlée','Pic de lactation','Préparation vêlage','Fin lactation'];visit.subjects.forEach((s,i)=>{if(!s.category||s.category==='Non classé')s.category=cats[i%cats.length];const alert=i%3===1;s.measurements.analysis={nec:alert?'2':'3.25',urineColor:alert?'4':'2',urinePH:alert?'8.7':'7.3',urineRedox:alert?'15':'-10',urineBrix:alert?'9':'4',urineDensity:alert?'1036':'1020',glucose:alert?'39':'58',boh:alert?'1.5':'0.4',bloodPH:alert?'7.5':'7.4',urea:alert?'0.34':'0.25',fecesPH:alert?'6.2':'6.65',fecesRedox:alert?'-145':'-205',milkPH:'6.6',milkBrix:'11',colostrumBrix:'24'};s.measurements.observations={muscles:alert?'-':'0',coat:alert?['Ternes','Hirsutes']:['Fins','Soyeux'],fecesAspect:alert?['Liquides','Grains']:['Moulées'],limbs:alert?['Boiterie']:[],locomotion:alert?'2':'1',rumenFill:alert?'2':'4'};});visit.analysisGeneral.tamis=[{id:uid('tamis'),category:'Vaches en production',represented:'8',total:'500',t1:'80',t2:'65',comment:'Mélange du lot'}];saveDatabase(db);renderAnalysis();});
  document.getElementById('analysis-clear')?.addEventListener('click',()=>{if(!confirm('Effacer toutes les données du module Analyse ?'))return;visit.subjects.forEach(s=>{s.measurements.analysis={};s.measurements.observations={};s.measurements.comments={};});visit.analysisGeneral={tamis:[],silos:[],soils:[],plants:[]};visit.analysisConclusions={};visit.analysisActions=[];saveDatabase(db);renderAnalysis();});
}


function feedingRowHtml(row, index) {
  return `<tr data-feeding-row="${row.id}">
    <td class="row-number">${index + 1}</td>
    <td><select data-feeding-field="category" data-id="${row.id}">${feedingCategories.map(v => `<option ${row.category===v?'selected':''}>${v}</option>`).join('')}</select></td>
    <td><select data-feeding-field="type" data-id="${row.id}">${feedTypes.map(v => `<option ${row.type===v?'selected':''}>${v}</option>`).join('')}</select></td>
    <td><input data-feeding-field="nature" data-id="${row.id}" value="${escapeHtml(row.nature || '')}" placeholder="Ex. maïs, prairie, VL18…" /></td>
    <td><input data-feeding-field="quantity" data-id="${row.id}" inputmode="decimal" value="${escapeHtml(row.quantity || '')}" placeholder="Quantité" /></td>
    <td><select data-feeding-field="unit" data-id="${row.id}">${feedUnits.map(v => `<option ${row.unit===v?'selected':''}>${v}</option>`).join('')}</select></td>
    <td><select data-feeding-field="distribution" data-id="${row.id}">${distributionModes.map(v => `<option ${row.distribution===v?'selected':''}>${v}</option>`).join('')}</select></td>
    <td><input data-feeding-field="frequency" data-id="${row.id}" value="${escapeHtml(row.frequency || '')}" placeholder="Ex. 2 fois/j, 8 h–18 h" /></td>
    <td><textarea data-feeding-field="comment" data-id="${row.id}" placeholder="Commentaire">${escapeHtml(row.comment || '')}</textarea></td>
    <td><div class="feeding-row-actions"><button type="button" class="btn small" data-duplicate-feed="${row.id}">Dupliquer</button><button type="button" class="btn small danger" data-delete-feed="${row.id}">Supprimer</button></div></td>
  </tr>`;
}

function renderFeeding() {
  const visit = activeVisit();
  if (visit) {
    visit.feeding = visit.feeding && typeof visit.feeding === 'object' ? visit.feeding : { rations: [], settings: {}, history: [] };
    visit.feeding.rations = Array.isArray(visit.feeding.rations) ? visit.feeding.rations : [];
    visit.feeding.settings = visit.feeding.settings && typeof visit.feeding.settings === 'object' ? visit.feeding.settings : {};
  }
  const settings = visit?.feeding?.settings || {};
  const rows = visit?.feeding?.rations || [];
  app.innerHTML = `
    <div class="section-title"><div><h2>Alimentation</h2><div class="muted">Rations par catégorie, distribution, minéralisation et transitions.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
    ${activeVisitBanner(visit)}
    ${!visit ? '<section class="empty">Choisissez une visite dans l’onglet Visites.</section>' : `
      <section class="card feeding-card">
        <div class="section-title"><div><h3>Tableau des rations</h3><div class="muted">Ajoutez autant d’aliments que nécessaire pour chaque catégorie.</div></div><div class="actions"><button type="button" class="btn primary" id="add-feed-row">Ajouter un aliment</button><button type="button" class="btn" id="add-feed-category">Ajouter une ration type</button></div></div>
        ${rows.length ? `<div class="table-wrap feeding-table-wrap"><table class="feeding-table"><thead><tr><th>#</th><th>Catégorie</th><th>Type d’aliment</th><th>Nature / composition</th><th>Quantité</th><th>Unité</th><th>Mode de distribution</th><th>Fréquence / horaires</th><th>Commentaire</th><th>Actions</th></tr></thead><tbody>${rows.map(feedingRowHtml).join('')}</tbody></table></div>` : '<div class="empty">Aucun aliment renseigné. Cliquez sur « Ajouter un aliment ».</div>'}
      </section>
      <section class="grid cols-2" style="margin-top:16px">
        <article class="card"><h3>Distribution et mélangeuse</h3>
          <div class="field"><label>Ordre de chargement / distribution</label><textarea data-feeding-setting="loadingOrder" placeholder="Ex. paille, foin, concentrés, minéraux, ensilage…">${escapeHtml(settings.loadingOrder || '')}</textarea></div>
          <div class="row"><div class="field"><label>Nombre de distributions / jour</label><input data-feeding-setting="distributionsPerDay" inputmode="numeric" value="${escapeHtml(settings.distributionsPerDay || '')}" /></div><div class="field"><label>Temps de mélange</label><input data-feeding-setting="mixingTime" value="${escapeHtml(settings.mixingTime || '')}" placeholder="Ex. 10 min" /></div></div>
          <div class="field"><label>Matériel / mélangeuse</label><input data-feeding-setting="equipment" value="${escapeHtml(settings.equipment || '')}" placeholder="Marque, modèle, capacité…" /></div>
          <div class="field"><label>Observations sur la distribution</label><textarea data-feeding-setting="distributionNotes">${escapeHtml(settings.distributionNotes || '')}</textarea></div>
        </article>
        <article class="card"><h3>Transitions, sel et minéralisation</h3>
          <div class="field"><label>Transition alimentaire</label><textarea data-feeding-setting="transition" placeholder="Durée, modalités, changements récents…">${escapeHtml(settings.transition || '')}</textarea></div>
          <div class="field"><label>Accès au sel</label><select data-feeding-setting="saltAccess"><option value="">Non renseigné</option>${['Permanent', 'Ponctuel', 'Absent', 'Variable selon les lots'].map(v=>`<option ${settings.saltAccess===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Minéralisation / compléments</label><textarea data-feeding-setting="mineralization" placeholder="Produit, quantité, fréquence, mode de distribution…">${escapeHtml(settings.mineralization || '')}</textarea></div>
          <div class="field"><label>Eau et restriction éventuelle</label><textarea data-feeding-setting="waterNotes">${escapeHtml(settings.waterNotes || '')}</textarea></div>
        </article>
      </section>
      <section class="card" style="margin-top:16px"><h3>Commentaire général alimentation</h3><textarea class="feeding-general-comment" data-feeding-setting="generalComment" placeholder="Synthèse de la ration, points forts, points à vérifier…">${escapeHtml(settings.generalComment || '')}</textarea></section>`}`;

  if (!visit) return;
  const addRow = (preset = {}) => {
    visit.feeding.rations.push({ id: uid('feed'), category: preset.category || 'Vaches en production', type: preset.type || 'Ensilage', nature: '', quantity: '', unit: 'kg brut/j', distribution: 'Mélangeuse', frequency: '', comment: '', ...preset });
    visit.updatedAt = new Date().toISOString();
    saveDatabase(db); renderFeeding();
  };
  document.getElementById('add-feed-row')?.addEventListener('click', () => addRow());
  document.getElementById('add-feed-category')?.addEventListener('click', () => {
    const category = prompt('Nom de la catégorie animale :', 'Vaches en production');
    if (!category) return;
    ['Ensilage','Foin','Concentré','Minéral','Sel'].forEach(type => addRow({ category, type }));
  });
  app.querySelectorAll('[data-feeding-field]').forEach(el => {
    const save = () => {
      const row = visit.feeding.rations.find(r => r.id === el.dataset.id);
      if (!row) return;
      row[el.dataset.feedingField] = el.value;
      row.updatedAt = new Date().toISOString();
      visit.updatedAt = new Date().toISOString();
      saveDatabase(db);
    };
    el.addEventListener('input', save); el.addEventListener('change', save); el.addEventListener('blur', save);
  });
  app.querySelectorAll('[data-feeding-setting]').forEach(el => {
    const save = () => { visit.feeding.settings[el.dataset.feedingSetting] = el.value; visit.updatedAt = new Date().toISOString(); saveDatabase(db); };
    el.addEventListener('input', save); el.addEventListener('change', save); el.addEventListener('blur', save);
  });
  app.querySelectorAll('[data-delete-feed]').forEach(button => button.onclick = () => {
    if (!confirm('Supprimer cette ligne de ration ?')) return;
    visit.feeding.rations = visit.feeding.rations.filter(r => r.id !== button.dataset.deleteFeed); saveDatabase(db); renderFeeding();
  });
  app.querySelectorAll('[data-duplicate-feed]').forEach(button => button.onclick = () => {
    const source = visit.feeding.rations.find(r => r.id === button.dataset.duplicateFeed); if (!source) return;
    visit.feeding.rations.push({ ...source, id: uid('feed'), nature: source.nature || '', updatedAt: new Date().toISOString() }); saveDatabase(db); renderFeeding();
  });
}


let activeBuildingTab = localStorage.getItem('audit-bovin-building-tab') || 'structure';
let activeBuildingId = localStorage.getItem('audit-bovin-active-building') || '';
let planRuntime = null;

function ensureBuildingAudit(visit, buildingId) {
  visit.buildingAudits = visit.buildingAudits || {};
  const audit = visit.buildingAudits[buildingId] || {};
  audit.drinkers = Array.isArray(audit.drinkers) ? audit.drinkers : [];
  audit.electric = Array.isArray(audit.electric) ? audit.electric : [];
  audit.litters = Array.isArray(audit.litters) ? audit.litters : [];
  audit.ambience = audit.ambience && typeof audit.ambience === 'object' ? audit.ambience : {};
  audit.questionnaire = audit.questionnaire && typeof audit.questionnaire === 'object' ? audit.questionnaire : {};
  visit.buildingAudits[buildingId] = audit;
  return audit;
}

function currentBuildingContext() {
  const visit = activeVisit();
  if (!visit) return { visit:null, farm:null, building:null, audit:null };
  const farm = db.farms.find(f => f.id === visit.farmId);
  farm.buildings = Array.isArray(farm.buildings) ? farm.buildings : [];
  if (!activeBuildingId || !farm.buildings.some(b => b.id === activeBuildingId)) {
    activeBuildingId = farm.buildings[0]?.id || '';
    if (activeBuildingId) localStorage.setItem('audit-bovin-active-building', activeBuildingId);
  }
  const building = farm.buildings.find(b => b.id === activeBuildingId) || null;
  return { visit, farm, building, audit: building ? ensureBuildingAudit(visit, building.id) : null };
}

function buildingTabsHtml() {
  const tabs=[['structure','Structure'],['plan','Plan'],['water','Eau / abreuvoirs'],['electric','Électricité'],['litter','Litière'],['ambience','Ambiance'],['questionnaire','Questionnaire']];
  return `<div class="building-tabs">${tabs.map(([id,label])=>`<button class="building-tab ${activeBuildingTab===id?'active':''}" data-building-tab="${id}">${label}</button>`).join('')}</div>`;
}

function saveBuildingPermanent(building, field, value) {
  building[field]=value; building.updatedAt=new Date().toISOString(); saveDatabase(db);
}
function saveBuildingAudit(visit) { visit.updatedAt=new Date().toISOString(); saveDatabase(db); }

function renderBuilding() {
  const ctx=currentBuildingContext();
  const {visit,farm,building,audit}=ctx;
  app.innerHTML=`<div class="section-title"><div><h2>Bâtiment</h2><div class="muted">Données permanentes, mesures de visite et plan interactif.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
  ${activeVisitBanner(visit)}
  ${!visit?'<section class="empty">Choisissez une visite dans l’onglet Visites.</section>':`
    <section class="card building-selector"><div class="field no-margin"><label>Bâtiment étudié</label><select id="building-select"><option value="">Sélectionner…</option>${farm.buildings.map(b=>`<option value="${b.id}" ${b.id===activeBuildingId?'selected':''}>${escapeHtml(b.name||'Bâtiment')}</option>`).join('')}</select></div><div class="actions"><button class="btn primary" id="add-building">Ajouter un bâtiment</button>${building?'<button class="btn danger" id="delete-building">Supprimer</button>':''}</div></section>
    ${!building?'<section class="empty">Ajoutez un bâtiment pour commencer.</section>':`${buildingTabsHtml()}<section id="building-panel"></section>`}
  `}`;
  document.getElementById('building-select')?.addEventListener('change',e=>{activeBuildingId=e.target.value; localStorage.setItem('audit-bovin-active-building',activeBuildingId); renderBuilding();});
  document.getElementById('add-building')?.addEventListener('click',()=>{
    const name=prompt('Nom du bâtiment :','Bâtiment principal'); if(!name) return;
    const b={id:uid('building'),name,type:'Stabulation libre',orientation:'Non renseignée',ventilation:'Non renseignée',plan:{shapes:[]},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    farm.buildings.push(b); activeBuildingId=b.id; localStorage.setItem('audit-bovin-active-building',b.id); ensureBuildingAudit(visit,b.id); saveDatabase(db); renderBuilding();
  });
  document.getElementById('delete-building')?.addEventListener('click',()=>{if(!confirm('Supprimer ce bâtiment et ses données de cette visite ?'))return; farm.buildings=farm.buildings.filter(b=>b.id!==building.id); delete visit.buildingAudits[building.id]; activeBuildingId=farm.buildings[0]?.id||''; localStorage.setItem('audit-bovin-active-building',activeBuildingId); saveDatabase(db); renderBuilding();});
  app.querySelectorAll('[data-building-tab]').forEach(btn=>btn.onclick=()=>{activeBuildingTab=btn.dataset.buildingTab; localStorage.setItem('audit-bovin-building-tab',activeBuildingTab); renderBuilding();});
  if(building) renderBuildingPanel(ctx);
}

function renderBuildingPanel(ctx){
  const panel=document.getElementById('building-panel'); if(!panel)return;
  const renderers={structure:renderBuildingStructure,plan:renderBuildingPlan,water:renderBuildingWater,electric:renderBuildingElectric,litter:renderBuildingLitter,ambience:renderBuildingAmbience,questionnaire:renderBuildingQuestionnaire};
  renderers[activeBuildingTab]?.(panel,ctx);
}

function renderBuildingStructure(panel,{visit,building}){
  panel.innerHTML=`<section class="card"><h3>Fiche permanente du bâtiment</h3><div class="grid cols-3">
    <div class="field"><label>Nom</label><input data-bfield="name" value="${escapeHtml(building.name||'')}"></div>
    <div class="field"><label>Type</label><select data-bfield="type">${buildingTypes.map(v=>`<option ${building.type===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Année / ancienneté</label><input data-bfield="year" value="${escapeHtml(building.year||'')}"></div>
    <div class="field"><label>Orientation</label><select data-bfield="orientation">${buildingOrientations.map(v=>`<option ${building.orientation===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Ventilation</label><select data-bfield="ventilation">${ventilationTypes.map(v=>`<option ${building.ventilation===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Catégories accueillies</label><input data-bfield="categories" value="${escapeHtml(building.categories||'')}" placeholder="Veaux, génisses, vaches…"></div>
    <div class="field"><label>Longueur (m)</label><input type="number" step="0.1" data-bfield="length" value="${escapeHtml(building.length||'')}"></div>
    <div class="field"><label>Largeur (m)</label><input type="number" step="0.1" data-bfield="width" value="${escapeHtml(building.width||'')}"></div>
    <div class="field"><label>Hauteur / volume</label><input data-bfield="height" value="${escapeHtml(building.height||'')}"></div>
    <div class="field"><label>Sol</label><input data-bfield="floor" value="${escapeHtml(building.floor||'')}"></div>
    <div class="field"><label>Toiture</label><input data-bfield="roof" value="${escapeHtml(building.roof||'')}"></div>
    <div class="field"><label>Bardage / ouvertures</label><input data-bfield="cladding" value="${escapeHtml(building.cladding||'')}"></div>
    <div class="field field-wide"><label>Observations permanentes</label><textarea data-bfield="notes">${escapeHtml(building.notes||'')}</textarea></div>
  </div></section>`;
  panel.querySelectorAll('[data-bfield]').forEach(el=>{const save=()=>saveBuildingPermanent(building,el.dataset.bfield,el.value);el.addEventListener('input',save);el.addEventListener('change',save);el.addEventListener('blur',save);});
}

function planCanvasHtml(){return `<section class="card"><div class="section-title"><div><h3>Plan interactif</h3><div class="muted">Dessinez la structure, les équipements linéaires et les zones. Les objets peuvent être sélectionnés puis redimensionnés dans le panneau de droite.</div></div><span class="badge autosave">Auto</span></div>
  <div class="plan-toolbar plan-toolbar-groups">
    <div class="plan-tool-group"><strong>Dessin</strong><button class="plan-tool active" data-tool="select">↖ Sélection</button><button class="plan-tool" data-tool="free">✏️ Libre</button><button class="plan-tool" data-tool="line">📏 Trait droit</button><button class="plan-tool" data-tool="rect">▭ Rectangle</button><button class="plan-tool" data-tool="text">T Texte</button></div>
    <div class="plan-tool-group"><strong>Objets linéaires</strong><button class="plan-tool" data-tool="cornadis">▥ Cornadis</button><button class="plan-tool" data-tool="barriere">━ Barrière</button><button class="plan-tool" data-tool="passage_homme">🚶 Passage d’homme</button></div>
    <div class="plan-tool-group"><strong>Équipements</strong><button class="plan-tool" data-tool="mangeoire">🥣 Mangeoire</button><button class="plan-tool" data-tool="logette">▱ Logette</button><button class="plan-tool" data-tool="ventilateur">🌀 Ventilateur</button><button class="plan-tool" data-tool="porte">🚪 Porte</button><button class="plan-tool" data-tool="fenetre">▣ Fenêtre</button></div>
    <div class="plan-tool-group"><strong>Zones</strong><button class="plan-tool" data-tool="zone_litter">🛏️ Aire paillée</button><button class="plan-tool" data-tool="zone_feed">🌾 Couloir alimentation</button><button class="plan-tool" data-tool="zone_exercise">🐄 Aire d’exercice</button><button class="plan-tool" data-tool="zone_custom">🏷️ Zone libre</button></div>
    <div class="plan-tool-group"><strong>Mesures liées</strong><button class="plan-tool" data-tool="water">💧 Abreuvoir</button><button class="plan-tool" data-tool="electric">⚡ Point électrique</button><button class="plan-tool" data-tool="litter">🛏️ Litière mesurée</button></div>
    <label class="plan-width">Épaisseur <select id="plan-width"><option value="2">Fine</option><option value="4" selected>Moyenne</option><option value="7">Épaisse</option></select></label>
    <button class="btn small" id="plan-undo">Annuler</button><button class="btn small" id="plan-redo">Rétablir</button><button class="btn small danger" id="plan-delete-selected">Supprimer sélection</button><button class="btn small danger" id="plan-clear">Effacer tout</button>
  </div><div class="plan-layout"><div class="plan-canvas-wrap"><canvas id="building-canvas" width="1000" height="580"></canvas></div><aside id="plan-inspector" class="plan-inspector"><h4>Objet sélectionné</h4><p class="muted">Choisissez l’outil Sélection puis cliquez sur un objet.</p></aside></div><div class="muted small-text">Cornadis, barrières et passages d’homme se dessinent par glisser-déposer. Les zones se dessinent comme des rectangles et peuvent être renommées ou redimensionnées.</div></section>`;}

function renderBuildingPlan(panel,{building,audit,visit}){
  panel.innerHTML=planCanvasHtml(); initPlanCanvas(building,audit,visit);
}

function initPlanCanvas(building,audit,visit){
  const canvas=document.getElementById('building-canvas'); if(!canvas)return; const ctx=canvas.getContext('2d');
  building.plan=building.plan||{shapes:[]}; building.plan.shapes=Array.isArray(building.plan.shapes)?building.plan.shapes:[];
  let tool='select',drawing=false,start=null,temp=null,redo=[],selectedId='',dragOffset=null; const history=building.plan.shapes;
  const point=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}};
  const objectMeta={
    cornadis:{label:'Cornadis',icon:'C',color:'#475569',kind:'linear'},barriere:{label:'Barrière',icon:'B',color:'#6b7280',kind:'linear'},passage_homme:{label:'Passage d’homme',icon:'PH',color:'#7c3aed',kind:'linear'},
    mangeoire:{label:'Mangeoire',icon:'M',color:'#ca8a04',kind:'point'},logette:{label:'Logette',icon:'L',color:'#8b5cf6',kind:'point'},ventilateur:{label:'Ventilateur',icon:'V',color:'#0f766e',kind:'point'},porte:{label:'Porte',icon:'P',color:'#92400e',kind:'point'},fenetre:{label:'Fenêtre',icon:'F',color:'#38bdf8',kind:'point'},
    zone_litter:{label:'Aire paillée',color:'#d6a85f',kind:'zone'},zone_feed:{label:'Couloir alimentation',color:'#d4b44c',kind:'zone'},zone_exercise:{label:'Aire d’exercice',color:'#6ba88a',kind:'zone'},zone_custom:{label:'Zone personnalisée',color:'#94a3b8',kind:'zone'},
    water:{label:'Abreuvoir',icon:'A',color:'#0ea5e9',kind:'point'},electric:{label:'Électricité',icon:'E',color:'#eab308',kind:'point'},litter:{label:'Litière',icon:'Li',color:'#a16207',kind:'zone'}
  };
  const color=t=>({free:'#1f2937',line:'#1f2937',rect:'#1f6f43',text:'#1f2937',...Object.fromEntries(Object.entries(objectMeta).map(([k,v])=>[k,v.color]))}[t]||'#1f2937');
  const meta=s=>objectMeta[s.type]; const isLinear=s=>meta(s)?.kind==='linear'; const isZone=s=>meta(s)?.kind==='zone'; const isPoint=s=>meta(s)?.kind==='point'; const isObject=s=>!!meta(s);
  const drawShape=s=>{ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=s.color||color(s.type);ctx.fillStyle=s.color||color(s.type);ctx.lineWidth=s.width||4;
    if(s.type==='free'){ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}
    if(s.type==='line'||isLinear(s)){ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke();if(isLinear(s)){const mx=(s.x1+s.x2)/2,my=(s.y1+s.y2)/2;ctx.fillStyle='#fff';ctx.strokeStyle=s.color||color(s.type);ctx.lineWidth=1;ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const label=s.label||meta(s).label;const tw=ctx.measureText(label).width+10;ctx.fillRect(mx-tw/2,my-10,tw,20);ctx.strokeRect(mx-tw/2,my-10,tw,20);ctx.fillStyle=s.color||color(s.type);ctx.fillText(label,mx,my);}}
    if(s.type==='rect'){ctx.strokeRect(s.x,s.y,s.w,s.h);}
    if(isZone(s)){ctx.globalAlpha=.22;ctx.fillRect(s.x,s.y,s.w,s.h);ctx.globalAlpha=1;ctx.strokeRect(s.x,s.y,s.w,s.h);ctx.fillStyle='#1f2937';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((s.label||meta(s).label).slice(0,28),s.x+s.w/2,s.y+s.h/2);}
    if(isPoint(s)){const w=s.w||54,h=s.h||38;ctx.globalAlpha=.92;ctx.fillRect(s.x-w/2,s.y-h/2,w,h);ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(meta(s).icon,s.x,s.y-3);ctx.font='10px sans-serif';ctx.fillText((s.label||meta(s).label).slice(0,12),s.x,s.y+12);}
    if(s.type==='text'){ctx.font='18px sans-serif';ctx.fillText(s.text||'',s.x,s.y);}
    if(s.id===selectedId){ctx.save();ctx.strokeStyle='#dc2626';ctx.lineWidth=3;ctx.setLineDash([7,5]);if(isPoint(s)){const w=s.w||54,h=s.h||38;ctx.strokeRect(s.x-w/2-5,s.y-h/2-5,w+10,h+10)}else if(isZone(s)||s.type==='rect')ctx.strokeRect(s.x-4,s.y-4,s.w+8,s.h+8);else if(isLinear(s)||s.type==='line'){ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke()}ctx.restore();}
    ctx.restore();};
  const renderCanvas=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#edf2ef';ctx.lineWidth=1;for(let x=0;x<canvas.width;x+=25){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke()}for(let y=0;y<canvas.height;y+=25){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke()}history.forEach(drawShape);if(temp)drawShape(temp)};
  const persist=()=>{building.updatedAt=new Date().toISOString();saveDatabase(db);renderInspector();renderCanvas()};
  const commit=s=>{if(!s)return;s.id=s.id||uid('shape');history.push(s);redo=[];temp=null;selectedId=s.id;persist();};
  const distanceToSegment=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p.x-a.x,p.y-a.y);let t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;t=Math.max(0,Math.min(1,t));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy))};
  const hit=p=>[...history].reverse().find(s=>{if(isPoint(s))return Math.abs(p.x-s.x)<(s.w||54)/2+8&&Math.abs(p.y-s.y)<(s.h||38)/2+8;if(isZone(s)||s.type==='rect')return p.x>=s.x-7&&p.x<=s.x+s.w+7&&p.y>=s.y-7&&p.y<=s.y+s.h+7;if(isLinear(s)||s.type==='line')return distanceToSegment(p,{x:s.x1,y:s.y1},{x:s.x2,y:s.y2})<12;if(s.type==='text')return Math.abs(p.x-s.x)<80&&Math.abs(p.y-s.y)<24;return false});
  const linkedRow=s=>s.linkKind==='drinker'?audit.drinkers.find(r=>r.id===s.linkId):s.linkKind==='electric'?audit.electric.find(r=>r.id===s.linkId):s.linkKind==='litter'?audit.litters.find(r=>r.id===s.linkId):null;
  const setLinearLength=(s,newLength)=>{const dx=s.x2-s.x1,dy=s.y2-s.y1,old=Math.hypot(dx,dy)||1;const ux=dx/old,uy=dy/old;s.x2=s.x1+ux*newLength;s.y2=s.y1+uy*newLength};
  const renderInspector=()=>{const box=document.getElementById('plan-inspector');if(!box)return;const s=history.find(x=>x.id===selectedId);if(!s){box.innerHTML='<h4>Objet sélectionné</h4><p class="muted">Choisissez l’outil Sélection puis cliquez sur un objet.</p>';return}const row=linkedRow(s);const m=meta(s);const isLin=isLinear(s),isZn=isZone(s),isPt=isPoint(s);const length=isLin?Math.round(Math.hypot(s.x2-s.x1,s.y2-s.y1)):0;box.innerHTML=`<h4>${escapeHtml(s.label||m?.label||s.type)}</h4><div class="field"><label>Libellé / nom de zone</label><input id="shape-label" value="${escapeHtml(s.label||'')}"></div><div class="muted small-text">Type : ${escapeHtml(m?.label||s.type)}</div>${isLin?`<div class="field"><label>Longueur sur le plan</label><input id="shape-length" type="number" min="20" max="950" value="${length}"></div><div class="actions compact"><button class="btn small" id="linear-horizontal">Horizontal</button><button class="btn small" id="linear-vertical">Vertical</button></div>`:''}${isZn||isPt?`<div class="grid cols-2"><div class="field"><label>Largeur</label><input id="shape-w" type="number" min="20" max="950" value="${Math.round(s.w||(isPt?54:150))}"></div><div class="field"><label>Hauteur</label><input id="shape-h" type="number" min="20" max="550" value="${Math.round(s.h||(isPt?38:100))}"></div></div>`:''}${isZn?`<div class="field"><label>Correspondance / usage de la zone</label><select id="shape-zone-type">${['Aire paillée','Couloir d’alimentation','Aire d’exercice','Logettes','Case veaux','Zone de stockage','Aire d’attente','Parc d’isolement','Autre'].map(v=>`<option ${s.zoneType===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Commentaire de zone</label><textarea id="shape-zone-comment">${escapeHtml(s.comment||'')}</textarea></div>`:''}${row?`<div class="plan-linked-summary">${s.linkKind==='drinker'?`Type : ${escapeHtml(row.type||'')}<br>Matériau : ${escapeHtml(row.material||'')}<br>Débit : ${escapeHtml(row.flow||'—')} L/min`:s.linkKind==='electric'?`Valeur : ${escapeHtml(row.value||'—')} ${escapeHtml(row.unit||'')}`:`Zone : ${escapeHtml(row.zone||'')}<br>pH : ${escapeHtml(row.ph||'—')}`}</div><button class="btn primary" id="open-linked-row">Ouvrir la fiche liée</button>`:'<p class="muted">Objet permanent du plan.</p>'}<button class="btn danger" id="delete-shape-inspector">Supprimer cet objet</button>`;
    document.getElementById('shape-label')?.addEventListener('input',e=>{s.label=e.target.value;if(row){if(s.linkKind==='drinker')row.name=e.target.value;if(s.linkKind==='electric')row.equipment=e.target.value;if(s.linkKind==='litter')row.zone=e.target.value;saveBuildingAudit(visit)}persist()});
    document.getElementById('shape-length')?.addEventListener('change',e=>{setLinearLength(s,Math.max(20,Number(e.target.value)||20));persist()});
    document.getElementById('linear-horizontal')?.addEventListener('click',()=>{const len=Math.hypot(s.x2-s.x1,s.y2-s.y1)||120;s.x2=s.x1+len;s.y2=s.y1;persist()});
    document.getElementById('linear-vertical')?.addEventListener('click',()=>{const len=Math.hypot(s.x2-s.x1,s.y2-s.y1)||120;s.x2=s.x1;s.y2=s.y1+len;persist()});
    document.getElementById('shape-w')?.addEventListener('change',e=>{s.w=Math.max(20,Number(e.target.value)||20);persist()});document.getElementById('shape-h')?.addEventListener('change',e=>{s.h=Math.max(20,Number(e.target.value)||20);persist()});
    document.getElementById('shape-zone-type')?.addEventListener('change',e=>{s.zoneType=e.target.value;persist()});document.getElementById('shape-zone-comment')?.addEventListener('input',e=>{s.comment=e.target.value;persist()});
    document.getElementById('delete-shape-inspector').onclick=()=>{const i=history.findIndex(x=>x.id===s.id);if(i>=0)history.splice(i,1);selectedId='';persist()};
    document.getElementById('open-linked-row')?.addEventListener('click',()=>{activeBuildingTab=s.linkKind==='drinker'?'water':s.linkKind==='electric'?'electric':'litter';localStorage.setItem('audit-bovin-building-tab',activeBuildingTab);renderBuilding();setTimeout(()=>document.querySelector(`[data-id="${s.linkId}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),100)});};
  const createLinkedObject=(type,p)=>{let row,label;if(type==='water'){const n=audit.drinkers.length+1;row={id:uid('drinker'),name:`Abreuvoir ${n}`,type:'Bac collectif',material:'Inox',origin:'Réseau'};audit.drinkers.push(row);label=row.name;saveBuildingAudit(visit);commit({type,x:p.x,y:p.y,label,linkKind:'drinker',linkId:row.id,w:60,h:40});}else if(type==='electric'){const n=audit.electric.length+1;row={id:uid('electric'),equipment:`Point électrique ${n}`,unit:'mV',current:'AC'};audit.electric.push(row);label=row.equipment;saveBuildingAudit(visit);commit({type,x:p.x,y:p.y,label,linkKind:'electric',linkId:row.id,w:58,h:40});}};
  const createLinkedLitterZone=(rect)=>{const n=audit.litters.length+1;const row={id:uid('litter'),zone:`Zone litière ${n}`,type:'Paille',quantityUnit:'kg/j'};audit.litters.push(row);saveBuildingAudit(visit);commit({...rect,type:'litter',label:row.zone,zoneType:'Aire paillée',linkKind:'litter',linkId:row.id});};
  document.querySelectorAll('.plan-tool').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.plan-tool').forEach(b=>b.classList.remove('active'));btn.classList.add('active');tool=btn.dataset.tool;});
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);const p=point(e);const width=Number(document.getElementById('plan-width')?.value||4);if(tool==='select'){const s=hit(p);selectedId=s?.id||'';if(s){if(isPoint(s))dragOffset={kind:'point',x:p.x-s.x,y:p.y-s.y};else if(isZone(s)||s.type==='rect')dragOffset={kind:'zone',x:p.x-s.x,y:p.y-s.y};else if(isLinear(s)||s.type==='line')dragOffset={kind:'linear',x:p.x-s.x1,y:p.y-s.y1,x2:s.x2-s.x1,y2:s.y2-s.y1};drawing=true}else dragOffset=null;renderInspector();renderCanvas();return}if(['water','electric'].includes(tool)){createLinkedObject(tool,p);return}if(isPoint({type:tool})){commit({type:tool,x:p.x,y:p.y,label:meta({type:tool}).label,w:54,h:38});return}if(tool==='text'){const text=prompt('Texte à ajouter :');if(text)commit({type:'text',x:p.x,y:p.y,text});return}drawing=true;start=p;if(tool==='free')temp={type:'free',points:[p],width,color:color(tool)};});
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);if(tool==='select'){const s=history.find(x=>x.id===selectedId);if(s&&dragOffset){if(dragOffset.kind==='point'){s.x=p.x-dragOffset.x;s.y=p.y-dragOffset.y}else if(dragOffset.kind==='zone'){s.x=p.x-dragOffset.x;s.y=p.y-dragOffset.y}else if(dragOffset.kind==='linear'){s.x1=p.x-dragOffset.x;s.y1=p.y-dragOffset.y;s.x2=s.x1+dragOffset.x2;s.y2=s.y1+dragOffset.y2}renderCanvas()}return}const width=Number(document.getElementById('plan-width')?.value||4);if(tool==='free')temp.points.push(p);if(tool==='line'||['cornadis','barriere','passage_homme'].includes(tool))temp={type:tool,x1:start.x,y1:start.y,x2:p.x,y2:p.y,width,color:color(tool),label:meta({type:tool})?.label};if(tool==='rect'||['zone_litter','zone_feed','zone_exercise','zone_custom','litter'].includes(tool))temp={type:tool,x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y),width,color:color(tool),label:meta({type:tool})?.label,zoneType:meta({type:tool})?.label};renderCanvas();});
  const finish=()=>{if(!drawing)return;drawing=false;if(tool==='select'){persist();return}if(temp&&(tool==='free'?temp.points.length>1:(isLinear(temp)||temp.type==='line'?Math.hypot(temp.x2-temp.x1,temp.y2-temp.y1)>8:(isZone(temp)||temp.type==='rect'?temp.w>8&&temp.h>8:true)))){if(tool==='litter')createLinkedLitterZone(temp);else commit(temp)}else{temp=null;renderCanvas()}};canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  document.getElementById('plan-undo').onclick=()=>{const s=history.pop();if(s)redo.push(s);selectedId='';persist()};document.getElementById('plan-redo').onclick=()=>{const s=redo.pop();if(s)history.push(s);persist()};document.getElementById('plan-delete-selected').onclick=()=>{if(!selectedId)return;const i=history.findIndex(x=>x.id===selectedId);if(i>=0)history.splice(i,1);selectedId='';persist()};document.getElementById('plan-clear').onclick=()=>{if(confirm('Effacer tout le plan ?')){redo.push(...history.splice(0));selectedId='';persist()}};
  renderCanvas();renderInspector();planRuntime={renderCanvas};
}

function rowInput(value,attrs=''){return `<input ${attrs} value="${escapeHtml(value??'')}">`}
function renderBuildingWater(panel,{visit,audit}){
  panel.innerHTML=`<section class="card"><div class="section-title"><div><h3>Eau et abreuvoirs</h3><div class="muted">Une ligne par point d’eau. Les éléments posés sur le plan apparaissent automatiquement ici.</div></div><button class="btn primary" id="add-drinker">Ajouter un abreuvoir</button></div>${audit.drinkers.length?`<div class="table-wrap"><table class="building-table"><thead><tr><th>Nom</th><th>Type</th><th>Matériau</th><th>Catégorie</th><th>Origine</th><th>Position</th><th>Animaux desservis</th><th>Débit L/min</th><th>Hauteur cm</th><th>Volume L</th><th>Temp. °C</th><th>pH</th><th>Redox</th><th>Conductivité</th><th>Nitrates</th><th>Accessibilité</th><th>Concurrence</th><th>Antigel</th><th>État / fuites</th><th>Nettoyage</th><th>Commentaire</th><th></th></tr></thead><tbody>${audit.drinkers.map(r=>`<tr><td>${rowInput(r.name,`data-drinker-field="name" data-id="${r.id}"`)}</td><td><select data-drinker-field="type" data-id="${r.id}">${drinkerTypes.map(v=>`<option ${r.type===v?'selected':''}>${v}</option>`).join('')}</select></td><td><select data-drinker-field="material" data-id="${r.id}">${drinkerMaterials.map(v=>`<option ${r.material===v?'selected':''}>${v}</option>`).join('')}</select></td><td>${rowInput(r.category,`data-drinker-field="category" data-id="${r.id}"`)}</td><td><select data-drinker-field="origin" data-id="${r.id}">${waterOrigins.map(v=>`<option ${r.origin===v?'selected':''}>${v}</option>`).join('')}</select></td><td>${rowInput(r.position,`data-drinker-field="position" data-id="${r.id}"`)}</td><td>${rowInput(r.animalsServed,`type="number" step="1" data-drinker-field="animalsServed" data-id="${r.id}"`)}</td>${['flow','height','volume','temperature','ph','redox','conductivity','nitrates'].map(f=>`<td>${rowInput(r[f],`type="number" step="any" inputmode="decimal" data-drinker-field="${f}" data-id="${r.id}"`)}</td>`).join('')}<td><select data-drinker-field="accessibility" data-id="${r.id}">${['','Bonne','Moyenne','Insuffisante'].map(v=>`<option ${r.accessibility===v?'selected':''}>${v||'Non renseignée'}</option>`).join('')}</select></td><td><select data-drinker-field="competition" data-id="${r.id}">${['','Non','Oui','Non observée'].map(v=>`<option ${r.competition===v?'selected':''}>${v||'Non renseignée'}</option>`).join('')}</select></td><td><select data-drinker-field="antifreeze" data-id="${r.id}">${['','Oui','Non','Non concerné'].map(v=>`<option ${r.antifreeze===v?'selected':''}>${v||'Non renseigné'}</option>`).join('')}</select></td><td>${rowInput(r.condition,`data-drinker-field="condition" data-id="${r.id}"`)}</td><td>${rowInput(r.cleaning,`data-drinker-field="cleaning" data-id="${r.id}"`)}</td><td><textarea data-drinker-field="comment" data-id="${r.id}">${escapeHtml(r.comment||'')}</textarea></td><td><button class="btn small danger" data-delete-drinker="${r.id}">Suppr.</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Aucun abreuvoir renseigné.</div>'}</section>`;
  document.getElementById('add-drinker').onclick=()=>{audit.drinkers.push({id:uid('drinker'),name:`Abreuvoir ${audit.drinkers.length+1}`,type:'Bac collectif',material:'Inox',origin:'Réseau'});saveBuildingAudit(visit);renderBuildingWater(panel,currentBuildingContext())};
  panel.querySelectorAll('[data-drinker-field]').forEach(el=>{const save=()=>{const r=audit.drinkers.find(x=>x.id===el.dataset.id);if(r){r[el.dataset.drinkerField]=el.value;const ctx=currentBuildingContext();const shape=ctx.building?.plan?.shapes?.find(s=>s.linkKind==='drinker'&&s.linkId===r.id);if(shape&&el.dataset.drinkerField==='name')shape.label=el.value;saveBuildingAudit(visit);if(shape)saveDatabase(db)}};el.addEventListener('input',save);el.addEventListener('change',save);el.addEventListener('blur',save)});panel.querySelectorAll('[data-delete-drinker]').forEach(b=>b.onclick=()=>{audit.drinkers=audit.drinkers.filter(x=>x.id!==b.dataset.deleteDrinker);const ctx=currentBuildingContext();if(ctx.building?.plan?.shapes)ctx.building.plan.shapes=ctx.building.plan.shapes.filter(s=>!(s.linkKind==='drinker'&&s.linkId===b.dataset.deleteDrinker));saveBuildingAudit(visit);renderBuildingWater(panel,currentBuildingContext())});
}

function renderBuildingElectric(panel,{visit,audit}){
  panel.innerHTML=`<section class="card"><div class="section-title"><div><h3>Mesures électriques</h3><div class="muted">Abreuvoirs, barrières, cornadis, auges, logettes…</div></div><button class="btn primary" id="add-electric">Ajouter une mesure</button></div>${audit.electric.length?`<div class="table-wrap"><table class="building-table"><thead><tr><th>Équipement</th><th>Localisation</th><th>Valeur</th><th>Unité</th><th>AC / DC</th><th>Conditions</th><th>Correction</th><th>Valeur après</th><th>Commentaire</th><th></th></tr></thead><tbody>${audit.electric.map(r=>`<tr><td>${rowInput(r.equipment,`data-electric-field="equipment" data-id="${r.id}"`)}</td><td>${rowInput(r.location,`data-electric-field="location" data-id="${r.id}"`)}</td><td>${rowInput(r.value,`type="number" step="any" inputmode="decimal" data-electric-field="value" data-id="${r.id}"`)}</td><td><select data-electric-field="unit" data-id="${r.id}">${['mV','V','µA','mA'].map(v=>`<option ${r.unit===v?'selected':''}>${v}</option>`).join('')}</select></td><td><select data-electric-field="current" data-id="${r.id}">${['AC','DC','Non précisé'].map(v=>`<option ${r.current===v?'selected':''}>${v}</option>`).join('')}</select></td><td>${rowInput(r.conditions,`data-electric-field="conditions" data-id="${r.id}"`)}</td><td>${rowInput(r.correction,`data-electric-field="correction" data-id="${r.id}"`)}</td><td>${rowInput(r.after,`type="number" step="any" data-electric-field="after" data-id="${r.id}"`)}</td><td><textarea data-electric-field="comment" data-id="${r.id}">${escapeHtml(r.comment||'')}</textarea></td><td><button class="btn small danger" data-delete-electric="${r.id}">Suppr.</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Aucune mesure électrique.</div>'}</section>`;
  document.getElementById('add-electric').onclick=()=>{audit.electric.push({id:uid('electric'),equipment:'Abreuvoir',unit:'mV',current:'AC'});saveBuildingAudit(visit);renderBuildingElectric(panel,currentBuildingContext())};
  panel.querySelectorAll('[data-electric-field]').forEach(el=>{const save=()=>{const r=audit.electric.find(x=>x.id===el.dataset.id);if(r){r[el.dataset.electricField]=el.value;saveBuildingAudit(visit)}};el.addEventListener('input',save);el.addEventListener('change',save);el.addEventListener('blur',save)});panel.querySelectorAll('[data-delete-electric]').forEach(b=>b.onclick=()=>{audit.electric=audit.electric.filter(x=>x.id!==b.dataset.deleteElectric);saveBuildingAudit(visit);renderBuildingElectric(panel,currentBuildingContext())});
}

function renderBuildingLitter(panel,{visit,audit}){
  panel.innerHTML=`<section class="card"><div class="section-title"><div><h3>Litière et paillage</h3><div class="muted">Une ligne par zone ou lot.</div></div><button class="btn primary" id="add-litter">Ajouter une zone</button></div>${audit.litters.length?`<div class="table-wrap"><table class="building-table"><thead><tr><th>Zone / lot</th><th>Type</th><th>pH</th><th>Redox</th><th>Temp. °C</th><th>Humidité %</th><th>Épaisseur cm</th><th>Fréquence paillage</th><th>Quantité</th><th>Unité</th><th>Curage</th><th>Nettoyage</th><th>Désinfection</th><th>Taux vibratoire</th><th>Failles</th><th>Commentaire</th><th></th></tr></thead><tbody>${audit.litters.map(r=>`<tr><td>${rowInput(r.zone,`data-litter-field="zone" data-id="${r.id}"`)}</td><td><select data-litter-field="type" data-id="${r.id}">${litterTypes.map(v=>`<option ${r.type===v?'selected':''}>${v}</option>`).join('')}</select></td>${['ph','redox','temperature','humidity','thickness'].map(f=>`<td>${rowInput(r[f],`type="number" step="any" inputmode="decimal" data-litter-field="${f}" data-id="${r.id}"`)}</td>`).join('')}<td>${rowInput(r.beddingFrequency,`data-litter-field="beddingFrequency" data-id="${r.id}"`)}</td><td>${rowInput(r.quantity,`type="number" step="any" data-litter-field="quantity" data-id="${r.id}"`)}</td><td><select data-litter-field="quantityUnit" data-id="${r.id}">${['kg/j','kg/semaine','bottes/j','bottes/semaine','Autre'].map(v=>`<option ${r.quantityUnit===v?'selected':''}>${v}</option>`).join('')}</select></td><td>${rowInput(r.cleanout,`data-litter-field="cleanout" data-id="${r.id}"`)}</td><td>${rowInput(r.cleaning,`data-litter-field="cleaning" data-id="${r.id}"`)}</td><td>${rowInput(r.disinfection,`data-litter-field="disinfection" data-id="${r.id}"`)}</td><td>${rowInput(r.vibration,`type="number" step="any" data-litter-field="vibration" data-id="${r.id}"`)}</td><td>${rowInput(r.cracks,`data-litter-field="cracks" data-id="${r.id}"`)}</td><td><textarea data-litter-field="comment" data-id="${r.id}">${escapeHtml(r.comment||'')}</textarea></td><td><button class="btn small danger" data-delete-litter="${r.id}">Suppr.</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Aucune zone de litière.</div>'}</section>`;
  document.getElementById('add-litter').onclick=()=>{audit.litters.push({id:uid('litter'),zone:`Zone ${audit.litters.length+1}`,type:'Paille',quantityUnit:'kg/j'});saveBuildingAudit(visit);renderBuildingLitter(panel,currentBuildingContext())};
  panel.querySelectorAll('[data-litter-field]').forEach(el=>{const save=()=>{const r=audit.litters.find(x=>x.id===el.dataset.id);if(r){r[el.dataset.litterField]=el.value;saveBuildingAudit(visit)}};el.addEventListener('input',save);el.addEventListener('change',save);el.addEventListener('blur',save)});panel.querySelectorAll('[data-delete-litter]').forEach(b=>b.onclick=()=>{audit.litters=audit.litters.filter(x=>x.id!==b.dataset.deleteLitter);saveBuildingAudit(visit);renderBuildingLitter(panel,currentBuildingContext())});
}

function renderBuildingAmbience(panel,{visit,audit}){
  const a=audit.ambience;
  panel.innerHTML=`<section class="card"><h3>Ambiance du bâtiment</h3><div class="grid cols-3">${[['temperature','Température °C'],['humidity','Hygrométrie %'],['co2','CO₂ ppm'],['nh3','NH₃ ppm'],['light','Luminosité'],['noise','Bruit'],['airSpeed','Vitesse d’air'],['odor','Odeurs'],['flies','Mouches / nuisibles']].map(([k,l])=>`<div class="field"><label>${l}</label><input data-ambience="${k}" value="${escapeHtml(a[k]||'')}"></div>`).join('')}<div class="field field-wide"><label>Observations</label><textarea data-ambience="comment">${escapeHtml(a.comment||'')}</textarea></div></div></section>`;
  panel.querySelectorAll('[data-ambience]').forEach(el=>{const save=()=>{a[el.dataset.ambience]=el.value;saveBuildingAudit(visit)};el.addEventListener('input',save);el.addEventListener('change',save);el.addEventListener('blur',save)});
}

function renderBuildingQuestionnaire(panel,{visit,audit}){
  panel.innerHTML=`<div class="section-title"><div><h3>Questionnaire bâtiment</h3><div class="muted">Les thèmes sont repliés. Ouvrez-les au fur et à mesure.</div></div></div><div class="question-groups">${buildingQuestionGroups.map(([group,questions],gi)=>`<details class="card question-group"><summary><strong>${escapeHtml(group)}</strong><span class="muted">${questions.filter(q=>audit.questionnaire[q]?.status).length}/${questions.length} renseigné(s)</span></summary><div class="question-list">${questions.map(q=>{const item=audit.questionnaire[q]||{};return `<div class="question-row"><div><strong>${escapeHtml(q)}</strong><input class="question-comment" data-qcomment="${escapeHtml(q)}" value="${escapeHtml(item.comment||'')}" placeholder="Commentaire"></div><select data-qstatus="${escapeHtml(q)}"><option value="">Non renseigné</option>${['Satisfaisant','À surveiller','À corriger','Non concerné'].map(v=>`<option ${item.status===v?'selected':''}>${v}</option>`).join('')}</select></div>`}).join('')}</div></details>`).join('')}</div>`;
  panel.querySelectorAll('[data-qstatus]').forEach(el=>el.addEventListener('change',()=>{const q=el.dataset.qstatus;audit.questionnaire[q]=audit.questionnaire[q]||{};audit.questionnaire[q].status=el.value;saveBuildingAudit(visit);renderBuildingQuestionnaire(panel,currentBuildingContext())}));
  panel.querySelectorAll('[data-qcomment]').forEach(el=>{const save=()=>{const q=el.dataset.qcomment;audit.questionnaire[q]=audit.questionnaire[q]||{};audit.questionnaire[q].comment=el.value;saveBuildingAudit(visit)};el.addEventListener('input',save);el.addEventListener('blur',save)});
}

function renderBackup() {
  app.innerHTML = `
    <div class="section-title"><h2>Sauvegarde et transfert</h2></div>
    <section class="grid cols-2">
      <article class="card"><h3>Enregistrer toute la base</h3><p class="muted">Exporte toutes les exploitations, visites et sujets dans un fichier JSON.</p><button class="btn primary" id="export-db">Télécharger la sauvegarde complète</button></article>
      <article class="card"><h3>Ouvrir une sauvegarde</h3><p class="muted">Remplace la base locale par le contenu d’un fichier JSON précédemment exporté.</p><button class="btn" id="import-db">Choisir un fichier JSON</button></article>
      <article class="card"><h3>État de la sauvegarde locale</h3><p>Dernière modification : <strong>${formatDateTime(db.updatedAt)}</strong></p><p class="muted">La base est enregistrée automatiquement à chaque création ou modification.</p></article>
      <article class="card"><h3>Réinitialiser</h3><p class="muted">Efface toutes les exploitations, visites et sujets de cet appareil.</p><button class="btn danger" id="reset-db">Tout effacer</button></article>
    </section>`;
  document.getElementById('export-db').onclick = () => downloadJson(`audit-bovin-sauvegarde-${new Date().toISOString().slice(0,10)}.json`, db);
  document.getElementById('import-db').onclick = () => fileInput.click();
  document.getElementById('reset-db').onclick = () => {
    if (confirm('Effacer définitivement toutes les données de cet appareil ?')) { db = replaceDatabase({ farms: [], visits: [] }); clearDraft(); setActiveVisit(''); showToast('Base locale effacée.'); renderBackup(); }
  };
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.farm && parsed.visit) {
      const farm = parsed.farm;
      const existingFarm = db.farms.find(f => f.id === farm.id) || db.farms.find(f => f.name.toLowerCase() === farm.name.toLowerCase());
      const farmId = existingFarm?.id || farm.id || uid('farm');
      if (!existingFarm) db.farms.push({ ...farm, id: farmId });
      db.visits = db.visits.filter(v => v.id !== parsed.visit.id);
      db.visits.push({ ...parsed.visit, farmId, subjects: Array.isArray(parsed.visit.subjects) ? parsed.visit.subjects : [] });
      setActiveVisit(parsed.visit.id);
      saveDatabase(db);
      showToast('Visite importée.');
    } else if (Array.isArray(parsed.farms) && Array.isArray(parsed.visits)) {
      db = replaceDatabase(parsed);
      migrateDatabase();
      showToast('Sauvegarde complète restaurée.');
    } else {
      throw new Error('Format non reconnu');
    }
    render();
  } catch (error) {
    console.error(error);
    alert('Ce fichier JSON ne correspond pas à une sauvegarde Audit Bovin valide.');
  } finally {
    fileInput.value = '';
  }
});

window.addEventListener('error', event => {
  console.error(event.error || event.message);
  const errorBox = document.createElement('div');
  errorBox.className = 'card notice warning';
  errorBox.innerHTML = `<strong>Une erreur a été détectée.</strong><br><span class="muted">${escapeHtml(event.message || 'Erreur inconnue')}</span>`;
  app.prepend(errorBox);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
render();
