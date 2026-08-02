import { loadDatabase, saveDatabase, loadDraft, saveDraft, clearDraft, replaceDatabase } from './storage.js';
import { uid, formatDate, formatDateTime, escapeHtml, downloadJson, slugify } from './utils.js';
import { THRESHOLDS, CATEGORY_RULE_MAP } from './analysis-rules.js';

let db = loadDatabase();
let currentView = 'dashboard';
let editingVisitId = null;
let activeAnimalVisitId = localStorage.getItem('audit-bovin-active-animal-visit') || '';
let openSubjectId = null;
let activeAnalysisVisitId = localStorage.getItem('audit-bovin-active-analysis-visit') || '';
let activeAnalysisSection = localStorage.getItem('audit-bovin-active-analysis-section') || 'numeric';
let activeAnalysisFamily = localStorage.getItem('audit-bovin-active-analysis-family') || 'Urines';
const app = document.getElementById('app');
const fileInput = document.getElementById('json-file-input');

const visitTypes = ['Bilan 5MVet', 'Audit complet', 'Visite métabolique', 'Audit bâtiment', 'Audit alimentation', 'Audit sanitaire', 'Audit vêlage', 'Audit veaux', 'Suivi', 'Autre'];
const categories = ['Non classé', 'Veau 0–15 jours', 'Veau 15–60 jours', 'Génisse', 'Engraissement', 'Préparation vêlage', 'Tarie', 'Fraîche vêlée', 'Début lactation', 'Pic de lactation', 'Milieu lactation', 'Fin lactation', 'Vache allaitante', 'Autre'];
const physiologicalStages = ['Non renseigné', 'Vide', 'Synchronisation des chaleurs', 'Pleine', 'Lactation'];
const measurementFamilies = [
  ['urine', 'Urines', '🟡'], ['blood', 'Sang', '🔴'], ['feces', 'Bouses', '🟤'],
  ['physical', 'Observations physiques', '🟢'], ['milk', 'Lait', '🔵'], ['colostrum', 'Colostrum', '🟣']
];

function migrateDatabase() {
  db.farms = Array.isArray(db.farms) ? db.farms : [];
  db.visits = Array.isArray(db.visits) ? db.visits : [];
  db.visits.forEach(visit => {
    visit.subjects = Array.isArray(visit.subjects) ? visit.subjects : [];
    visit.subjects.forEach(subject => {
      subject.measurements = subject.measurements && typeof subject.measurements === 'object' ? subject.measurements : {};
      subject.measurements.analysis = subject.measurements.analysis && typeof subject.measurements.analysis === 'object' ? subject.measurements.analysis : {};
    });
  });
  if (activeAnimalVisitId && !db.visits.some(v => v.id === activeAnimalVisitId)) activeAnimalVisitId = '';
  if (activeAnalysisVisitId && !db.visits.some(v => v.id === activeAnalysisVisitId)) activeAnalysisVisitId = '';
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

function render() {
  const renderers = { dashboard: renderDashboard, farms: renderFarms, visits: renderVisits, animals: renderAnimals, analysis: renderAnalysis, backup: renderBackup };
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
      activeAnimalVisitId = visit.id;
      localStorage.setItem('audit-bovin-active-animal-visit', visit.id);
      showToast('Visite créée.');
    }
    saveDatabase(db); clearDraft(); editingVisitId = null; renderVisits();
  });
  document.getElementById('cancel-edit')?.addEventListener('click', () => { editingVisitId = null; clearDraft(); renderVisits(); });
  app.querySelectorAll('[data-edit-visit]').forEach(button => button.onclick = () => { editingVisitId = button.dataset.editVisit; clearDraft(); renderVisits(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  app.querySelectorAll('[data-open-animals]').forEach(button => button.onclick = () => {
    activeAnimalVisitId = button.dataset.openAnimals;
    localStorage.setItem('audit-bovin-active-animal-visit', activeAnimalVisitId);
    setView('animals');
  });
  app.querySelectorAll('[data-export-visit]').forEach(button => button.onclick = () => {
    const visit = db.visits.find(v => v.id === button.dataset.exportVisit);
    downloadJson(`${slugify(farmName(visit.farmId))}-${visit.date || 'visite'}.json`, { schemaVersion: 2, farm: db.farms.find(f => f.id === visit.farmId), visit });
  });
  app.querySelectorAll('[data-delete-visit]').forEach(button => button.onclick = () => {
    if (confirm('Supprimer cette visite et tous ses sujets ?')) {
      db.visits = db.visits.filter(v => v.id !== button.dataset.deleteVisit);
      if (activeAnimalVisitId === button.dataset.deleteVisit) activeAnimalVisitId = '';
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
    <section class="measurement-overview"><h4>Suivi des mesures</h4><div class="measure-chips">${measurementFamilies.map(([key,label,icon]) => { const status = measurementStatus(subject,key); return `<span class="measure-chip ${status}">${icon} ${label}<small>${status === 'complete' ? 'Fait' : status === 'partial' ? 'Partiel' : 'Non réalisé'}</small></span>`; }).join('')}</div><p class="muted small-text">La saisie détaillée des mesures sera ajoutée dans le module suivant. Les emplacements sont déjà réservés dans la fiche du sujet.</p></section>
    <div class="actions subject-actions"><span class="autosave-indicator">✓ Enregistrement automatique</span><button type="button" class="btn danger" data-delete-subject="${subject.id}">Supprimer le sujet</button></div>
  </form>`;
}

function renderAnimals() {
  const visits = db.visits.slice().sort((a,b) => (b.date || '').localeCompare(a.date || ''));
  if (!activeAnimalVisitId && visits.length) activeAnimalVisitId = visits[0].id;
  const visit = db.visits.find(v => v.id === activeAnimalVisitId);
  app.innerHTML = `
    <div class="section-title"><div><h2>Animaux / sujets de la visite</h2><div class="muted">Saisir d’abord le numéro de boucle et l’emplacement. Le classement peut être complété plus tard.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
    <section class="card animal-visit-selector">
      <div class="field no-margin"><label for="animal-visit-select">Visite active</label><select id="animal-visit-select"><option value="">Sélectionner une visite…</option>${visits.map(v => `<option value="${v.id}" ${v.id === activeAnimalVisitId ? 'selected' : ''}>${escapeHtml(visitLabel(v))}</option>`).join('')}</select></div>
      ${visit ? `<div class="visit-meta"><strong>${escapeHtml(farmName(visit.farmId))}</strong><span>${formatDate(visit.date)}</span><span>${escapeHtml(visit.type || '')}</span><span>${visit.subjects?.length || 0} sujet(s)</span></div>` : ''}
    </section>
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

  document.getElementById('animal-visit-select').addEventListener('change', event => {
    activeAnimalVisitId = event.target.value;
    localStorage.setItem('audit-bovin-active-animal-visit', activeAnimalVisitId);
    openSubjectId = null;
    renderAnimals();
  });

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
    ['category','Catégorie','select',['Veaux','Engraissement','Génisses','Vaches en production','Taries','Autre']],
    ['represented','Nombre d’animaux représentés','number'], ['total','Poids total (g)','number'], ['t1','Tamis 1 — 5 mm (g)','number'], ['t2','Tamis 2 — 2 mm (g)','number'], ['comment','Commentaire','text']
  ]},
  silos: { title:'Silos / ensilages', icon:'🌽', fields:[
    ['name','Nom / repère','text'], ['type','Type','select',['Ensilage maïs','Ensilage herbe','Méteil','Silo couloir','Silo boudin','Autre']], ['ph','pH','number'], ['redox','Redox','number'], ['dm','MS (%)','number'],
    ['earing','Stade','select',['Épié','Non épié','Non renseigné']], ['mowTime','Heure de fauche','time'], ['mowHeight','Hauteur de fauche (cm)','number'],
    ['conditioned','Conditionnement','select',['Conditionné','Non conditionné','Non renseigné']], ['preservative','Conservateur','text'], ['doubleCover','Bâchage','select',['Double bâche','Bâche simple','Autre']], ['comment','Réalisation / stockage / distribution','text']
  ]},
  soils: { title:'Sol', icon:'🌱', fields:[
    ['name','Parcelle / repère','text'], ['type','Type de sol','select',['Argileux','Limoneux','Sableux','Argilo-limoneux','Limono-argileux','Calcaire','Hydromorphe','Tourbeux','Autre']], ['ph','pH','number'], ['redox','Redox','number'], ['conditions','Conditions de mesure','text'], ['fertilization','Fertilisation / amendements','text'], ['comment','Observation','text']
  ]},
  plants: { title:'Plantes / herbe', icon:'🌾', fields:[
    ['name','Parcelle / plante','text'], ['weather','Météo','multi',['Ensoleillé','Couvert','Pluie récente','Pluie en cours','Chaud','Sec','Froid','Venté','Rosée','Autre']], ['time','Heure de mesure','time'],
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
  const params = analysisParameters.filter(p => p.group === activeAnalysisFamily);
  const subjectWidth = 150;
  const categoryWidth = 170;
  const valueWidth = activeAnalysisFamily === 'Physique' ? 150 : 118;
  const commentWidth = 280;
  return `<section class="card"><div class="section-title"><div><h3>Mesures numériques par famille</h3><span class="muted">Les sujets sont repris automatiquement. La valeur est sauvegardée quand vous quittez la cellule.</span></div><span class="analysis-legend"><i class="green"></i> Référence <i class="yellow"></i> Vigilance <i class="red"></i> Écart <i class="grey"></i> En attente</span></div><nav class="family-tabs">${families.map(f=>`<button class="family-tab ${activeAnalysisFamily===f?'active':''}" data-analysis-family="${f}">${f}</button>`).join('')}</nav><div class="table-wrap analysis-table-wrap"><table class="analysis-table family-matrix"><colgroup><col style="width:${subjectWidth}px"><col style="width:${categoryWidth}px">${params.map(()=>`<col style="width:${valueWidth}px">`).join('')}<col style="width:${commentWidth}px"></colgroup><thead><tr><th class="sticky-col">Sujet</th><th class="sticky-col-2">Catégorie</th>${params.map(p=>`<th>${escapeHtml(p.short)}</th>`).join('')}<th class="comment-head">Commentaire / observation</th></tr></thead><tbody>${visit.subjects.map(subject=>`<tr><td class="sticky-col"><strong>${escapeHtml(subject.tag||'Sujet')}</strong><br><small>${escapeHtml(subject.location||'')}</small></td><td class="sticky-col-2"><span class="badge ${subject.category&&subject.category!=='Non classé'?'complete':'unclassified'}">${escapeHtml(subject.category||'Non classé')}</span></td>${params.map(p=>analysisCell(subject,p)).join('')}<td class="matrix-comment-cell"><textarea class="matrix-comment" data-family-comment data-subject-id="${subject.id}" data-family="${activeAnalysisFamily}" placeholder="Commentaire libre…">${escapeHtml(subject.measurements.comments?.[activeAnalysisFamily]||'')}</textarea></td></tr>`).join('')}</tbody></table></div></section>`;
}

function obsControl(subject,field) { const data=subject.measurements.observations||{}; const current=data[field.key]; if(field.type==='number')return `<input data-observation data-subject-id="${subject.id}" data-key="${field.key}" type="number" step="${field.step||'1'}" value="${escapeHtml(current??'')}"/>`; if(field.type==='text')return `<input data-observation data-subject-id="${subject.id}" data-key="${field.key}" value="${escapeHtml(current??'')}"/>`; if(field.type==='single')return `<select data-observation data-subject-id="${subject.id}" data-key="${field.key}"><option value="">—</option>${field.options.map(o=>`<option ${current===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select>`; const selected=Array.isArray(current)?current:[]; return `<div class="chip-options">${field.options.map(o=>`<label class="choice-chip ${selected.includes(o)?'selected':''}"><input type="checkbox" data-observation-multi data-subject-id="${subject.id}" data-key="${field.key}" value="${escapeHtml(o)}" ${selected.includes(o)?'checked':''}/>${escapeHtml(o)}</label>`).join('')}</div>`; }
function renderObservationsSection(visit) { return `<div class="subject-observation-list">${visit.subjects.map((s,i)=>`<details class="card observation-card" ${i===0?'open':''}><summary><strong>${escapeHtml(s.tag||`Sujet ${i+1}`)}</strong><span>${escapeHtml(s.category||'Non classé')} · ${escapeHtml(s.location||'')}</span></summary><div class="observation-grid">${observationFields.map(f=>`<div class="field"><label>${escapeHtml(f.label)}</label>${obsControl(s,f)}</div>`).join('')}</div></details>`).join('')}</div>`; }
function generalField(record,configKey,field) { const [key,label,type,options]=field; const value=record[key]??''; if(type==='select')return `<div class="field"><label>${label}</label><select data-general-field data-kind="${configKey}" data-id="${record.id}" data-key="${key}"><option value="">—</option>${options.map(o=>`<option ${value===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div>`; if(type==='multi'){const selected=Array.isArray(value)?value:[];return `<div class="field field-wide"><label>${label}</label><div class="chip-options">${options.map(o=>`<label class="choice-chip ${selected.includes(o)?'selected':''}"><input type="checkbox" data-general-multi data-kind="${configKey}" data-id="${record.id}" data-key="${key}" value="${escapeHtml(o)}" ${selected.includes(o)?'checked':''}/>${escapeHtml(o)}</label>`).join('')}</div></div>`;} return `<div class="field ${type==='text'&&key==='comment'?'field-wide':''}"><label>${label}</label><input data-general-field data-kind="${configKey}" data-id="${record.id}" data-key="${key}" type="${type}" ${type==='number'?'step="any" inputmode="decimal"':''} value="${escapeHtml(value)}"/></div>`; }
function renderGeneralSection(visit) { return `<div class="general-measure-groups">${Object.entries(generalConfigs).map(([kind,cfg])=>`<section class="card"><div class="section-title"><div><h3>${cfg.icon} ${cfg.title}</h3><span class="muted">Plusieurs relevés possibles.</span></div><button class="btn primary" data-add-general="${kind}">Ajouter un relevé</button></div><div class="general-records">${visit.analysisGeneral[kind].length?visit.analysisGeneral[kind].map((r,i)=>`<article class="general-record"><div class="section-title"><strong>${escapeHtml(cfg.title)} ${i+1}</strong><button class="btn small danger" data-remove-general="${kind}" data-id="${r.id}">Supprimer</button></div><div class="general-grid">${cfg.fields.map(f=>generalField(r,kind,f)).join('')}${kind==='tamis'?`<div class="calculated-box"><strong>Pourcentages automatiques</strong><span>Tamis 1 : ${numericValue(r.total)>0&&numericValue(r.t1)!==null?(100*numericValue(r.t1)/numericValue(r.total)).toFixed(1):'—'} %</span><span>Tamis 2 : ${numericValue(r.total)>0&&numericValue(r.t2)!==null?(100*numericValue(r.t2)/numericValue(r.total)).toFixed(1):'—'} %</span></div>`:''}</div></article>`).join(''):`<div class="empty">Aucun relevé.</div>`}</div></section>`).join('')}</div>`; }
function suggestedActions(visit) { const out=[]; categoryAnalysis(visit).forEach(g=>interpretationItems(g).filter(i=>i.level!=='good').forEach(i=>out.push({category:g.category,...i}))); return out; }
function renderSynthesisSection(visit) { const suggestions=suggestedActions(visit); return `<div id="analysis-summary">${renderAnalysisSummary(visit)}</div><section class="card" style="margin-top:16px"><div class="section-title"><div><h3>Plan d’action</h3><span class="muted">Propositions issues des écarts. Le technicien valide et reformule.</span></div><button class="btn" id="add-custom-action">Ajouter une action libre</button></div><div class="action-suggestions">${suggestions.length?suggestions.map((a,i)=>`<div class="action-line"><span class="badge ${a.level==='danger'?'in-progress':'archived'}">${a.level==='danger'?'Priorité haute':'À surveiller'}</span><div><strong>${escapeHtml(a.category)} — ${escapeHtml(a.theme)}</strong><br><span>${escapeHtml(a.action)}</span></div><button class="btn small" data-accept-action="${i}">Ajouter</button></div>`).join(''):'<div class="empty">Aucune action automatique proposée à ce stade.</div>'}</div><div class="action-list">${visit.analysisActions.length?visit.analysisActions.map(a=>`<div class="action-edit"><select data-action-field="status" data-action-id="${a.id}"><option ${a.status==='À faire'?'selected':''}>À faire</option><option ${a.status==='En cours'?'selected':''}>En cours</option><option ${a.status==='Réalisé'?'selected':''}>Réalisé</option></select><input data-action-field="text" data-action-id="${a.id}" value="${escapeHtml(a.text||'')}"/><input data-action-field="responsible" data-action-id="${a.id}" placeholder="Responsable" value="${escapeHtml(a.responsible||'')}"/><button class="btn small danger" data-remove-action="${a.id}">×</button></div>`).join(''):''}</div></section>`; }
function renderAnalysis() {
  const visits=db.visits.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')); if(!activeAnalysisVisitId&&visits.length)activeAnalysisVisitId=visits[0].id; const visit=db.visits.find(v=>v.id===activeAnalysisVisitId); if(visit)ensureAnalysisVisit(visit);
  const tabs=[['numeric','Matrices par famille'],['observations','Observations'],['general','Tamis · Silos · Sol · Plantes'],['reasoning','Raisonnement'],['summary','Statistiques & actions']];
  app.innerHTML=`<div class="section-title"><div><h2>Analyse complète</h2><div class="muted">Mesures, observations, relevés généraux et synthèse croisée. Aide à l’interprétation, sans valeur diagnostique.</div></div><span class="badge autosave">Sauvegarde automatique</span></div><section class="card analysis-toolbar"><div class="field no-margin"><label>Visite analysée</label><select id="analysis-visit-select"><option value="">Sélectionner…</option>${visits.map(v=>`<option value="${v.id}" ${v.id===activeAnalysisVisitId?'selected':''}>${escapeHtml(visitLabel(v))}</option>`).join('')}</select></div>${visit?`<div class="actions"><button class="btn" id="analysis-demo">Jeu d’essai</button><button class="btn secondary" id="analysis-clear">Effacer l’analyse</button></div>`:''}</section>${!visit?'<div class="empty" style="margin-top:16px">Créez ou sélectionnez une visite.</div>':!visit.subjects?.length?'<div class="empty" style="margin-top:16px">Ajoutez des sujets dans l’onglet Animaux.</div>':`<nav class="analysis-tabs">${tabs.map(([k,l])=>`<button class="analysis-tab ${activeAnalysisSection===k?'active':''}" data-analysis-section="${k}">${l}</button>`).join('')}</nav><section class="analysis-content">${activeAnalysisSection==='numeric'?renderNumericSection(visit):activeAnalysisSection==='observations'?renderObservationsSection(visit):activeAnalysisSection==='general'?renderGeneralSection(visit):activeAnalysisSection==='reasoning'?renderReasoningSection(visit):renderSynthesisSection(visit)}</section>`}`;
  document.getElementById('analysis-visit-select')?.addEventListener('change',e=>{activeAnalysisVisitId=e.target.value;localStorage.setItem('audit-bovin-active-analysis-visit',activeAnalysisVisitId);renderAnalysis();});
  app.querySelectorAll('[data-analysis-section]').forEach(b=>b.onclick=()=>{activeAnalysisSection=b.dataset.analysisSection;localStorage.setItem('audit-bovin-active-analysis-section',activeAnalysisSection);renderAnalysis();});
  app.querySelectorAll('[data-analysis-family]').forEach(b=>b.onclick=()=>{activeAnalysisFamily=b.dataset.analysisFamily;localStorage.setItem('audit-bovin-active-analysis-family',activeAnalysisFamily);renderAnalysis();});
  bindAnalysisEvents(visit);
}
function bindAnalysisEvents(visit) {
  if(!visit)return;
  app.querySelectorAll('.analysis-input').forEach(input=>{const persist=()=>{const s=visit.subjects.find(x=>x.id===input.dataset.subjectId);if(!s)return;s.measurements.analysis[input.dataset.param]=input.value;s.updatedAt=new Date().toISOString();visit.updatedAt=new Date().toISOString();saveDatabase(db);const result=s.category&&s.category!=='Non classé'?classifyValue(input.value,thresholdFor(s,input.dataset.param)):(input.value===''?{status:'empty',label:'Non mesuré'}:{status:'unclassified',label:'Classer le sujet'});const cell=input.closest('.analysis-value-cell');cell.className=`analysis-value-cell ${result.status}`;cell.querySelector('small').textContent=result.label;};input.onchange=persist;input.onblur=persist;});
  app.querySelectorAll('[data-family-comment]').forEach(el=>{const save=()=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);if(!s)return;s.measurements.comments=s.measurements.comments||{};s.measurements.comments[el.dataset.family]=el.value;s.updatedAt=new Date().toISOString();visit.updatedAt=new Date().toISOString();saveDatabase(db);};el.oninput=save;el.onchange=save;el.onblur=save;});
  app.querySelectorAll('[data-observation]').forEach(el=>{const save=()=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);s.measurements.observations[el.dataset.key]=el.value;visit.updatedAt=new Date().toISOString();saveDatabase(db);};el.oninput=save;el.onchange=save;});
  app.querySelectorAll('[data-observation-multi]').forEach(el=>el.onchange=()=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);const key=el.dataset.key;s.measurements.observations[key]=[...app.querySelectorAll(`[data-observation-multi][data-subject-id="${s.id}"][data-key="${key}"]:checked`)].map(x=>x.value);visit.updatedAt=new Date().toISOString();saveDatabase(db);el.closest('.choice-chip')?.classList.toggle('selected',el.checked);});
  app.querySelectorAll('[data-add-general]').forEach(b=>b.onclick=()=>{visit.analysisGeneral[b.dataset.addGeneral].push({id:uid(b.dataset.addGeneral)});saveDatabase(db);renderAnalysis();});
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
    if (confirm('Effacer définitivement toutes les données de cet appareil ?')) { db = replaceDatabase({ farms: [], visits: [] }); clearDraft(); activeAnimalVisitId = ''; showToast('Base locale effacée.'); renderBackup(); }
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
