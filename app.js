import { loadDatabase, saveDatabase, loadDraft, saveDraft, clearDraft, replaceDatabase } from './storage.js';
import { uid, formatDate, formatDateTime, escapeHtml, downloadJson, slugify } from './utils.js';
import { THRESHOLDS, CATEGORY_RULE_MAP } from './analysis-rules.js';
import { KNOWLEDGE_AXES, KNOWLEDGE_RULES } from './knowledge-base.js';

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


// V14.2.1 — fonctions communes restaurées après fusion des modules restitution/pilotage.
function normalizeSearchText(value='') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureVisitConclusion(visit) {
  if (!visit) return { strengths:[], high:'', medium:'', low:'', general:'', priorities:[], next:'' };
  const current = visit.visitConclusion && typeof visit.visitConclusion === 'object' ? visit.visitConclusion : {};
  current.strengths = Array.isArray(current.strengths)
    ? current.strengths
    : String(current.strengths || '').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  current.high = String(current.high || '');
  current.medium = String(current.medium || '');
  current.low = String(current.low || '');
  current.general = String(current.general || '');
  current.next = String(current.next || '');
  current.priorities = Array.isArray(current.priorities) ? current.priorities : [];
  current.priorities = current.priorities.map(item => typeof item === 'string'
    ? { text:item, source:'', decision:'À étudier', comment:'' }
    : { text:'', source:'', decision:'À étudier', comment:'', ...item });
  while (current.priorities.length < 3) current.priorities.push({ text:'', source:'', decision:'À étudier', comment:'' });
  visit.visitConclusion = current;
  return current;
}

function autoVisitConclusion(visit) {
  const saved = ensureVisitConclusion(visit);
  const strengths = [...saved.strengths];
  const groups = typeof categoryAnalysis === 'function' ? categoryAnalysis(visit) : [];
  if ((visit.subjects || []).length && groups.length) strengths.push(`${groups.length} catégorie(s) analysée(s) avec des mesures exploitables.`);
  if ((visit.photos || []).length) strengths.push(`${visit.photos.length} photo(s) documentent la visite.`);
  if ((visit.feeding?.rations || []).length) strengths.push('La ration et les modalités de distribution sont renseignées.');
  const uniqueStrengths = [...new Set(strengths.map(x=>String(x).trim()).filter(Boolean))].slice(0,6);

  const proposed = [];
  try {
    (suggestedActions(visit) || []).slice(0,6).forEach(x => proposed.push({
      text: `${x.category ? x.category + ' — ' : ''}${x.action || x.title || ''}`.trim(),
      source: x.category || 'Analyse automatique',
      decision: 'À étudier',
      comment: ''
    }));
  } catch (e) { console.warn('Actions automatiques indisponibles', e); }
  (visit.analysisActions || []).filter(a=>a.text).forEach(a=>proposed.push({
    text:a.text, source:'Plan d’action', decision:a.status || 'À faire', comment:a.progressNote || ''
  }));
  const merged=[];
  [...saved.priorities.filter(x=>x.text), ...proposed].forEach(x=>{
    const key=normalizeSearchText(x.text);
    if(key && !merged.some(y=>normalizeSearchText(y.text)===key)) merged.push(x);
  });
  while(merged.length<3) merged.push({text:'',source:'',decision:'À étudier',comment:''});
  return {...saved, strengths:uniqueStrengths, priorities:merged.slice(0,6)};
}

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


const auditGlobalSections = [
  { id:'sanitaire', title:'Sanitaire et gestion du troupeau', icon:'🩺', questions:[
    'Principaux problèmes sanitaires rencontrés sur les 12 derniers mois','Organisation de la vaccination','Gestion du parasitisme et recours aux coprologies','Gestion des traitements et respect des délais d’attente','Registre sanitaire et traçabilité des interventions','Gestion des animaux malades et possibilité d’isolement','Gestion des introductions et quarantaine','Statut sanitaire des animaux achetés','Gestion des cadavres et des déchets de soins','Plan de lutte contre les nuisibles','Relation et fréquence de suivi avec le vétérinaire sanitaire'
  ]},
  { id:'reproduction', title:'Reproduction et conduite du renouvellement', icon:'🐄', questions:[
    'Mode de mise à la reproduction','Période de mise à la reproduction','Suivi des chaleurs et des retours','Diagnostics de gestation','Gestion des vaches vides','Préparation des animaux à la mise bas','Surveillance des vêlages','Gestion des délivrances et complications post-partum','Âge moyen au premier vêlage','Intervalle vêlage-vêlage','Origine des génisses de renouvellement','Critères de sélection des génisses'
  ]},
  { id:'jeunes', title:'Soins aux jeunes et conduite des veaux', icon:'🐮', questions:[
    'Prise en charge du veau immédiatement après la naissance','Désinfection du nombril','Délai de distribution du colostrum','Contrôle de la qualité du colostrum','Quantité de colostrum distribuée','Traçabilité du colostrum et des soins','Mode de logement des veaux','Nettoyage et désinfection entre lots','Accès à l’eau et à l’aliment solide','Mode et âge de sevrage','Suivi de la croissance','Gestion des diarrhées et troubles respiratoires'
  ]},
  { id:'pratiques', title:'Pratiques d’élevage et conduite des lots', icon:'📋', questions:[
    'Organisation de l’allotement','Mode de pâturage','Gestion de l’estive','Transitions alimentaires','Organisation du tarissement','Préparation des mises bas','Gestion des animaux à risque ou fragiles','Fréquence d’observation du troupeau','Manipulations et contention','Parage et suivi des aplombs','Organisation des réformes','Répartition des tâches dans l’élevage'
  ]},
  { id:'fourrages', title:'Fourrages et cultures', icon:'🌾', questions:[
    'Type de sol des principales surfaces','Type de prairies','Pratique du sur-semis','Espèces semées dans les prairies temporaires ou sur-semis','Rotation des cultures et prairies','Fertilisation et amendements','Irrigation','Stade de récolte des fourrages','Hauteur de coupe','Qualité visuelle du foin','Matière sèche du foin','Méthode de réalisation du foin','Réalisation des ensilages','Tassement, bâchage et protection des silos','Réalisation de l’enrubannage','Stockage des fourrages','Analyses de fourrages disponibles','Gestion du front d’attaque et distribution'
  ]},
  { id:'organisation', title:'Organisation, travail et objectifs', icon:'👥', questions:[
    'Temps de travail et astreintes','Procédures pour les tâches sensibles','Transmission des informations entre intervenants','Suivi des actions décidées lors des visites précédentes','Indicateurs techniques consultés régulièrement','Documents et analyses facilement accessibles','Plan d’urgence et contacts disponibles'
  ]}
];


const plancheGroups = [
  { id:'animaux', icon:'🐄', title:'Animaux', subtitle:'NEC, remplissage du rumen, bouses, urines et aplombs.' },
  { id:'sang', icon:'🩸', title:'Sang & énergie', subtitle:'BOH, glycémie, urée et facteurs influençant énergie/azote.' },
  { id:'colostrum', icon:'🍼', title:'Colostrum & veaux', subtitle:'Brix colostral, protéines sériques et conduite à tenir.' },
  { id:'eau', icon:'💧', title:'Eau', subtitle:'Débit, pH, redox, conductivité, nitrates et température.' },
  { id:'fourrages', icon:'🌾', title:'Fourrages', subtitle:'Tamis à bouses, fibres et repères de conservation.' },
  { id:'nutrition', icon:'⚖️', title:'Nutrition', subtitle:'Énergie, protéines, équilibre énergie/azote et BACA.' },
  { id:'sol-plantes', icon:'🌱', title:'Sol et plantes', subtitle:'pH, redox, Brix, conductivité et repères de prélèvement.' },
  { id:'courants', icon:'⚡', title:'Électricité AC/DC', subtitle:'Schéma de mesure, sécurité, points de contrôle et erreurs.' },
  { id:'protocoles', icon:'📑', title:'Protocoles terrain', subtitle:'Check-lists eau, électricité, veaux, colostrum et alimentation.' },
  { id:'appareils', icon:'🔬', title:'Appareils', subtitle:'Rappels très courts pour les appareils de terrain.' }
];

let activePlanche = localStorage.getItem('audit-bovin-active-planche') || 'animaux';

const plancheAlias = {
  'Urines':'animaux','Sang':'animaux','Bouses':'animaux','Observations physiques':'animaux','Physique':'animaux',
  'Lait':'animaux','Colostrum':'animaux','Tamis':'fourrages','Tamis à bouses':'fourrages',
  'Silos':'fourrages','Silos / ensilages':'fourrages','Sol':'sol-plantes','Plantes':'sol-plantes','Plantes / herbe':'sol-plantes',
  'Eau':'eau','Abreuvoirs':'eau','Eau / abreuvoirs':'eau','Électricité':'courants','Courants électriques':'courants',
  'Plan bâtiment':'courants','Alimentation':'nutrition','Nutrition':'nutrition','Énergie':'nutrition','Protéines':'nutrition','BACA':'nutrition','Fourrages':'fourrages','Audit global':'animaux'
};

function plancheTable(headers, rows) {
  return `<div class="table-wrap"><table class="planche-table"><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function plancheContent(id) {
  if (id === 'animaux') return `
    <section class="card planche-main">
      <h3>🐄 Repères visuels animaux</h3>
      <p class="muted">Planche synthétique : remplissage du rumen, aplombs, types de bouses et couleurs des urines.</p>
      <img class="planche-image" src="planches-visuelles.png" alt="Repères visuels animaux : rumen, aplombs, bouses et urines">
      <div class="planche-note"><strong>Lecture :</strong> toujours rattacher l’observation à la catégorie et au stade physiologique du sujet, puis la confronter aux autres mesures.</div>
    </section>`;
  if (id === 'sang') return `
    <section class="card planche-main"><h3>🩸 Sang, énergie et azote</h3>
      <div class="planche-grid">
        <article><h4>BOH / BHB</h4><p><strong>À retenir :</strong> corps cétonique qui augmente lorsque l'animal mobilise ses réserves graisseuses.</p><ul><li>Toujours croiser avec glycémie, NEC, ingestion, stade physiologique et remplissage ruminal.</li><li>Une valeur isolée ne suffit pas à conclure.</li><li>Noter l'heure, le délai depuis le repas et le contexte clinique.</li></ul></article>
        <article><h4>Ce qui influence l'énergie</h4><ul><li>Ingestion réelle et accès à l'auge.</li><li>Densité énergétique et digestibilité.</li><li>Transition alimentaire et tri.</li><li>Lactation, gestation, croissance, froid/chaleur.</li><li>Douleur, inflammation, parasitisme, stress.</li><li>Accès à l'eau.</li></ul></article>
        <article><h4>Ce qui influence l'azote / urée</h4><ul><li>Quantité et dégradabilité des protéines.</li><li>Synchronisation avec l'énergie fermentescible.</li><li>Ingestion, transit, hydratation.</li><li>Qualité des fourrages et stade physiologique.</li><li>Fonction rénale et état sanitaire.</li></ul></article>
      </div>
      <div class="planche-warning">Ne pas résumer « urée haute = trop de protéines » : vérifier l'énergie disponible, l'ingestion, l'eau et le contexte.</div>
    </section>`;
  if (id === 'colostrum') return `
    <section class="card planche-main"><h3>🍼 Colostrum et transfert d'immunité</h3>
      ${plancheTable(['Mesure','Lecture pratique','Conseil terrain'],[
        ['Brix colostrum ≥ 22 %','Bonne qualité pour le premier repas','Distribuer rapidement et tracer quantité/heure.'],
        ['Brix 18 à 21,9 %','Qualité intermédiaire','Compléter avec un colostrum de meilleure qualité ou un produit adapté.'],
        ['Brix < 18 %','Qualité faible','Ne pas utiliser seul pour le premier repas.'],
        ['Protéines sériques ≥ 6,2 g/dL','Transfert excellent à l’échelle du lot','Maintenir le protocole et contrôler plusieurs veaux.'],
        ['5,8 à 6,1 g/dL','Bon','Poursuivre la surveillance.'],
        ['5,1 à 5,7 g/dL','Intermédiaire','Revoir délai, quantité, qualité et hygiène.'],
        ['< 5,1 g/dL','Transfert faible / risque accru','Auditer rapidement la conduite colostrale ; ce n’est pas une preuve d’infection.']
      ])}
      <div class="planche-grid"><article><h4>Premier repas</h4><ul><li>Le plus tôt possible après la naissance.</li><li>Mesurer la qualité avant distribution.</li><li>Noter heure et quantité réellement bues.</li><li>Prévoir une banque de colostrum congelé identifié.</li></ul></article><article><h4>Complément</h4><ul><li>Un sachet n'apporte pas toujours la même quantité d'IgG.</li><li>Lire l'étiquette : supplément ou substitut complet.</li><li>Calculer selon la teneur en IgG et le poids du veau.</li></ul></article></div>
    </section>`;
  if (id === 'eau') return `
    <section class="card planche-main"><h3>💧 Eau et abreuvement</h3>
      ${plancheTable(['Point à contrôler','Ce qu’il faut noter','Vigilance terrain'],[
        ['Débit','L/min mesurés au point d’eau','Mesurer réellement, ne pas se fier au débit théorique.'],
        ['Hauteur / accessibilité','Hauteur, position, concurrence','Observer si tous les animaux peuvent boire facilement.'],
        ['pH','Valeur et lieu de prélèvement','Interpréter avec l’origine et le réseau de distribution.'],
        ['Redox','Valeur, appareil et conditions','Comparer des mesures réalisées dans des conditions identiques.'],
        ['Conductivité','Valeur et unité','Noter l’unité et l’appareil utilisé.'],
        ['Nitrates','Résultat d’analyse','Conserver la date et le laboratoire.'],
        ['Température','°C au moment du contrôle','Noter la saison et le point de mesure.']
      ])}
      <div class="planche-note">Les seuils précis restent ceux validés dans le moteur d’analyse et dépendent du contexte de l’élevage.</div>
    </section>`;
  if (id === 'fourrages') return `
    <section class="card planche-main"><h3>🌾 Fourrages et tamis</h3>
      <div class="planche-grid">
        <article><h4>Tamis à bouses</h4><ol><li>Prélever un mélange représentatif du lot.</li><li>Peser le poids total.</li><li>Peser chaque fraction retenue.</li><li>Laisser l’application calculer les pourcentages.</li></ol></article>
        <article><h4>Foin / ensilage / enrubannage</h4><ul><li>Aspect, odeur, échauffement et moisissures.</li><li>Stade et hauteur de récolte.</li><li>Conditionnement, conservateur et stockage.</li><li>Noter la matière sèche si disponible.</li></ul></article>
        <article><h4>Fibres</h4><ul><li>Observer la longueur et l’homogénéité.</li><li>Comparer la ration distribuée, les refus et les bouses.</li><li>Une observation isolée ne suffit pas.</li></ul></article>
      </div>
    </section>`;
  if (id === 'nutrition') return `
    <section class="card planche-main"><h3>⚖️ Équilibre énergie / protéines</h3>
      <div class="planche-grid">
        <article><h4>🟠 Énergie : le carburant</h4><p>Elle couvre l’entretien, la thermorégulation, la croissance, la gestation et la production de lait.</p><ul><li><strong>Déficit :</strong> amaigrissement, baisse de lait, BOH élevé, cétose, reproduction retardée.</li><li><strong>Excès ou énergie trop rapide :</strong> engraissement, acidose, tri et baisse d’ingestion.</li><li><strong>Sources :</strong> maïs ensilage ou grain, céréales, pulpes, mélasse, betteraves, herbe jeune.</li></ul></article>
        <article><h4>🔵 Protéines : les briques</h4><p>Elles alimentent les microbes du rumen et fournissent les acides aminés nécessaires aux tissus, à la croissance et au lait.</p><ul><li><strong>Déficit :</strong> baisse de croissance ou de production, ingestion et taux protéique parfois faibles.</li><li><strong>Excès mal valorisé :</strong> urée élevée, pertes d’azote, coût inutile et charge métabolique.</li><li><strong>Sources :</strong> herbe et légumineuses, luzerne, trèfle, tourteaux de soja, colza ou tournesol.</li></ul></article>
        <article><h4>🟢 Pourquoi les équilibrer ?</h4><p>Les microbes du rumen ont besoin d’azote et d’énergie fermentescible disponibles au même moment.</p><ul><li>Protéines sans énergie suffisante : azote moins bien valorisé, urée potentiellement élevée.</li><li>Énergie sans azote suffisant : activité microbienne et digestion des fibres limitées.</li><li>Le bon aliment est celui qui complète la ration et non celui qui est simplement le plus riche.</li></ul></article>
      </div>
      ${plancheTable(['Aliment','Apport dominant','Repère pratique'],[
        ['Maïs ensilage','Énergie + amidon','Énergétique, mais relativement pauvre en protéines.'],
        ['Céréales : maïs, orge, blé','Énergie rapidement fermentescible','À sécuriser par les fibres et une distribution adaptée.'],
        ['Pulpes / betteraves','Énergie digestible','Énergie moins amidonnée, selon la présentation.'],
        ['Herbe jeune / ensilage d’herbe','Protéines + énergie','Valeur très dépendante du stade et de la conservation.'],
        ['Foin précoce','Fibres + valeur alimentaire','Plus riche et digestible qu’un foin récolté tardivement.'],
        ['Foin tardif / paille','Fibres','Valeur énergétique et protéique faible ; rôle surtout structural.'],
        ['Luzerne / trèfle','Protéines + calcium','Souvent riches en potassium : vigilance chez les taries.'],
        ['Tourteau de soja','Protéines concentrées','Correcteur protéique très riche.'],
        ['Tourteau de colza','Protéines','Correcteur protéique avec profil différent du soja.'],
        ['Mélasse / sucres','Énergie fermentescible','À raisonner avec l’ensemble des sucres et amidons.']
      ])}
      <div class="planche-note"><strong>Lecture terrain :</strong> croiser la ration réellement ingérée avec NEC, remplissage ruminal, tri, bouses, glycémie, BOH et urée. Une seule mesure ne permet pas de conclure.</div>
    </section>
    <section class="card planche-main"><h3>🧂 BACA – bilan alimentaire cations-anions</h3>
      <p>La BACA traduit l’équilibre entre les ions principalement alcalinisants (<strong>sodium et potassium</strong>) et acidifiants (<strong>chlore et soufre</strong>) de la ration. Elle s’exprime généralement en mEq/kg de matière sèche.</p>
      <div class="planche-grid">
        <article><h4>BACA élevée</h4><ul><li>Souvent liée à des fourrages riches en potassium.</li><li>Peut limiter l’efficacité de la mobilisation du calcium autour du vêlage.</li><li>Herbe jeune, luzerne et parcelles fortement fertilisées peuvent l’augmenter.</li></ul></article>
        <article><h4>BACA abaissée chez les taries</h4><ul><li>Utilisée durant la préparation au vêlage selon un protocole maîtrisé.</li><li>Favorise l’adaptation du métabolisme calcique.</li><li>Doit être contrôlée par la ration, les analyses minérales et le pH urinaire.</li></ul></article>
        <article><h4>Vigilances</h4><ul><li>Ne pas ajouter des sels anioniques sans calcul de ration.</li><li>Vérifier ingestion, appétence, magnésium et apport calcique.</li><li>Interpréter le pH urinaire selon l’espèce, la ration et le protocole retenu.</li></ul></article>
      </div>
      <div class="planche-warning">La BACA est surtout un outil de prévention autour du vêlage. Toute correction importante doit être validée avec le nutritionniste ou le vétérinaire de l’élevage.</div>
      <div class="planche-note"><strong>Formule courante :</strong> BACA = (Na × 43,5 + K × 25,6) − (Cl × 28,2 + S × 62,5), avec les éléments exprimés en % de matière sèche. Vérifier cependant la formule et les unités utilisées par le laboratoire.</div>
    </section>`;
  if (id === 'sol-plantes') return `
    <section class="card planche-main"><h3>🌱 Sol et plantes</h3>
      ${plancheTable(['Mesure','À renseigner','Conditions à noter'],[
        ['Sol – pH','Valeur par parcelle / zone','Humidité, profondeur et méthode.'],
        ['Sol – redox','Valeur et unité','État du sol, météo récente et heure.'],
        ['Plantes – Brix','Valeur par prélèvement','Espèce, stade, heure et météo.'],
        ['Plantes – pH / redox','Valeurs et appareil','Méthode de préparation de l’échantillon.'],
        ['Minéraux / nitrates','K, Ca, Na, nitrates si mesurés','Unité et laboratoire / appareil.']
      ])}
      <div class="planche-note">Comparer uniquement des prélèvements réalisés avec une méthode et des conditions suffisamment proches.</div>
    </section>`;
  if (id === 'courants') return `
    <section class="card planche-main"><h3>⚡ Mesure des courants parasites</h3>
      <div class="electric-schema"><svg viewBox="0 0 760 230" role="img" aria-label="Schéma simplifié mesure électrique abreuvoir sol"><rect x="35" y="55" width="220" height="95" rx="16" fill="#dbeef5" stroke="#39748c" stroke-width="3"/><text x="145" y="105" text-anchor="middle" font-size="22" fill="#244d60">Abreuvoir / métal</text><circle cx="300" cy="102" r="10" fill="#d43e58"/><line x1="255" y1="102" x2="300" y2="102" stroke="#d43e58" stroke-width="5"/><rect x="325" y="45" width="150" height="115" rx="14" fill="#fff" stroke="#b53670" stroke-width="4"/><text x="400" y="85" text-anchor="middle" font-size="20">Multimètre</text><text x="400" y="118" text-anchor="middle" font-size="24" font-weight="700" fill="#b53670">mV AC</text><circle cx="500" cy="102" r="10" fill="#222"/><line x1="475" y1="102" x2="620" y2="180" stroke="#222" stroke-width="5"/><line x1="40" y1="190" x2="720" y2="190" stroke="#7b6758" stroke-width="8"/><line x1="620" y1="180" x2="620" y2="200" stroke="#222" stroke-width="8"/><text x="635" y="220" font-size="18">Sol humide / référence</text><text x="280" y="35" font-size="16" fill="#d43e58">Pointe rouge</text><text x="500" y="35" font-size="16">Pointe noire</text></svg></div>
      <div class="planche-note"><strong>AC :</strong> courant alternatif, à tester en premier pour une recherche liée au réseau. <strong>DC :</strong> courant continu, à utiliser si le contexte le justifie (batterie, alimentation électronique, installation spécifique).</div>
      <div class="planche-grid">
        <article><h4>Où mesurer ?</h4><ul><li>Abreuvoirs.</li><li>Cornadis et barrières.</li><li>Équipements métalliques accessibles aux animaux.</li><li>Points signalés sur le plan du bâtiment.</li></ul></article>
        <article><h4>Comment noter ?</h4><ul><li>Emplacement exact.</li><li>AC ou DC.</li><li>Unité affichée par l’appareil.</li><li>Conditions de mesure et correction éventuelle.</li></ul></article>
        <article><h4>Après correction</h4><ul><li>Refaire la mesure au même point.</li><li>Conserver la valeur avant / après.</li><li>Relier la mesure à l’objet du plan.</li></ul></article>
      </div>
      <div class="planche-warning">Ne jamais improviser une intervention électrique : la recherche de cause et les travaux relèvent d’un professionnel compétent.</div>
    </section>`;
  if (id === 'protocoles') return `
    <section class="card planche-main"><h3>📑 Protocoles GDS – check-lists terrain</h3>
      <details open><summary><strong>💧 Audit eau</strong></summary><ol><li>Recenser origine et réseau.</li><li>Compter les points d'eau et observer la concurrence.</li><li>Mesurer réellement le débit.</li><li>Contrôler propreté, hauteur et accessibilité.</li><li>Noter température, pH/redox et analyses disponibles.</li><li>Photographier les anomalies et prévoir le recontrôle.</li></ol></details>
      <details><summary><strong>⚡ Audit électrique</strong></summary><ol><li>Sécuriser la zone et identifier le point de référence.</li><li>Commencer en mV AC.</li><li>Mesurer eau/métal vers sol humide ou référence adaptée.</li><li>Répéter appareils en marche puis arrêtés.</li><li>Noter emplacement, unité, AC/DC et conditions.</li><li>Faire intervenir un professionnel pour la recherche de cause/travaux.</li></ol></details>
      <details><summary><strong>🍼 Audit colostrum / veaux</strong></summary><ol><li>Mesurer le Brix du colostrum avant distribution.</li><li>Tracer heure et quantité.</li><li>Contrôler hygiène du matériel et stockage.</li><li>Échantillonner plusieurs veaux pour le transfert passif.</li><li>Croiser avec diarrhées, mortalité, logement et ventilation.</li></ol></details>
      <details><summary><strong>🍽️ Audit alimentation</strong></summary><ol><li>Décrire la ration réellement distribuée.</li><li>Observer mélange, tri, refus et accès à l'auge.</li><li>Contrôler transition, eau, sel et minéral.</li><li>Réaliser tamis/observations bouses si pertinent.</li><li>Croiser avec NEC, rumen, BOH, glycémie et urée.</li></ol></details>
      <details><summary><strong>🐄 Audit reproduction</strong></summary><ol><li>IVV et âge au premier vêlage.</li><li>Vaches vides et délai de décision.</li><li>Suivi chaleurs, diagnostics et périodes de reproduction.</li><li>Renouvellement et motifs de réforme.</li><li>Croiser avec NEC, énergie, sanitaire et conduite des lots.</li></ol></details>
    </section>`;
  return `
    <section class="card planche-main"><h3>🔬 Appareils de terrain</h3>
      ${plancheTable(['Appareil','Avant mesure','Après mesure'],[
        ['pH-mètre','Étalonnage adapté, sonde rincée, solution non périmée.','Rincer, sécher sans frotter agressivement, stocker selon la notice.'],
        ['Redox','Vérifier la sonde et la stabilité de lecture.','Rincer et conserver la méthode de mesure.'],
        ['Réfractomètre / Brix','Nettoyer le prisme et vérifier le zéro.','Nettoyer immédiatement sans rayer.'],
        ['Laquatwin','Utiliser la solution d’étalonnage prévue et remplir correctement le capteur.','Rincer le capteur sans l’endommager.'],
        ['Lecteur glycémie / BOH','Bonne bandelette, péremption et goutte suffisante.','Jeter la bandelette, nettoyer l’extérieur du lecteur.'],
        ['Lysun / autre appareil','Suivre le mode opératoire validé pour l’appareil.','Noter tout code erreur et contrôler les consommables.']
      ])}
      <div class="planche-note">Ces rappels ne remplacent pas la notice du fabricant ni les fiches de procédure internes.</div>
    </section>`;
}

function renderPlanches() {
  const selected = plancheGroups.find(x=>x.id===activePlanche) || plancheGroups[0];
  app.innerHTML = `<div class="section-title"><div><h2>Bibliothèque technique</h2><div class="muted">Quelques repères visuels utiles, intégrés à l’application et disponibles hors ligne.</div></div><span class="badge autosave">v14.6.15</span></div>
    <div class="planche-layout">
      <nav class="planche-menu">${plancheGroups.map(g=>`<button class="planche-menu-btn ${g.id===selected.id?'active':''}" data-planche="${g.id}"><span>${g.icon}</span><span><strong>${escapeHtml(g.title)}</strong><small>${escapeHtml(g.subtitle)}</small></span></button>`).join('')}</nav>
      <div class="planche-content">${plancheContent(selected.id)}</div>
    </div>`;
  app.querySelectorAll('[data-planche]').forEach(btn=>btn.onclick=()=>{
    activePlanche=btn.dataset.planche;
    localStorage.setItem('audit-bovin-active-planche',activePlanche);
    renderPlanches();
    window.scrollTo({top:0,behavior:'smooth'});
  });
}

function openPlanche(theme) {
  activePlanche = plancheAlias[theme] || 'animaux';
  localStorage.setItem('audit-bovin-active-planche',activePlanche);
  currentView='planches';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view==='planches'));
  renderPlanches();
  window.scrollTo({top:0,behavior:'smooth'});
}

function openLibraryTheme(theme){ openPlanche(theme); }

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
  db.herdImports = Array.isArray(db.herdImports) ? db.herdImports : [];
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
    visit.feeding.nutrition = visit.feeding.nutrition && typeof visit.feeding.nutrition === 'object' ? visit.feeding.nutrition : {};
    visit.feeding.nutrition.forageAnalyses = Array.isArray(visit.feeding.nutrition.forageAnalyses) ? visit.feeding.nutrition.forageAnalyses : [];
    visit.feeding.nutrition.ration = visit.feeding.nutrition.ration && typeof visit.feeding.nutrition.ration === 'object' ? visit.feeding.nutrition.ration : {};
    visit.buildingAudits = visit.buildingAudits && typeof visit.buildingAudits === 'object' ? visit.buildingAudits : {};
    visit.auditGlobal = visit.auditGlobal && typeof visit.auditGlobal === 'object' ? visit.auditGlobal : { answers:{}, outlets:[], reforms:{}, renewal:{}, notes:'' };
    visit.auditGlobal.answers = visit.auditGlobal.answers && typeof visit.auditGlobal.answers === 'object' ? visit.auditGlobal.answers : {};
    visit.auditGlobal.outlets = Array.isArray(visit.auditGlobal.outlets) ? visit.auditGlobal.outlets : [];
    visit.auditGlobal.reforms = visit.auditGlobal.reforms && typeof visit.auditGlobal.reforms === 'object' ? visit.auditGlobal.reforms : {};
    visit.auditGlobal.renewal = visit.auditGlobal.renewal && typeof visit.auditGlobal.renewal === 'object' ? visit.auditGlobal.renewal : {};
    visit.photos = Array.isArray(visit.photos) ? visit.photos : [];
    const linkedHerd = visit.auditGlobal?.importedHerdData;
    if (linkedHerd?.sourceId && !linkedHerd.snapshot) {
      const source = db.herdImports.find(x => x.id === linkedHerd.sourceId && (!x.farmId || x.farmId === visit.farmId));
      if (source) linkedHerd.snapshot = JSON.parse(JSON.stringify(source));
    }
    if (Array.isArray(visit.reproductionRegistry) && visit.reproductionRegistry.length) {
      visit.reproductionRegistrySource = visit.reproductionRegistrySource && typeof visit.reproductionRegistrySource === 'object' ? visit.reproductionRegistrySource : {};
      visit.reproductionRegistrySource.farmId = visit.farmId;
    }
  });
  db.farms.forEach(farm => {
    farm.buildings = Array.isArray(farm.buildings) ? farm.buildings : [];
    farm.documents = Array.isArray(farm.documents) ? farm.documents : [];
    farm.herdRegistry = Array.isArray(farm.herdRegistry) ? farm.herdRegistry : [];
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

window.addEventListener('audit-bovin-cloud-merged',event=>{
  const previousVisitId=activeVisitId;
  db=loadDatabase();
  if(previousVisitId&&db.visits.some(v=>v.id===previousVisitId))setActiveVisit(previousVisitId);
  else if(activeVisitId&&!db.visits.some(v=>v.id===activeVisitId))setActiveVisit('');
  render();
  if(event.detail?.message)showToast(event.detail.message);
});

function farmName(farmId) {
  return db.farms.find(farm => farm.id === farmId)?.name || 'Exploitation non renseignée';
}

function visitLabel(visit) {
  return `${farmName(visit.farmId)} — ${formatDate(visit.date)} — ${visit.type || 'Visite'}`;
}

function previousVisitFor(farmId, date, excludeId='') {
  return db.visits
    .filter(v => v.farmId === farmId && v.id !== excludeId && (v.date || '') < (date || '9999-12-31'))
    .sort((a,b) => (b.date || '').localeCompare(a.date || ''))[0] || null;
}
function followupSourceItems(previousVisit) {
  if (!previousVisit) return [];
  const c = previousVisit.visitConclusion || null;
  const items = [];
  (c?.priorities || []).filter(a => String(a.text || '').trim() && a.decision !== 'Refusée').forEach((a, i) => items.push({
    id: uid('review'), kind: 'priority', label: String(a.text).trim(), source: a.source || `Action ${i+1}`,
    previousDecision: a.decision || '', previousComment: a.comment || '', status: 'À vérifier', comment: '', completedDate: ''
  }));
  splitUsefulLines(c?.next || '').forEach(text => items.push({
    id: uid('review'), kind: 'check', label: text, source: 'À vérifier lors de la prochaine visite',
    previousDecision: '', previousComment: '', status: 'À vérifier', comment: '', completedDate: ''
  }));
  return uniqueText(items.map(x => x.label)).map(label => items.find(x => x.label === label));
}
function ensurePreviousVisitReview(visit) {
  if (visit.previousVisitReview) return visit.previousVisitReview;
  const previous = previousVisitFor(visit.farmId, visit.date, visit.id);
  visit.previousVisitReview = {
    previousVisitId: previous?.id || '', previousVisitDate: previous?.date || '',
    items: followupSourceItems(previous), generalComment: '', completedAt: '', updatedAt: new Date().toISOString()
  };
  return visit.previousVisitReview;
}
function renderPreviousVisitReview(visit) {
  const review = ensurePreviousVisitReview(visit);
  const previous = db.visits.find(v => v.id === review.previousVisitId);
  if (!previous) return `<section class="card notice" style="margin-top:16px"><strong>Première visite enregistrée pour cette exploitation.</strong><br><span class="muted">Aucune priorité antérieure à contrôler.</span></section>`;
  const done = review.items.filter(i => i.status === 'Réalisée').length;
  const partial = review.items.filter(i => i.status === 'Partiellement réalisée').length;
  const pending = review.items.filter(i => ['Non réalisée','À vérifier'].includes(i.status)).length;
  return `<section class="card previous-review-card" style="margin-top:16px">
    <div class="section-title"><div><h3>✅ Démarrage de la visite : suivi de la visite précédente</h3><span class="muted">Visite du ${formatDate(previous.date)} · vérifiez avec l’éleveur ce qui a réellement été mis en place.</span></div><span class="badge ${pending ? 'in-progress' : 'complete'}">${done}/${review.items.length} réalisée(s)</span></div>
    ${review.items.length ? `<div class="previous-review-list">${review.items.map((item,i)=>`<article class="previous-review-item"><div class="review-number">${i+1}</div><div class="review-main"><strong>${escapeHtml(item.label)}</strong>${item.source?`<small>${escapeHtml(item.source)}</small>`:''}${item.previousComment?`<div class="muted small-text">Commentaire précédent : ${escapeHtml(item.previousComment)}</div>`:''}<div class="row"><div class="field"><label>État constaté</label><select data-review-field="status" data-review-id="${item.id}">${['À vérifier','Réalisée','Partiellement réalisée','Non réalisée','Abandonnée / devenue inutile'].map(v=>`<option ${item.status===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Date de réalisation</label><input type="date" data-review-field="completedDate" data-review-id="${item.id}" value="${escapeHtml(item.completedDate||'')}"></div></div><div class="field"><label>Commentaire / changement observé</label><textarea rows="2" data-review-field="comment" data-review-id="${item.id}">${escapeHtml(item.comment||'')}</textarea></div></div></article>`).join('')}</div>` : '<div class="empty">Aucune action ou vérification n’avait été enregistrée dans la visite précédente.</div>'}
    <div class="grid cols-2 review-summary"><article class="notice positive"><strong>${done} réalisée(s)</strong><br><span class="muted">${partial} partiellement réalisée(s)</span></article><article class="notice warning"><strong>${pending} restant à vérifier ou non réalisée(s)</strong><br><span class="muted">Les éléments inachevés peuvent être repris dans le nouveau plan d’action.</span></article></div>
    <div class="field"><label>Bilan général depuis la visite précédente</label><textarea rows="4" id="previous-review-general">${escapeHtml(review.generalComment||'')}</textarea></div>
    <div class="actions"><button class="btn primary" id="validate-previous-review">Valider le point de départ</button><button class="btn secondary" id="carry-unfinished-actions">Reprendre les actions inachevées dans la conclusion</button></div>
  </section>`;
}
function bindPreviousVisitReview(visit) {
  const review = ensurePreviousVisitReview(visit);
  app.querySelectorAll('[data-review-field]').forEach(el => {
    const save = () => { const item=review.items.find(i=>i.id===el.dataset.reviewId); if(!item)return; item[el.dataset.reviewField]=el.value; review.updatedAt=new Date().toISOString(); visit.updatedAt=review.updatedAt; saveDatabase(db); };
    el.onchange=save; el.oninput=save;
  });
  const general=document.getElementById('previous-review-general'); if(general)general.oninput=()=>{review.generalComment=general.value;review.updatedAt=new Date().toISOString();saveDatabase(db);};
  const validate=document.getElementById('validate-previous-review'); if(validate)validate.onclick=()=>{review.completedAt=new Date().toISOString();addJournal(visit,'Suivi des actions de la visite précédente vérifié.');saveDatabase(db);showToast('Suivi de la visite précédente enregistré.');renderVisits();};
  const carry=document.getElementById('carry-unfinished-actions'); if(carry)carry.onclick=()=>{const unfinished=review.items.filter(i=>['À vérifier','Partiellement réalisée','Non réalisée'].includes(i.status));const c=ensureVisitConclusion(visit);unfinished.forEach(item=>{if(!c.priorities.some(a=>String(a.text||'').trim().toLowerCase()===item.label.toLowerCase()))c.priorities.push({text:item.label,source:'Reprise de la visite précédente',decision:'À étudier',comment:item.comment||''});});c.priorities=c.priorities.filter(a=>a.text).slice(0,6);while(c.priorities.length<3)c.priorities.push({text:'',source:'',decision:'À étudier',comment:''});saveDatabase(db);showToast(`${unfinished.length} action(s) reprise(s) dans la conclusion.`);};
}

function setActiveVisit(id) {
  activeVisitId = id || '';
  if (activeVisitId) localStorage.setItem('audit-bovin-active-visit', activeVisitId);
  else localStorage.removeItem('audit-bovin-active-visit');
}
function activeVisit() { return db.visits.find(v => v.id === activeVisitId) || null; }
function renderNoActiveVisit(moduleName = 'ce module') {
  app.innerHTML = `<section class="card notice warning"><strong>Aucune visite active.</strong><br><span class="muted">${escapeHtml(moduleName)} doit être rattaché à une visite. Sur un nouvel appareil, créez une visite ou importez votre sauvegarde, puis ouvrez-la depuis l’onglet Visites.</span><div class="actions" style="margin-top:12px"><button class="btn primary" id="go-to-visits">Aller aux visites</button><button class="btn secondary" id="go-to-backup">Importer une sauvegarde</button></div></section>`;
  document.getElementById('go-to-visits')?.addEventListener('click', () => setView('visits'));
  document.getElementById('go-to-backup')?.addEventListener('click', () => setView('backup'));
}

function activeVisitBanner(visit) {
  if (!visit) return `<section class="card notice warning"><strong>Aucune visite active.</strong><br><span class="muted">Choisissez une visite dans l’onglet Visites.</span></section>`;
  return `<section class="card active-visit-banner"><div><span class="muted">Visite active — verrouillée pour la saisie</span><strong>${escapeHtml(visitLabel(visit))}</strong></div><span class="badge complete">${visit.subjects?.length || 0} sujet(s)</span><span class="muted small-text">La visite ne peut être changée que depuis l’onglet Visites.</span></section>`;
}


function harmonizeActionButtons(root=document){
  root.querySelectorAll('.btn').forEach(button=>{
    const label=normalizedSearchText(button.textContent).trim();
    button.classList.remove('action-add','action-validate','action-export','action-warning');
    if(/^(supprimer|tout effacer|reinitialiser|retirer)/.test(label)){button.classList.add('danger');return;}
    if(/^(valider|enregistrer|confirmer|terminer|appliquer|completer|synchroniser)/.test(label)){button.classList.add('action-validate');return;}
    if(/^(exporter|telecharger|imprimer|pdf|word|partager)/.test(label)){button.classList.add('action-export');return;}
    if(/^(dupliquer|remplacer|reprendre|archiver)/.test(label)){button.classList.add('action-warning');return;}
    if(/^(ajouter|creer|nouvelle|nouveau|prendre une photo|choisir dans la galerie)/.test(label)){button.classList.add('action-add');}
  });
}

function render() {
  const renderers = { dashboard: renderDashboard, farms: renderFarms, journal: renderJournalSuivi, documents: renderFarmDocuments, visits: renderVisits, animals: renderAnimals, analysis: renderAnalysis, assistant: renderAssistantGDS, feeding: renderFeeding, nutrition: renderNutritionAnalysis, reproduction: renderReproduction, building: renderBuilding, audit: renderAuditGlobal, planches: renderPlanches, photos: renderPhotos, herddata: renderHerdData, followup: renderFollowup, pilotage: renderPilotageActions, reports: renderReports, backup: renderBackup };
  app.innerHTML = '';
  try {
    const renderer = renderers[currentView] || renderDashboard;
    renderer();
    harmonizeActionButtons(app);
  } catch (error) {
    console.error('Erreur de rendu', currentView, error);
    app.innerHTML = `<section class="card notice warning"><strong>Le module n’a pas pu s’afficher.</strong><br><span class="muted">${escapeHtml(error?.message || String(error))}</span><div class="actions" style="margin-top:12px"><button class="btn primary" id="return-dashboard-after-error">Retour à l’accueil</button></div></section>`;
    document.getElementById('return-dashboard-after-error')?.addEventListener('click',()=>setView('dashboard'));
  }
}


function visitProfessionalStats(visit){
  if(!visit)return {completion:0,anomalies:0,measured:0,photos:0,actions:0,actionsDone:0,auditPct:0,pistes:[]};
  const subjects=visit.subjects||[],groups=categoryAnalysis(visit);
  const measured=subjects.filter(s=>Object.values(s.measurements?.analysis||{}).some(v=>numericValue(v)!==null)).length;
  const anomalies=groups.reduce((sum,g)=>sum+g.parameterResults.reduce((n,r)=>n+r.outOfRange,0),0);
  const a=ensureAuditGlobal(visit),auditPct=auditCompletion(a).pct;
  const actions=visit.analysisActions||[],actionsDone=actions.filter(x=>x.status==='Réalisé').length;
  const modules=[
    subjects.length>0,
    measured>0,
    (visit.feeding?.rations||[]).length>0,
    Object.keys(visit.buildingAudits||{}).length>0,
    auditPct>=50,
    !!visit.visitConclusion?.general,
    (visit.photos||[]).length>0
  ];
  const completion=Math.round((modules.filter(Boolean).length/modules.length)*100);
  const pistes=[];groups.forEach(g=>buildKnowledgePistes(visit,g).forEach(p=>{const state=reasoningState(visit,`${g.category}:${p.id}`);if(state.status!=='dismissed')pistes.push({...p,category:g.category,state});}));
  const rank={high:3,medium:2,low:1};pistes.sort((a,b)=>(rank[b.confidence.className]||0)-(rank[a.confidence.className]||0)||b.score-a.score);
  return {completion,anomalies,measured,photos:(visit.photos||[]).length,actions:actions.length,actionsDone,auditPct,pistes};
}
function professionalAttentionItems(visit){
  if(!visit)return [];
  const s=visitProfessionalStats(visit),items=[];
  if(!(visit.subjects||[]).length)items.push({level:'warning',icon:'🐄',text:'Aucun sujet enregistré',view:'animals'});
  if(s.measured===0)items.push({level:'warning',icon:'🧪',text:'Aucune mesure numérique saisie',view:'analysis'});
  if(s.anomalies>0)items.push({level:'danger',icon:'⚠️',text:`${s.anomalies} valeur(s) hors référence à relire`,view:'analysis'});
  if(s.auditPct<70)items.push({level:'warning',icon:'📋',text:`Audit global complété à ${s.auditPct} %`,view:'audit'});
  if(!visit.visitConclusion?.general)items.push({level:'warning',icon:'✍️',text:'Conclusion de visite à valider',view:'analysis'});
  const pending=(visit.analysisActions||[]).filter(a=>a.status!=='Réalisé').length;if(pending)items.push({level:'info',icon:'🎯',text:`${pending} action(s) encore ouvertes`,view:'pilotage'});
  const today=new Date().toISOString().slice(0,10),overdue=(visit.analysisActions||[]).filter(a=>a.status!=='Réalisé'&&a.dueDate&&a.dueDate<today).length;if(overdue)items.unshift({level:'danger',icon:'⏰',text:`${overdue} action(s) en retard`,view:'pilotage'});
  if(!(visit.generatedReports||[]).length)items.push({level:'info',icon:'📄',text:'Aucun rapport généré',view:'reports'});
  return items;
}
function domainIndicators(visit){
  if(!visit)return [];
  const groups=categoryAnalysis(visit),a=ensureAuditGlobal(visit),build=buildingRecords(visit);
  const countOutside=keys=>groups.reduce((n,g)=>n+g.parameterResults.filter(r=>keys.includes(r.parameter.key)).reduce((s,r)=>s+r.outOfRange,0),0);
  const score=(base,penalty)=>Math.max(0,Math.min(100,Math.round(base-penalty)));
  const analysisBase=groups.length?85:20;
  return [
    {label:'Santé / analyses',icon:'🩺',value:score(analysisBase,countOutside(['glucose','boh','bloodPH','urea'])*4)},
    {label:'Digestion',icon:'🧪',value:score(analysisBase,countOutside(['fecesPH','fecesRedox'])*5)},
    {label:'Eau',icon:'💧',value:score(build.drinkers.length?90:30,build.drinkers.filter(d=>(numericValue(d.flow)||99)<10||['Moyenne','Insuffisante'].includes(d.accessibility)).length*15)},
    {label:'Bâtiment',icon:'🏠',value:score(Object.keys(visit.buildingAudits||{}).length?85:25,build.questionnaire.filter(q=>['À surveiller','À corriger'].includes(q.status)).length*5)},
    {label:'Alimentation',icon:'🌾',value:(visit.feeding?.rations||[]).length?80:25},
    {label:'Reproduction',icon:'📈',value:score(a.answers?.['Intervalle vêlage-vêlage']?.answer?80:35,auditAttentionCount(visit,'reproduction')*4)}
  ];
}
function renderProfessionalIndicators(visit){return `<div class="professional-score-grid">${domainIndicators(visit).map(x=>`<article class="professional-score-card"><span>${x.icon} ${escapeHtml(x.label)}</span><strong>${x.value}</strong><div class="professional-score-bar"><i style="width:${x.value}%"></i></div><small>Indice de suivi, non diagnostique</small></article>`).join('')}</div>`;}
function renderAssistantGDS(){
  const visit=activeVisit();if(!visit){renderNoActiveVisit('Assistant GDS');return;}
  const stats=visitProfessionalStats(visit),auto=autoVisitConclusion(visit),attention=professionalAttentionItems(visit);
  app.innerHTML=`<div class="section-title"><div><h2>Analyse & interprétation</h2><div class="muted">Synthèse professionnelle des données de la visite active.</div></div><span class="badge autosave">v14.3 Professional</span></div>${activeVisitBanner(visit)}
  <section class="assistant-hero"><div><span class="assistant-kicker">SYNTHESE AUTOMATIQUE</span><h3>${escapeHtml(farmName(visit.farmId))}</h3><p>Les éléments ci-dessous sont construits à partir des données saisies et restent soumis à la validation du technicien.</p></div><div class="assistant-completion"><strong>${stats.completion}%</strong><span>visite structurée</span></div></section>
  <section class="grid cols-4 professional-kpis"><article class="card"><span>Anomalies</span><strong>${stats.anomalies}</strong></article><article class="card"><span>Sujets mesurés</span><strong>${stats.measured}</strong></article><article class="card"><span>Photos</span><strong>${stats.photos}</strong></article><article class="card"><span>Actions réalisées</span><strong>${stats.actionsDone}/${stats.actions}</strong></article></section>
  <section class="card"><div class="section-title"><div><h3>Indicateurs par domaine</h3><div class="muted">Repères de suivi calculés à partir de la complétude et des vigilances détectées.</div></div></div>${renderProfessionalIndicators(visit)}</section>
  <section class="grid cols-2"><article class="card"><h3>✅ Points favorables proposés</h3>${auto.strengths.length?`<ul>${auto.strengths.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:'<div class="empty">Aucun point favorable automatique suffisamment étayé.</div>'}</article><article class="card"><h3>🔔 Centre d’attention</h3>${attention.length?`<div class="attention-list">${attention.map(x=>`<button class="attention-item ${x.level}" data-attention-view="${x.view}"><span>${x.icon}</span><strong>${escapeHtml(x.text)}</strong><b>›</b></button>`).join('')}</div>`:'<div class="notice"><strong>Aucune étape importante en attente.</strong></div>'}</article></section>
  <section class="card"><div class="section-title"><div><h3>🧠 Pistes prioritaires</h3><div class="muted">Classées selon le niveau de confiance et le nombre de sources concordantes.</div></div><button class="btn primary" id="assistant-open-analysis">Ouvrir l’analyse détaillée</button></div>${stats.pistes.length?`<div class="assistant-pistes">${stats.pistes.slice(0,6).map((p,i)=>`<article><span class="assistant-rank">${i+1}</span><div><small>${escapeHtml(p.category)}</small><h4>${escapeHtml(p.title)}</h4><p>${escapeHtml(p.summary)}</p><span class="confidence ${p.confidence.className}">Confiance ${escapeHtml(p.confidence.label)} · ${p.sourceCount} source(s)</span></div></article>`).join('')}</div>`:'<div class="empty">Aucune piste suffisamment étayée. Complétez les mesures et les modules de contexte.</div>'}</section>
  <section class="card"><h3>🎯 Proposition de plan d’action</h3><div class="assistant-actions">${auto.priorities.filter(x=>x.text).map((x,i)=>`<div><span>${i+1}</span><strong>${escapeHtml(x.text)}</strong><small>${escapeHtml(x.source||'')}</small></div>`).join('')||'<div class="empty">Aucune action automatique proposée.</div>'}</div><div class="actions"><button class="btn" id="assistant-open-conclusion">Valider dans la conclusion</button><button class="btn secondary" id="assistant-open-reports">Préparer le rapport</button></div></section>`;
  app.querySelectorAll('[data-attention-view]').forEach(b=>b.onclick=()=>setView(b.dataset.attentionView));
  document.getElementById('assistant-open-analysis').onclick=()=>setView('analysis');
  document.getElementById('assistant-open-conclusion').onclick=()=>setView('analysis');
  document.getElementById('assistant-open-reports').onclick=()=>setView('reports');
}
function renderDashboard() {
  const inProgress=db.visits.filter(v=>v.status==='in-progress'),complete=db.visits.filter(v=>v.status==='complete');
  const subjectCount=db.visits.reduce((sum,v)=>sum+(v.subjects?.length||0),0),draft=loadDraft(),visit=activeVisit(),stats=visitProfessionalStats(visit),attention=professionalAttentionItems(visit);
  app.innerHTML=`<div class="professional-dashboard-head"><div><span class="assistant-kicker">AUDIT BOVIN GDS 32-65</span><h2>Tableau de bord professionnel</h2><p>${visit?`Visite active : <strong>${escapeHtml(visitLabel(visit))}</strong>`:'Ouvrez une visite pour afficher son avancement détaillé.'}</p></div>${visit?`<div class="dashboard-ring" style="--pct:${stats.completion}"><strong>${stats.completion}%</strong><span>avancement</span></div>`:''}</div>
  <section class="grid cols-4 professional-kpis"><article class="card"><span>Exploitations</span><strong>${db.farms.length}</strong></article><article class="card"><span>Visites en cours</span><strong>${inProgress.length}</strong></article><article class="card"><span>Visites terminées</span><strong>${complete.length}</strong></article><article class="card"><span>Sujets enregistrés</span><strong>${subjectCount}</strong></article></section>
  ${draft?`<section class="card notice warning" style="margin-top:16px"><strong>Une saisie non finalisée a été retrouvée.</strong><div class="actions" style="margin-top:10px"><button class="btn primary" id="resume-draft">Reprendre la saisie</button><button class="btn secondary" id="discard-draft">Ignorer</button></div></section>`:''}
  ${visit?`<section class="grid cols-4 dashboard-visit-kpis"><article class="card"><span>🧪 Valeurs hors réf.</span><strong>${stats.anomalies}</strong></article><article class="card"><span>📷 Photos</span><strong>${stats.photos}</strong></article><article class="card"><span>📋 Audit global</span><strong>${stats.auditPct}%</strong></article><article class="card"><span>🎯 Actions réalisées</span><strong>${stats.actionsDone}/${stats.actions}</strong></article></section>
  <section class="grid cols-2"><article class="card"><div class="section-title"><div><h3>Centre d’attention</h3><div class="muted">Ce qui mérite une action ou une vérification.</div></div></div>${attention.length?`<div class="attention-list">${attention.slice(0,7).map(x=>`<button class="attention-item ${x.level}" data-attention-view="${x.view}"><span>${x.icon}</span><strong>${escapeHtml(x.text)}</strong><b>›</b></button>`).join('')}</div>`:'<div class="notice"><strong>La visite ne présente aucune étape majeure en attente.</strong></div>'}</article><article class="card"><div class="section-title"><div><h3>Assistant GDS</h3><div class="muted">Pistes prioritaires actuellement détectées.</div></div><button class="btn primary" id="open-assistant">Ouvrir</button></div>${stats.pistes.length?`<div class="dashboard-pistes">${stats.pistes.slice(0,3).map(p=>`<div><strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.category)} · confiance ${escapeHtml(p.confidence.label)}</span></div>`).join('')}</div>`:'<div class="empty">Complétez les mesures pour générer les pistes.</div>'}</article></section>
  <section class="card"><h3>Indicateurs de suivi par domaine</h3>${renderProfessionalIndicators(visit)}</section>`:''}
  <section class="grid cols-2" style="margin-top:16px"><article class="card"><h2>Actions rapides</h2><div class="actions"><button class="btn primary" id="new-farm">Nouvelle exploitation</button><button class="btn" id="new-visit">Nouvelle visite</button><button class="btn" id="open-animals">Ouvrir les animaux</button>${visit?'<button class="btn secondary" id="open-report">Rapports</button>':''}</div></article><article class="card"><h2>Dernières visites</h2>${db.visits.length?`<ul class="journal">${db.visits.slice().sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5).map(v=>`<li><strong>${escapeHtml(farmName(v.farmId))}</strong> — ${formatDate(v.date)}<br><span class="muted">${escapeHtml(v.type||'Visite')} · ${v.subjects?.length||0} sujet(s) · ${escapeHtml(v.status==='complete'?'Terminée':'En cours')}</span></li>`).join('')}</ul>`:'<div class="empty">Aucune visite enregistrée.</div>'}</article></section>`;
  document.getElementById('new-farm').onclick=()=>{setView('farms');setTimeout(()=>document.getElementById('farm-name')?.focus(),0)};
  document.getElementById('new-visit').onclick=()=>{setView('visits');setTimeout(()=>document.getElementById('visit-farm')?.focus(),0)};
  document.getElementById('open-animals').onclick=()=>setView('animals');document.getElementById('open-report')?.addEventListener('click',()=>setView('reports'));document.getElementById('open-assistant')?.addEventListener('click',()=>setView('assistant'));
  app.querySelectorAll('[data-attention-view]').forEach(b=>b.onclick=()=>setView(b.dataset.attentionView));
  document.getElementById('resume-draft')?.addEventListener('click',()=>setView(draft.kind==='farm'?'farms':'visits'));document.getElementById('discard-draft')?.addEventListener('click',()=>{clearDraft();renderDashboard()});
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
        <div class="field"><label for="farm-number">N° cheptel / EDE / exploitation</label><input id="farm-number" name="farmNumber" inputmode="numeric" autocomplete="off" placeholder="Ex. 65039026" value="${escapeHtml(farmDraft.farmNumber || '')}" /><small class="muted">Ce numéro relie automatiquement les données importées aux visites de l’exploitation.</small></div>
        <div class="row"><div class="field"><label>Éleveur</label><input name="farmer" value="${escapeHtml(farmDraft.farmer || '')}" /></div><div class="field"><label>Commune</label><input name="commune" value="${escapeHtml(farmDraft.commune || '')}" /></div></div>
        <div class="row"><div class="field"><label>Téléphone</label><input name="phone" inputmode="tel" value="${escapeHtml(farmDraft.phone || '')}" /></div><div class="field"><label>Courriel</label><input name="email" type="email" value="${escapeHtml(farmDraft.email || '')}" /></div></div>
        <div class="field"><label>Informations permanentes</label><textarea name="notes">${escapeHtml(farmDraft.notes || '')}</textarea></div>
        <button class="btn primary" type="submit">Ajouter l’exploitation</button>
      </form>
      <section class="card">
        <h3>Liste des exploitations</h3>
        ${db.farms.length ? `<div class="table-wrap"><table><thead><tr><th>Exploitation</th><th>Commune</th><th>Visites</th><th></th></tr></thead><tbody>${db.farms.map(f => `<tr><td><strong>${escapeHtml(f.name)}</strong><br><span class="muted">${escapeHtml(f.farmer || '')}${f.farmNumber?` · EDE ${escapeHtml(f.farmNumber)}`:''}</span></td><td>${escapeHtml(f.commune || '—')}</td><td>${db.visits.filter(v => v.farmId === f.id).length}</td><td><div class="actions"><button class="btn small" data-open-farm-journal="${f.id}">Journal</button><button class="btn small" data-open-farm-documents="${f.id}">Documents</button><button class="btn small" data-set-farm-number="${f.id}">N° EDE</button><button class="btn small danger" data-delete-farm="${f.id}">Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune exploitation.</div>'}
      </section>
    </section>`;
  const form = document.getElementById('farm-form');
  form.addEventListener('input', () => saveDraft({ kind: 'farm', data: Object.fromEntries(new FormData(form)) }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim()) return;
    db.farms.push({ id: uid('farm'), ...data, buildings:[], documents:[], journal:[], vigilances:[], registryLinked: !!registryAnimal, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    saveDatabase(db); clearDraft(); showToast('Exploitation ajoutée.'); renderFarms();
  });
  app.querySelectorAll('[data-open-farm-journal]').forEach(button=>button.onclick=()=>{localStorage.setItem('audit-bovin-journal-farm',button.dataset.openFarmJournal);setView('journal');});
  app.querySelectorAll('[data-open-farm-documents]').forEach(button=>button.onclick=()=>{localStorage.setItem('audit-bovin-documents-farm',button.dataset.openFarmDocuments);setView('documents');});
  app.querySelectorAll('[data-set-farm-number]').forEach(button => button.onclick = () => { const farm=db.farms.find(f=>f.id===button.dataset.setFarmNumber);if(!farm)return;const value=prompt('N° cheptel / EDE / exploitation',farm.farmNumber||normalizeHerdNumber(farm.farmer)||'');if(value===null)return;farm.farmNumber=String(value).trim();farm.updatedAt=new Date().toISOString();saveDatabase(db);showToast('Numéro EDE enregistré.');renderFarms(); });
  app.querySelectorAll('[data-delete-farm]').forEach(button => button.onclick = () => {
    const id = button.dataset.deleteFarm;
    if (db.visits.some(v => v.farmId === id)) return showToast('Suppression impossible : cette exploitation possède des visites.');
    if (confirm('Supprimer cette exploitation ?')) { db.farms = db.farms.filter(f => f.id !== id); saveDatabase(db); renderFarms(); }
  });
}



const farmDocumentCategories=['Analyse de fourrage','Analyse d’eau','Analyse de sol','Résultat de laboratoire','Rapport vétérinaire','Plan de bâtiment','Rapport d’audit','Photo de référence','Document partenaire','Autre document'];
function ensureFarmDocuments(farm){farm.documents=Array.isArray(farm.documents)?farm.documents:[];return farm.documents;}
function humanFileSize(bytes=0){if(bytes<1024)return `${bytes} o`;if(bytes<1048576)return `${(bytes/1024).toFixed(1)} Ko`;return `${(bytes/1048576).toFixed(1)} Mo`;}
function dataUrlToBlob(dataUrl){
  const parts=String(dataUrl||'').split(',');if(parts.length<2)throw new Error('Données de fichier invalides');
  const mime=(parts[0].match(/data:([^;]+)/)||[])[1]||'application/octet-stream';
  const binary=parts[0].includes(';base64')?atob(parts[1]):decodeURIComponent(parts[1]);
  const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
function downloadStoredDocument(docu){
  if(!docu?.dataUrl)return showToast('Le fichier n’est pas disponible sur cet appareil.');
  try{const blob=dataUrlToBlob(docu.dataUrl),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=docu.fileName||docu.title||'document';a.target='_blank';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(err){console.error(err);showToast('Impossible d’ouvrir ce document. Réimportez-le depuis le fichier d’origine.');}
}
function renderFarmDocuments(){
  const farmId=localStorage.getItem('audit-bovin-documents-farm')||activeVisit()?.farmId||db.farms[0]?.id||'';
  const farm=db.farms.find(f=>f.id===farmId);if(farm)ensureFarmDocuments(farm);
  const docs=farm?.documents?.slice().sort((a,b)=>(b.documentDate||b.createdAt||'').localeCompare(a.documentDate||a.createdAt||''))||[];
  app.innerHTML=`<div class="section-title"><div><h2>📁 Documents de l’exploitation</h2><div class="muted">Analyses de fourrages, eau, sol, résultats de laboratoire, plans et rapports externes.</div></div><span class="badge autosave">Sauvegarde locale + cloud</span></div>
  <section class="card"><div class="field"><label>Exploitation</label><select id="documents-farm-select"><option value="">Choisir…</option>${db.farms.map(f=>`<option value="${f.id}" ${f.id===farmId?'selected':''}>${escapeHtml(f.name)}${f.farmNumber?' · EDE '+escapeHtml(f.farmNumber):''}</option>`).join('')}</select></div></section>
  ${!farm?'<section class="card empty">Sélectionnez une exploitation.</section>':`<section class="grid cols-2"><form id="farm-document-form" class="card"><h3>Ajouter un document</h3><div class="field"><label>Fichier *</label><input id="farm-document-file" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/*"></div><div class="row"><div class="field"><label>Catégorie</label><select name="category">${farmDocumentCategories.map(c=>`<option>${escapeHtml(c)}</option>`).join('')}</select></div><div class="field"><label>Date du document</label><input name="documentDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div></div><div class="field"><label>Titre</label><input name="title" placeholder="Ex. Analyse ensilage maïs 2026"></div><div class="field"><label>Commentaire</label><textarea name="notes" placeholder="Résultat important, laboratoire, parcelle, lot concerné…"></textarea></div><button class="btn primary" type="submit">Enregistrer le document</button><p class="muted small-text">Pour préserver la sauvegarde et la synchronisation, la taille maximale est limitée à 4 Mo par fichier. Les fichiers sont inclus dans la base partagée.</p></form><article class="card"><h3>Résumé du dossier</h3><div class="grid cols-2 professional-kpis"><div><span>Documents</span><strong>${docs.length}</strong></div><div><span>Volume enregistré</span><strong>${humanFileSize(docs.reduce((s,d)=>s+(Number(d.size)||0),0))}</strong></div></div><div class="document-category-summary">${farmDocumentCategories.map(c=>{const n=docs.filter(d=>d.category===c).length;return n?`<span>${escapeHtml(c)} <b>${n}</b></span>`:''}).join('')}</div></article></section>
  <section class="card"><div class="section-title"><div><h3>Documents enregistrés</h3><div class="muted">Ils suivent l’exploitation dans les exports JSON et la synchronisation Supabase.</div></div><input id="documents-search" placeholder="Rechercher un titre, une catégorie…"></div><div id="documents-list" class="farm-documents-list"></div></section>`}`;
  document.getElementById('documents-farm-select').onchange=e=>{localStorage.setItem('audit-bovin-documents-farm',e.target.value);renderFarmDocuments();};
  if(!farm)return;
  const renderList=()=>{const q=normalizeSearchText(document.getElementById('documents-search')?.value||'');const list=docs.filter(d=>!q||normalizeSearchText([d.title,d.category,d.fileName,d.notes].join(' ')).includes(q));document.getElementById('documents-list').innerHTML=list.length?list.map(d=>`<article class="farm-document-card"><div class="farm-document-icon">${String(d.mimeType||'').startsWith('image/')?'🖼️':String(d.mimeType||'').includes('pdf')?'📄':'📎'}</div><div><span class="badge">${escapeHtml(d.category||'Document')}</span><h4>${escapeHtml(d.title||d.fileName||'Document')}</h4><small>${d.documentDate?formatDate(d.documentDate):formatDateTime(d.createdAt)} · ${humanFileSize(d.size)} · ${escapeHtml(d.fileName||'')}</small>${d.notes?`<p>${escapeHtml(d.notes)}</p>`:''}</div><div class="actions"><button class="btn small action-export" data-download-farm-doc="${d.id}">Ouvrir / télécharger</button><button class="btn small danger" data-delete-farm-doc="${d.id}">Supprimer</button></div></article>`).join(''):'<div class="empty">Aucun document correspondant.</div>';app.querySelectorAll('[data-download-farm-doc]').forEach(b=>b.onclick=()=>downloadStoredDocument(farm.documents.find(d=>d.id===b.dataset.downloadFarmDoc)));app.querySelectorAll('[data-delete-farm-doc]').forEach(b=>b.onclick=()=>{if(!confirm('Supprimer définitivement ce document ?'))return;farm.documents=farm.documents.filter(d=>d.id!==b.dataset.deleteFarmDoc);farm.updatedAt=new Date().toISOString();saveDatabase(db);renderFarmDocuments();});};
  document.getElementById('documents-search').oninput=renderList;renderList();
  document.getElementById('farm-document-form').onsubmit=e=>{e.preventDefault();const file=document.getElementById('farm-document-file').files?.[0];if(!file)return showToast('Choisissez un fichier.');if(file.size>4*1024*1024)return showToast('Fichier trop volumineux : maximum 4 Mo.');const fd=Object.fromEntries(new FormData(e.currentTarget));const reader=new FileReader();reader.onerror=()=>showToast('Lecture du fichier impossible.');reader.onload=()=>{try{farm.documents.push({id:uid('document'),category:fd.category,title:(fd.title||file.name).trim(),documentDate:fd.documentDate,notes:fd.notes||'',fileName:file.name,mimeType:file.type||'application/octet-stream',size:file.size,dataUrl:reader.result,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});farm.updatedAt=new Date().toISOString();saveDatabase(db);showToast('Document enregistré dans le dossier de l’exploitation.');renderFarmDocuments();}catch(err){console.error(err);showToast('Enregistrement impossible : espace local insuffisant. Réduisez la taille du fichier.');}};reader.readAsDataURL(file);};
}

const journalEventTypes=['Appel téléphonique','Mail / message','Passage rapide','Action réalisée','Action partiellement réalisée','Difficulté / blocage','Problème sanitaire','Alimentation / ration','Bâtiment / eau / électricité','Reproduction','Mortalité','Retour vétérinaire','Autre'];
const journalLevels=['Information','À surveiller','Urgent'];
function ensureFarmTracking(farm){farm.journal=Array.isArray(farm.journal)?farm.journal:[];farm.vigilances=Array.isArray(farm.vigilances)?farm.vigilances:[];return farm;}
function renderJournalSuivi(){
  const farmId=localStorage.getItem('audit-bovin-journal-farm')||db.farms[0]?.id||'',farm=db.farms.find(f=>f.id===farmId);if(farm)ensureFarmTracking(farm);
  const visits=farm?db.visits.filter(v=>v.farmId===farm.id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')):[];
  const actions=visits.flatMap(v=>(v.analysisActions||[]).map(a=>({visit:v,action:a}))),preAction=localStorage.getItem('audit-bovin-journal-action')||'';localStorage.removeItem('audit-bovin-journal-action');
  app.innerHTML=`<div class="section-title"><div><h2>📒 Journal & points de vigilance</h2><div class="muted">Noter les nouvelles reçues entre deux visites, les difficultés et les événements sanitaires.</div></div><span class="badge autosave">v14.6.15</span></div>
  <section class="card journal-farm-select"><div class="field"><label>Exploitation</label><select id="journal-farm-select"><option value="">Choisir…</option>${db.farms.map(f=>`<option value="${f.id}" ${f.id===farmId?'selected':''}>${escapeHtml(f.name)}${f.farmNumber?' · '+escapeHtml(f.farmNumber):''}</option>`).join('')}</select></div></section>
  ${!farm?'<section class="card empty">Sélectionnez une exploitation.</section>':`
  <section class="grid cols-2"><form id="journal-entry-form" class="card"><h3>Ajouter une nouvelle</h3><div class="row"><div class="field"><label>Date et heure</label><input name="date" type="datetime-local" value="${new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}"></div><div class="field"><label>Origine / type</label><select name="type">${journalEventTypes.map(x=>`<option>${x}</option>`).join('')}</select></div></div><div class="row"><div class="field"><label>Niveau</label><select name="level">${journalLevels.map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label>Statut</label><select name="status"><option>Ouvert</option><option>Résolu</option><option>À revoir à la prochaine visite</option></select></div></div><div class="field"><label>Description *</label><textarea name="text" required placeholder="Ex. L'éleveur indique que le deuxième abreuvoir est installé…"></textarea></div><div class="row"><div class="field"><label>Visite liée</label><select name="visitId"><option value="">Aucune</option>${visits.map(v=>`<option value="${v.id}">${formatDate(v.date)} · ${escapeHtml(v.type||'Visite')}</option>`).join('')}</select></div><div class="field"><label>Action liée</label><select name="actionId"><option value="">Aucune</option>${actions.map(x=>`<option value="${x.action.id}" ${x.action.id===preAction?'selected':''}>${escapeHtml(x.action.text||'Action')}</option>`).join('')}</select></div></div><div class="field"><label>Technicien</label><input name="technician" value="${escapeHtml(window.auditCloud?.session?.user?.email||'')}"></div><button class="btn primary" type="submit">Enregistrer la nouvelle</button></form>
  <form id="vigilance-form" class="card"><h3>🚩 Ajouter un point de vigilance</h3><div class="field"><label>Point à garder en mémoire *</label><textarea name="text" required placeholder="Ex. Recontrôler le débit du nouvel abreuvoir."></textarea></div><div class="row"><div class="field"><label>Échéance indicative</label><input name="dueDate" type="date"></div><div class="field"><label>Priorité</label><select name="priority"><option>Haute</option><option selected>Moyenne</option><option>Basse</option></select></div></div><button class="btn primary" type="submit">Ajouter la vigilance</button><hr><h4>Points actifs</h4><div class="vigilance-list">${farm.vigilances.filter(v=>!v.done).length?farm.vigilances.filter(v=>!v.done).map(v=>`<article class="vigilance-item ${v.priority==='Haute'?'high':''}"><div><strong>${escapeHtml(v.text)}</strong><small>${v.dueDate?'Échéance '+formatDate(v.dueDate):'Sans échéance'} · ${escapeHtml(v.priority)}</small></div><button type="button" class="btn small" data-close-vigilance="${v.id}">Marquer vérifié</button></article>`).join(''):'<div class="empty compact">Aucun point actif.</div>'}</div></form></section>
  <section class="card"><div class="section-title"><div><h3>Chronologie de l'exploitation</h3><div class="muted">Les informations restent indépendantes des visites et sont partagées par la base cloud.</div></div></div><div class="farm-timeline">${farm.journal.length?farm.journal.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(e=>`<article class="timeline-note level-${e.level==='Urgent'?'urgent':e.level==='À surveiller'?'watch':'info'}"><div class="timeline-dot"></div><div><header><strong>${escapeHtml(e.type)}</strong><span>${formatDateTime(e.date)}</span></header><p>${escapeHtml(e.text).replace(/\n/g,'<br>')}</p><small>${escapeHtml(e.technician||'Technicien non renseigné')} · ${escapeHtml(e.status||'Ouvert')}</small>${e.actionId?'<span class="badge">Lié à une action</span>':''}</div><button class="btn small danger" data-delete-journal="${e.id}">Supprimer</button></article>`).join(''):'<div class="empty">Aucune nouvelle enregistrée.</div>'}</div></section>`}`;
  document.getElementById('journal-farm-select').onchange=e=>{localStorage.setItem('audit-bovin-journal-farm',e.target.value);renderJournalSuivi();};
  document.getElementById('journal-entry-form')?.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));if(!d.text.trim())return;const entry={id:uid('journal'),...d,date:new Date(d.date).toISOString(),createdAt:new Date().toISOString()};farm.journal.push(entry);if(d.actionId){const x=actions.find(x=>x.action.id===d.actionId);if(x){x.action.history=Array.isArray(x.action.history)?x.action.history:[];x.action.history.push({id:uid('action-history'),date:entry.date,status:x.action.status,note:d.text,technician:d.technician});if(d.type==='Action réalisée')x.action.status='Réalisé';if(d.type==='Action partiellement réalisée')x.action.status='En cours';if(d.type==='Difficulté / blocage')x.action.status='Bloquée';x.action.progressNote=d.text;}}farm.updatedAt=new Date().toISOString();saveDatabase(db);showToast('Nouvelle enregistrée.');renderJournalSuivi();});
  document.getElementById('vigilance-form')?.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));if(!d.text.trim())return;farm.vigilances.push({id:uid('vigilance'),...d,done:false,createdAt:new Date().toISOString()});farm.updatedAt=new Date().toISOString();saveDatabase(db);renderJournalSuivi();});
  app.querySelectorAll('[data-close-vigilance]').forEach(b=>b.onclick=()=>{const v=farm.vigilances.find(x=>x.id===b.dataset.closeVigilance);if(v){v.done=true;v.doneAt=new Date().toISOString();saveDatabase(db);renderJournalSuivi();}});
  app.querySelectorAll('[data-delete-journal]').forEach(b=>b.onclick=()=>{if(!confirm('Supprimer cette entrée du journal ?'))return;farm.journal=farm.journal.filter(x=>x.id!==b.dataset.deleteJournal);saveDatabase(db);renderJournalSuivi();});
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

async function shareVisitFile(visit){
  if(!visit)return;
  const farm=db.farms.find(f=>f.id===visit.farmId);
  const payload={schemaVersion:2,farm,visit};
  const filename=`${slugify(farmName(visit.farmId))}-${visit.date||'visite'}.json`;
  const json=JSON.stringify(payload,null,2);
  try{
    const file=new File([json],filename,{type:'application/json'});
    if(navigator.share&&navigator.canShare?.({files:[file]})){
      await navigator.share({title:`Visite ${farmName(visit.farmId)}`,text:`Visite du ${formatDate(visit.date)} à importer dans Audit Bovin GDS 32-65.`,files:[file]});
      showToast('Visite partagée.');
      return;
    }
  }catch(err){if(err?.name==='AbortError')return;console.warn('Partage système indisponible',err);}
  downloadJson(filename,payload);
  showToast('Le fichier JSON de la visite a été téléchargé : envoyez-le à votre collègue.');
}

function renderVisits() {
  const editVisit = editingVisitId ? db.visits.find(v => v.id === editingVisitId) : null;
  const farmFilter=localStorage.getItem('audit-bovin-visits-farm')||'';
  const statusFilter=localStorage.getItem('audit-bovin-visits-status')||'';
  const search=(localStorage.getItem('audit-bovin-visits-search')||'').trim().toLowerCase();
  const ordered=db.visits.slice().sort((a,b)=>(b.date||b.updatedAt||'').localeCompare(a.date||a.updatedAt||''));
  const filtered=ordered.filter(v=>(!farmFilter||v.farmId===farmFilter)&&(!statusFilter||v.status===statusFilter)&&(!search||[farmName(v.farmId),v.technician,v.type,v.date].join(' ').toLowerCase().includes(search)));
  app.innerHTML = `
    <div class="section-title"><div><h2>Visites</h2><div class="muted">Toutes les visites enregistrées restent accessibles, y compris les plus anciennes.</div></div><span class="badge autosave">v14.6.15</span></div>
    <section class="grid cols-2">${visitFormHtml(editVisit || {})}<section class="card"><div class="section-title"><div><h3>Historique complet</h3><div class="muted">${filtered.length} visite(s) affichée(s) sur ${db.visits.length}</div></div><button class="btn small" id="reset-visit-filters">Réinitialiser</button></div>
    <div class="grid cols-3 visit-history-filters"><div class="field"><label>Rechercher</label><input id="visit-search" value="${escapeHtml(search)}" placeholder="Exploitation, technicien, type…"></div><div class="field"><label>Exploitation</label><select id="visit-farm-filter"><option value="">Toutes</option>${db.farms.map(f=>`<option value="${f.id}" ${f.id===farmFilter?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}</select></div><div class="field"><label>Statut</label><select id="visit-status-filter"><option value="">Tous</option><option value="in-progress" ${statusFilter==='in-progress'?'selected':''}>En cours</option><option value="complete" ${statusFilter==='complete'?'selected':''}>Terminées</option></select></div></div>
    ${filtered.length?`<div class="table-wrap visit-history-table"><table><thead><tr><th>Exploitation</th><th>Date</th><th>Type</th><th>Sujets</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${filtered.map(v=>`<tr class="${v.id===activeVisitId?'active-history-row':''}"><td><strong>${escapeHtml(farmName(v.farmId))}</strong><br><span class="muted">${escapeHtml(v.technician||'')}</span></td><td>${formatDate(v.date)}</td><td>${escapeHtml(v.type||'—')}</td><td>${v.subjects?.length||0}</td><td><span class="badge ${v.status==='complete'?'complete':'in-progress'}">${v.status==='complete'?'Terminée':'En cours'}</span></td><td><div class="actions"><button class="btn small primary" data-edit-visit="${v.id}">Ouvrir</button><button class="btn small" data-open-animals="${v.id}">Animaux</button><button class="btn small secondary" data-compare-visit="${v.id}">Comparer</button><button class="btn small" data-share-visit="${v.id}">Partager</button><button class="btn small secondary" data-export-visit="${v.id}">JSON</button><button class="btn small danger" data-delete-visit="${v.id}">Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Aucune visite ne correspond aux filtres.</div>'}</section></section>
    ${editVisit?renderPreviousVisitReview(editVisit):''}${editVisit?`<section class="card" style="margin-top:16px"><h3>Journal de la visite</h3>${editVisit.journal?.length?`<ul class="journal">${editVisit.journal.map(j=>`<li><strong>${formatDateTime(j.at)}</strong><br>${escapeHtml(j.message)}</li>`).join('')}</ul>`:'<div class="empty">Aucune modification enregistrée.</div>'}</section>`:''}`;
  const form=document.getElementById('visit-form');
  form.addEventListener('input',()=>saveDraft({kind:'visit',data:Object.fromEntries(new FormData(form))}));
  form.addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));if(!data.farmId||!data.date)return showToast('Exploitation et date obligatoires.');if(editVisit){Object.assign(editVisit,data,{updatedAt:new Date().toISOString()});addJournal(editVisit,'Informations générales mises à jour.');showToast('Visite mise à jour.');}else{const visit={id:uid('visit'),...data,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),journal:[],subjects:[]};addJournal(visit,'Visite créée.');db.visits.push(visit);ensurePreviousVisitReview(visit);setActiveVisit(visit.id);editingVisitId=null;showToast(visit.previousVisitReview?.previousVisitId?'Visite créée : commencez par contrôler les actions précédentes.':'Visite créée.');}saveDatabase(db);clearDraft();editingVisitId=null;renderVisits();});
  document.getElementById('cancel-edit')?.addEventListener('click',()=>{editingVisitId=null;clearDraft();renderVisits();});
  const rerender=()=>renderVisits();
  const visitSearch=document.getElementById('visit-search');if(visitSearch){visitSearch.addEventListener('input',e=>{localStorage.setItem('audit-bovin-visits-search',e.target.value);});visitSearch.addEventListener('change',rerender);visitSearch.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();rerender();}});}
  document.getElementById('visit-farm-filter')?.addEventListener('change',e=>{localStorage.setItem('audit-bovin-visits-farm',e.target.value);rerender()});
  document.getElementById('visit-status-filter')?.addEventListener('change',e=>{localStorage.setItem('audit-bovin-visits-status',e.target.value);rerender()});
  document.getElementById('reset-visit-filters')?.addEventListener('click',()=>{['audit-bovin-visits-search','audit-bovin-visits-farm','audit-bovin-visits-status'].forEach(k=>localStorage.removeItem(k));rerender()});
  app.querySelectorAll('[data-edit-visit]').forEach(b=>b.onclick=()=>{setActiveVisit(b.dataset.editVisit);editingVisitId=b.dataset.editVisit;clearDraft();renderVisits();window.scrollTo({top:0,behavior:'smooth'});});
  app.querySelectorAll('[data-open-animals]').forEach(b=>b.onclick=()=>{setActiveVisit(b.dataset.openAnimals);setView('animals')});
  app.querySelectorAll('[data-compare-visit]').forEach(b=>b.onclick=()=>{const v=db.visits.find(x=>x.id===b.dataset.compareVisit);if(!v)return;localStorage.setItem('audit-bovin-followup-farm',v.farmId);localStorage.setItem('audit-bovin-followup-visits',JSON.stringify([v.id]));setView('followup')});
  app.querySelectorAll('[data-share-visit]').forEach(b=>b.onclick=()=>shareVisitFile(db.visits.find(v=>v.id===b.dataset.shareVisit)));
  app.querySelectorAll('[data-export-visit]').forEach(b=>b.onclick=()=>{const visit=db.visits.find(v=>v.id===b.dataset.exportVisit);downloadJson(`${slugify(farmName(visit.farmId))}-${visit.date||'visite'}.json`,{schemaVersion:2,farm:db.farms.find(f=>f.id===visit.farmId),visit})});
  app.querySelectorAll('[data-delete-visit]').forEach(b=>b.onclick=()=>{const id=b.dataset.deleteVisit,visit=db.visits.find(v=>v.id===id);if(!visit)return;if(confirm(`Supprimer définitivement la visite du ${formatDate(visit.date)} pour ${farmName(visit.farmId)} ?\n\nElle sera aussi supprimée de la base commune.`)){db.deletedVisitIds=[...new Set([...(db.deletedVisitIds||[]),id])];db.visits=db.visits.filter(v=>v.id!==id);if(activeVisitId===id)setActiveVisit('');if(editingVisitId===id)editingVisitId=null;saveDatabase(db);showToast('Visite supprimée. La suppression sera synchronisée dans le cloud.');renderVisits();}});
  if(editVisit)bindPreviousVisitReview(editVisit);
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

function registryCoherenceIssues(subject,a,atDate){
  const issues=[];
  if(subject.birthDate&&a.birthDate&&subject.birthDate!==a.birthDate)issues.push(`date de naissance saisie ${formatDate(subject.birthDate)} ≠ registre ${formatDate(a.birthDate)}`);
  if(subject.breedCode&&a.breed&&normalizeSearchText(subject.breedCode)!==normalizeSearchText(a.breed))issues.push(`race saisie ${subject.breedCode} ≠ registre ${a.breed}`);
  if(subject.sex&&a.sex&&normalizeSearchText(subject.sex)!==normalizeSearchText(a.sex))issues.push(`sexe saisi ${subject.sex} ≠ registre ${a.sex}`);
  const femaleCats=['Génisse','Préparation vêlage','Tarie','Fraîche vêlée','Début lactation','Pic de lactation','Milieu lactation','Fin lactation','Vache allaitante'];
  if(a.sex==='M'&&femaleCats.includes(subject.category))issues.push(`catégorie « ${subject.category} » incohérente avec le sexe M du registre`);
  const age=monthsBetweenDates(a.birthDate,atDate);
  if(subject.category==='Veau 0–15 jours'&&age!=null&&age>1)issues.push('catégorie veau 0–15 jours incohérente avec l’âge du registre');
  if(subject.category==='Veau 15–60 jours'&&age!=null&&age>3)issues.push('catégorie veau 15–60 jours incohérente avec l’âge du registre');
  return issues;
}
function linkSubjectToReproduction(subject,visit,{fillBlanks=true}={}){
  if(!subject||!visit)return {status:'none'};
  const farm=db.farms.find(f=>f.id===visit.farmId);if(!farm)return {status:'none'};
  const source=reproductionSourceForVisit(visit,farm),registry=source.registry||[];if(!registry.length){subject.registryLinkStatus='no-registry';subject.registryCoherenceIssues=[];return {status:'no-registry'};}
  const registryFarm={...farm,herdRegistry:registry},query=subject.registryAnimalId||subject.workNumber||subject.tag||subject.identifier||'',match=resolveRegistryAnimal(registryFarm,query);
  if(match?.ambiguous){subject.registryLinked=false;subject.registryLinkStatus='ambiguous';subject.registryCoherenceIssues=[`Plusieurs bovins correspondent à « ${query} » dans le registre Reproduction.`];return {status:'ambiguous',items:match.items,registryFarm};}
  if(!match?.animal){subject.registryLinked=false;subject.registryLinkStatus='not-found';subject.registryCoherenceIssues=[`« ${query} » n’a pas été retrouvé dans le registre Reproduction de cette visite.`];return {status:'not-found',registryFarm};}
  const a=match.animal,repro=reproductionForCow(registryFarm,a.id),atDate=visit.date||new Date().toISOString().slice(0,10),issues=registryCoherenceIssues(subject,a,atDate);
  const fill=(key,value)=>{if(fillBlanks&&(subject[key]===undefined||subject[key]===null||subject[key]==='')&&value!==undefined&&value!==null&&value!=='')subject[key]=value;};
  subject.registryAnimalId=a.id;subject.registryWorkNumber=a.workNumber||subject.registryWorkNumber||'';subject.registryLinked=true;subject.registryLinkStatus=issues.length?'warning':'ok';subject.registryMatchType=match.matchType||'';subject.registryCoherenceIssues=issues;
  fill('name',a.name||'');fill('birthDate',a.birthDate||'');fill('age',a.birthDate?ageLabelAt(a.birthDate,atDate):'');fill('breedCode',a.breed||'');fill('sex',a.sex||'');fill('motherNumber',a.motherId||'');
  fill('rank',repro?.calves?.length??'');fill('lastCalvingDate',repro?.lastCalvingDate||'');fill('lastCalfId',repro?.lastCalf?.id||'');fill('firstCalvingAgeMonths',repro?.firstCalvingAgeMonths??'');fill('lastIVV',repro?.lastIVV??'');fill('meanIVV',repro?.meanIVV??'');
  return {status:subject.registryLinkStatus,animal:a,repro,registryFarm};
}
function enrichVisitSubjectsFromReproduction(visit){
  if(!visit)return false;
  const before=JSON.stringify((visit.subjects||[]).map(s=>({id:s.id,registryAnimalId:s.registryAnimalId,registryLinked:s.registryLinked,registryLinkStatus:s.registryLinkStatus,registryCoherenceIssues:s.registryCoherenceIssues,name:s.name,birthDate:s.birthDate,age:s.age,breedCode:s.breedCode,sex:s.sex,motherNumber:s.motherNumber,rank:s.rank,lastCalvingDate:s.lastCalvingDate,lastIVV:s.lastIVV,meanIVV:s.meanIVV})));
  (visit.subjects||[]).forEach(subject=>linkSubjectToReproduction(subject,visit,{fillBlanks:true}));
  const after=JSON.stringify((visit.subjects||[]).map(s=>({id:s.id,registryAnimalId:s.registryAnimalId,registryLinked:s.registryLinked,registryLinkStatus:s.registryLinkStatus,registryCoherenceIssues:s.registryCoherenceIssues,name:s.name,birthDate:s.birthDate,age:s.age,breedCode:s.breedCode,sex:s.sex,motherNumber:s.motherNumber,rank:s.rank,lastCalvingDate:s.lastCalvingDate,lastIVV:s.lastIVV,meanIVV:s.meanIVV})));
  const changed=before!==after;if(changed){visit.updatedAt=new Date().toISOString();saveDatabase(db);}return changed;
}

function subjectCardHtml(subject, index) {
  const isOpen = openSubjectId === subject.id;
  const category = subject.category || 'Non classé';
  const stageDetail = subject.stage === 'Pleine' && subject.gestationMonths ? `${subject.gestationMonths} mois` : subject.stage === 'Lactation' && subject.lactationDays ? `${subject.lactationDays} JEL` : subject.stage || 'Non renseigné';
  return `<article class="subject-card ${isOpen ? 'open' : ''}" data-subject-card="${subject.id}">
    <button type="button" class="subject-summary" data-toggle-subject="${subject.id}" aria-expanded="${isOpen}">
      <span class="subject-number">${index + 1}</span>
      <span class="subject-main"><strong>${escapeHtml(subject.tag || `Sujet ${index + 1}`)}${subject.name?` · ${escapeHtml(subject.name)}`:''}</strong><small>${escapeHtml(subject.location || 'Emplacement non renseigné')}${subject.registryAnimalId&&normalizeAnimalId(subject.registryAnimalId)!==normalizeAnimalId(subject.tag)?` · Boucle ${escapeHtml(subject.registryAnimalId)}`:''}${subject.age?` · ${escapeHtml(subject.age)}`:''}${subject.lastCalvingDate?` · Dernier vêlage ${formatDate(subject.lastCalvingDate)}`:''}</small>${subject.registryLinkStatus==='warning'||subject.registryLinkStatus==='ambiguous'||subject.registryLinkStatus==='not-found'?`<em class="registry-warning-inline">⚠ Cohérence registre à vérifier</em>`:subject.registryLinkStatus==='ok'?`<em class="registry-ok-inline">✓ Retrouvé dans le registre Repro</em>`:''}</span>
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
        <div class="row"><div class="field"><label>Numéro de boucle / repère</label><input name="tag" value="${escapeHtml(subject.tag || '')}" required inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" /></div><div class="field"><label>Nom (facultatif)</label><input name="name" value="${escapeHtml(subject.name || '')}" /></div></div>
        <div class="field"><label>Emplacement</label><input name="location" value="${escapeHtml(subject.location || '')}" placeholder="Ex. 2e place, 3e travée" /></div>
        <div class="field"><label>Observation d’identification</label><textarea name="notes" placeholder="Ex. corne cassée, robe particulière…">${escapeHtml(subject.notes || '')}</textarea></div>
      </section>
      <section>
        <h4>Classement</h4>
        <div class="field"><label>Catégorie</label><select name="category">${categories.map(value => `<option ${subject.category === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div class="field"><label>Stade physiologique</label><select name="stage">${physiologicalStages.map(value => `<option ${subject.stage === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div class="row"><div class="field"><label>Mois de gestation</label><input name="gestationMonths" type="number" min="1" max="9" inputmode="numeric" value="${escapeHtml(subject.gestationMonths || '')}" /></div><div class="field"><label>Jours en lactation</label><input name="lactationDays" type="number" min="0" inputmode="numeric" value="${escapeHtml(subject.lactationDays || '')}" /></div></div>
        <div class="row"><div class="field"><label>Âge</label><input name="age" value="${escapeHtml(subject.age || '')}" placeholder="Ex. 4 ans" /></div><div class="field"><label>Rang (nombre de veaux)</label><input name="rank" type="number" min="0" inputmode="numeric" value="${escapeHtml(subject.rank ?? '')}" /></div></div>
        <div class="row"><div class="field"><label>Code race</label><input name="breedCode" value="${escapeHtml(subject.breedCode || '')}" placeholder="Code race du registre" /></div><div class="field"><label>Date du dernier vêlage</label><input name="lastCalvingDate" type="date" value="${escapeHtml(subject.lastCalvingDate || '')}" /></div></div>
        <div class="field"><label>Lot</label><input name="lot" value="${escapeHtml(subject.lot || '')}" /></div>
      </section>
    </div>
    ${subject.registryLinked?`<section class="subject-registry-info"><h4>📋 Données du registre Reproduction</h4><div class="subject-registry-grid"><span><small>N° travail</small><strong>${escapeHtml(subject.registryWorkNumber||'—')}</strong></span><span><small>N° bovin</small><strong>${escapeHtml(subject.registryAnimalId||'—')}</strong></span><span><small>Nom</small><strong>${escapeHtml(subject.name||'—')}</strong></span><span><small>Date de naissance</small><strong>${subject.birthDate?formatDate(subject.birthDate):'—'}</strong></span><span><small>Âge à la visite</small><strong>${escapeHtml(subject.age||'—')}</strong></span><span><small>Race</small><strong>${escapeHtml(subject.breedCode||'—')}</strong></span><span><small>Dernier vêlage</small><strong>${subject.lastCalvingDate?formatDate(subject.lastCalvingDate):'—'}</strong></span><span><small>Dernier IVV</small><strong>${subject.lastIVV!==''&&subject.lastIVV!=null?`${subject.lastIVV} j`:'—'}</strong></span></div>${subject.registryCoherenceIssues?.length?`<div class="registry-coherence warning"><strong>⚠ Problème de cohérence</strong><ul>${subject.registryCoherenceIssues.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`:'<div class="registry-coherence ok">✓ Identification cohérente avec le registre Reproduction.</div>'}</section>`:subject.registryLinkStatus==='not-found'||subject.registryLinkStatus==='ambiguous'?`<section class="registry-coherence warning"><strong>⚠ Lien registre Reproduction</strong><p>${escapeHtml(subject.registryCoherenceIssues?.[0]||'Bovin non retrouvé.')}</p></section>`:''}
    <section class="measurement-overview"><h4>Suivi des mesures</h4><div class="measure-chips">${measurementFamilies.map(([key,label,icon]) => { const status = measurementStatus(subject,key); return `<button type="button" class="measure-chip ${status}" data-open-measure="${key}" data-subject-id="${subject.id}">${icon} ${label}<small>${status === 'complete' ? 'Fait' : status === 'partial' ? 'Partiel' : 'Non réalisé'}</small></button>`; }).join('')}</div><p class="muted small-text">Cliquez sur une famille pour ouvrir directement sa matrice et la ligne de cet animal.</p></section>
    <div class="actions subject-actions"><span class="autosave-indicator">✓ Enregistrement automatique</span><button type="button" class="btn danger" data-delete-subject="${subject.id}">Supprimer le sujet</button></div>
  </form>`;
}


function enhanceNumericEntry(root=app){
  if(!root)return;
  root.querySelectorAll('input[type="number"]').forEach(el=>{
    const decimal=el.step==='any'||el.getAttribute('step')?.includes('.')||el.hasAttribute('data-numeric-general')||el.hasAttribute('data-numeric-observation');
    if(!el.hasAttribute('inputmode'))el.setAttribute('inputmode',decimal?'decimal':'numeric');
  });
  root.querySelectorAll('.analysis-input,[data-numeric-general],[data-numeric-observation]').forEach(el=>el.setAttribute('inputmode','decimal'));
  root.querySelectorAll('#subject-tag,input[name="tag"]').forEach(el=>{
    el.setAttribute('inputmode','numeric');
    el.setAttribute('pattern','[0-9]*');
    el.setAttribute('enterkeyhint','next');
  });
  root.querySelectorAll('input[inputmode="numeric"],input[inputmode="decimal"],.analysis-input').forEach(el=>{
    if(!el.getAttribute('enterkeyhint'))el.setAttribute('enterkeyhint','next');
    if(el.dataset.fastNavBound==='1')return;
    el.dataset.fastNavBound='1';
    el.addEventListener('keydown',event=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      const key=event.key;
      if(!['Enter','ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(key))return;
      const numericInputs=[...root.querySelectorAll('input[inputmode="numeric"],input[inputmode="decimal"],.analysis-input')].filter(x=>!x.disabled&&!x.readOnly&&x.offsetParent!==null);
      const focusInput=target=>{if(!target)return false;event.preventDefault();target.focus();if(typeof target.select==='function')target.select();return true;};
      if(key==='ArrowUp'||key==='ArrowDown'){
        const row=el.closest('tr');
        if(row){
          const cell=el.closest('td,th');
          const cells=[...row.children];
          const cellIndex=cells.indexOf(cell);
          let sibling=key==='ArrowDown'?row.nextElementSibling:row.previousElementSibling;
          while(sibling){
            const targetCell=sibling.children?.[cellIndex];
            const target=targetCell?.querySelector('input[inputmode="numeric"],input[inputmode="decimal"],.analysis-input');
            if(target&&!target.disabled&&!target.readOnly&&target.offsetParent!==null){focusInput(target);return;}
            sibling=key==='ArrowDown'?sibling.nextElementSibling:sibling.previousElementSibling;
          }
        }
      }
      const i=numericInputs.indexOf(el);
      if(i<0)return;
      if(key==='Enter')focusInput(numericInputs[i+1]);
      else if(key==='ArrowRight'){
        const end=typeof el.selectionEnd==='number'?el.selectionEnd:String(el.value||'').length;
        if(end>=String(el.value||'').length)focusInput(numericInputs[i+1]);
      } else if(key==='ArrowLeft'){
        const start=typeof el.selectionStart==='number'?el.selectionStart:0;
        if(start<=0)focusInput(numericInputs[i-1]);
      } else if(key==='ArrowDown')focusInput(numericInputs[i+1]);
      else if(key==='ArrowUp')focusInput(numericInputs[i-1]);
    });
  });
}

function renderAnimals() {
  const visits = db.visits.slice().sort((a,b) => (b.date || '').localeCompare(a.date || ''));
  if (!activeVisitId && visits.length) setActiveVisit(visits[0].id);
  const visit = activeVisit();
  if(visit)enrichVisitSubjectsFromReproduction(visit);
  app.innerHTML = `
    <div class="section-title"><div><h2>Animaux / sujets de la visite</h2><div class="muted">Saisir d’abord le numéro de boucle et l’emplacement. Le classement peut être complété plus tard.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
    ${activeVisitBanner(visit)}
    ${!visit ? `<section class="empty" style="margin-top:16px">Créez ou sélectionnez une visite avant d’ajouter des sujets.</section>` : `
      <section class="grid cols-2 animal-workspace" style="margin-top:16px">
        <form id="quick-subject-form" class="card quick-subject-form">
          <h3>Ajouter un sujet</h3>
          <p class="muted">Le numéro de travail suffit s’il est présent dans le fichier Reproduction : nom, âge, race et dernier vêlage seront récupérés automatiquement.</p>
          <div class="field"><label for="subject-tag">Numéro de boucle / n° de travail *</label><input id="subject-tag" name="tag" required autocomplete="off" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" placeholder="Ex. 6248" /></div><div id="subject-registry-preview" class="registry-lookup-preview muted">Saisissez un numéro : l’application cherchera automatiquement le bovin dans le fichier Reproduction de cette visite.</div>
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


  enhanceNumericEntry(app);
  const quickForm = document.getElementById('quick-subject-form');
  const tagInput=document.getElementById('subject-tag'),registryPreview=document.getElementById('subject-registry-preview');
  const visitFarm=db.farms.find(f=>f.id===visit?.farmId),visitReproSource=visit&&visitFarm?reproductionSourceForVisit(visit,visitFarm):{registry:[]},visitRegistryFarm=visitFarm?{...visitFarm,herdRegistry:visitReproSource.registry||[]}:null;
  const renderRegistryPreview=()=>{if(!tagInput||!registryPreview||!visitRegistryFarm)return;const q=tagInput.value.trim();if(!q){registryPreview.className='registry-lookup-preview muted';registryPreview.textContent='Saisissez un numéro : l’application cherchera automatiquement le bovin dans le fichier Reproduction de cette visite.';return;}if(!(visitReproSource.registry||[]).length){registryPreview.className='registry-lookup-preview warning';registryPreview.innerHTML='<strong>⚠ Aucun registre Reproduction lié à cette visite.</strong>';return;}const m=resolveRegistryAnimal(visitRegistryFarm,q);if(m?.ambiguous){registryPreview.className='registry-lookup-preview warning';registryPreview.innerHTML=`<strong>⚠ ${m.items.length} bovins correspondent à « ${escapeHtml(q)} ».</strong> Il faudra choisir le bon bovin à l’ajout.`;return;}if(!m?.animal){registryPreview.className='registry-lookup-preview warning';registryPreview.innerHTML=`<strong>⚠ « ${escapeHtml(q)} » non retrouvé dans le registre Reproduction.</strong> Vérifiez le numéro ou ajoutez-le quand même si nécessaire.`;return;}const a=m.animal,r=reproductionForCow(visitRegistryFarm,a.id);registryPreview.className='registry-lookup-preview ok';registryPreview.innerHTML=`<strong>✓ Bovin retrouvé :</strong> ${a.workNumber?`travail ${escapeHtml(a.workNumber)} · `:''}${escapeHtml(a.id)}${a.name?` · <b>${escapeHtml(a.name)}</b>`:''}${a.birthDate?` · ${escapeHtml(ageLabelAt(a.birthDate,visit.date))}`:''}${r?.lastCalvingDate?` · dernier vêlage ${formatDate(r.lastCalvingDate)}`:''}`;};
  tagInput?.addEventListener('input',renderRegistryPreview);renderRegistryPreview();
  quickForm?.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(quickForm));
    const enteredTag = data.tag.trim();
    if (!enteredTag) return showToast('Le numéro de boucle ou le numéro de travail est obligatoire.');
    const farm = db.farms.find(f=>f.id===visit.farmId);
    const reproSource=reproductionSourceForVisit(visit,farm),registryFarm={...farm,herdRegistry:reproSource.registry||[]};
    let match = resolveRegistryAnimal(registryFarm, enteredTag),registryAnimal=null;
    if (match?.ambiguous) {
      const choices = match.items.map((a,i)=>`${i+1}. travail ${a.workNumber||'—'} · ${a.id}${a.name?' · '+a.name:''} · ${a.birthDate ? formatDate(a.birthDate) : 'date inconnue'} · race ${a.breed||'—'}`).join('\n');
      const choice = Number(prompt(`Plusieurs bovins correspondent à « ${enteredTag} ». Choisissez le bon bovin :\n${choices}`, '1'));
      if (!choice || !match.items[choice-1]) return showToast('Ajout annulé : bovin non sélectionné.');
      registryAnimal=match.items[choice-1];
    } else if (match?.animal) registryAnimal=match.animal;
    if(!registryAnimal&&(reproSource.registry||[]).length&&!confirm(`Le numéro « ${enteredTag} » n’est pas retrouvé dans le registre Reproduction de cette visite.\n\nVoulez-vous quand même ajouter ce sujet ?`))return;
    const registryId=registryAnimal?.id||'';
    if (visit.subjects.some(subject => (registryId&&normalizeAnimalId(subject.registryAnimalId||subject.tag)===normalizeAnimalId(registryId)) || normalizeAnimalId(subject.tag)===normalizeAnimalId(enteredTag))) return showToast('Ce bovin est déjà présent dans la visite.');
    const repro = registryAnimal ? reproductionForCow(registryFarm, registryAnimal.id) : null;
    const subject = {
      id: uid('subject'), tag:enteredTag, registryAnimalId:registryId, registryWorkNumber:registryAnimal?.workNumber||'', registryLinked:!!registryAnimal, registryLinkStatus:registryAnimal?'ok':((reproSource.registry||[]).length?'not-found':'no-registry'), registryCoherenceIssues:registryAnimal?[]:[`« ${enteredTag} » n’a pas été retrouvé dans le registre Reproduction de cette visite.`], location: data.location.trim(), name: registryAnimal?.name || '', category: 'Non classé', stage: 'Non renseigné',
      gestationMonths: '', lactationDays: '', age: registryAnimal?.birthDate ? ageLabelAt(registryAnimal.birthDate, visit.date) : '', rank: repro?.calves?.length ?? '', lot: '', notes: '', measurements: {},
      birthDate: registryAnimal?.birthDate || '', breedCode: registryAnimal?.breed || '', sex: registryAnimal?.sex || '', motherNumber: registryAnimal?.motherId || '',
      lastCalvingDate: repro?.lastCalvingDate || '', lastCalfId: repro?.lastCalf?.id || '', firstCalvingAgeMonths: repro?.firstCalvingAgeMonths ?? '', lastIVV: repro?.lastIVV ?? '', meanIVV: repro?.meanIVV ?? '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    visit.subjects.push(subject);
    visit.updatedAt = new Date().toISOString();
    addJournal(visit, `Sujet ajouté : ${enteredTag}${registryAnimal?` → ${registryAnimal.id}`:''}.`);
    saveDatabase(db);
    openSubjectId = subject.id;
    showToast(registryAnimal?'Sujet ajouté et relié au registre Reproduction.':'Sujet ajouté sans correspondance dans le registre Reproduction.');
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
    form.querySelector('input[name="tag"]')?.addEventListener('change',()=>{subject.registryAnimalId='';subject.registryWorkNumber='';linkSubjectToReproduction(subject,visit,{fillBlanks:true});visit.updatedAt=new Date().toISOString();saveDatabase(db);renderAnimals();});
    form.querySelector('select[name="category"]')?.addEventListener('change',()=>{linkSubjectToReproduction(subject,visit,{fillBlanks:false});saveDatabase(db);renderAnimals();});
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

function normalizeDecimalText(value) {
  if (value === '' || value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g,'').replace(',', '.');
}
function numericValue(value) {
  const normalized = normalizeDecimalText(value);
  if (normalized === '') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
function normalizedMeasurementValue(value) {
  const normalized = normalizeDecimalText(value);
  if (normalized === '') return '';
  return numericValue(normalized) === null ? String(value ?? '').trim() : normalized;
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
  visit.reasoningReview = visit.reasoningReview && typeof visit.reasoningReview === 'object' ? visit.reasoningReview : {};
  (visit.subjects || []).forEach(subject => {
    subject.measurements = subject.measurements && typeof subject.measurements === 'object' ? subject.measurements : {};
    subject.measurements.analysis = subject.measurements.analysis && typeof subject.measurements.analysis === 'object' ? subject.measurements.analysis : {};
    subject.measurements.observations = subject.measurements.observations && typeof subject.measurements.observations === 'object' ? subject.measurements.observations : {};
    subject.measurements.comments = subject.measurements.comments && typeof subject.measurements.comments === 'object' ? subject.measurements.comments : {};
  });
}
let analysisSaveTimer=null;
function syncVisibleAnalysisInputs(visitId){
  const visit=db.visits.find(v=>v.id===visitId);if(!visit)return;
  document.querySelectorAll('.analysis-input[data-subject-id][data-param]').forEach(input=>{
    const subject=(visit.subjects||[]).find(s=>s.id===input.dataset.subjectId);if(!subject)return;
    subject.measurements=subject.measurements||{};subject.measurements.analysis=subject.measurements.analysis||{};
    const value=input.value ?? '';
    subject.measurements.analysis[input.dataset.param]=value;
    writeAnalysisPending(visit.id,subject.id,input.dataset.param,value);
  });
}
function scheduleAnalysisSave(delay=450,visitId=activeVisit()?.id){
  clearTimeout(analysisSaveTimer);
  analysisSaveTimer=setTimeout(()=>{analysisSaveTimer=null;try{if(visitId)syncVisibleAnalysisInputs(visitId);saveDatabase(db);if(visitId)clearAnalysisPendingVisit(visitId);}catch(e){console.error('Sauvegarde mesures différée impossible',e);}},delay);
}
const ANALYSIS_PENDING_KEY='audit-bovin-analysis-pending-v1';
function readAnalysisPending(){try{return JSON.parse(localStorage.getItem(ANALYSIS_PENDING_KEY)||'{}')||{}}catch(_){return {};}}
function writeAnalysisPending(visitId,subjectId,param,value){
  if(!visitId||!subjectId||!param)return;
  const pending=readAnalysisPending();
  pending[visitId]=pending[visitId]||{};
  pending[visitId][subjectId]=pending[visitId][subjectId]||{};
  pending[visitId][subjectId][param]=value;
  try{localStorage.setItem(ANALYSIS_PENDING_KEY,JSON.stringify(pending));}catch(_){}
}
function clearAnalysisPendingVisit(visitId){
  if(!visitId)return;
  const pending=readAnalysisPending();
  if(pending[visitId]){delete pending[visitId];try{localStorage.setItem(ANALYSIS_PENDING_KEY,JSON.stringify(pending));}catch(_){}}
}
function restoreAnalysisPending(visit){
  if(!visit?.id)return false;
  const entries=readAnalysisPending()[visit.id];if(!entries)return false;
  let changed=false;
  Object.entries(entries).forEach(([subjectId,values])=>{const s=(visit.subjects||[]).find(x=>x.id===subjectId);if(!s)return;s.measurements=s.measurements||{};s.measurements.analysis=s.measurements.analysis||{};Object.entries(values||{}).forEach(([param,value])=>{s.measurements.analysis[param]=value;changed=true;});});
  return changed;
}
function flushAnalysisSave(visitId){
  clearTimeout(analysisSaveTimer);analysisSaveTimer=null;if(visitId)syncVisibleAnalysisInputs(visitId);saveDatabase(db);if(visitId)clearAnalysisPendingVisit(visitId);
}
function subjectContextMini(subject){
  const items=[];
  if(subject.name)items.push(`<span><b>Nom</b> ${escapeHtml(subject.name)}</span>`);
  if(subject.age)items.push(`<span><b>Âge</b> ${escapeHtml(subject.age)}</span>`);
  if(subject.lastCalvingDate)items.push(`<span><b>DV</b> ${formatDate(subject.lastCalvingDate)}</span>`);
  if(subject.breedCode)items.push(`<span><b>Race</b> ${escapeHtml(subject.breedCode)}</span>`);
  if(subject.rank!==''&&subject.rank!==null&&subject.rank!==undefined)items.push(`<span><b>Rang</b> ${escapeHtml(subject.rank)}</span>`);
  return items.length?`<div class="subject-context-mini">${items.join('')}</div>`:'';
}
function analysisCell(subject, parameter) {
  const value = subject.measurements.analysis?.[parameter.key] ?? '';
  const rule = thresholdFor(subject, parameter.key);
  const result = subject.category && subject.category !== 'Non classé' ? classifyValue(value, rule) : (value === '' ? {status:'empty',label:'Non mesuré'} : {status:'unclassified',label:'Classer le sujet'});
  return `<td class="analysis-value-cell ${result.status}" title="${escapeHtml(result.label)} · ${escapeHtml(referenceText(rule))}"><input class="analysis-input decimal-input" data-subject-id="${subject.id}" data-param="${parameter.key}" type="text" inputmode="decimal" autocomplete="off" data-step="${parameter.step}" ${parameter.min!==undefined ? `data-min="${parameter.min}"` : ''} ${parameter.max!==undefined ? `data-max="${parameter.max}"` : ''} value="${escapeHtml(value)}"/><small>${escapeHtml(result.label)}</small></td>`;
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
function confidenceLabel(score,evidenceCount,contradictionsCount,sourceCount=1){
  if(evidenceCount>=4&&sourceCount>=2&&score>=7&&contradictionsCount<=1)return{label:'élevée',className:'high'};
  if(evidenceCount>=2&&score>=3)return{label:'modérée',className:'medium'};
  return{label:'faible',className:'low'};
}
function auditAttentionCount(visit, sectionId){
  const answers=visit.auditGlobal?.answers||{};
  const section=auditGlobalSections.find(x=>x.id===sectionId);
  if(!section)return 0;
  return section.questions.filter(q=>['À surveiller','À corriger'].includes(answers[q]?.status||answers[q]?.evaluation||'')).length;
}
function buildingRecords(visit){
  const audits=Object.values(visit.buildingAudits||{});
  return {
    drinkers:audits.flatMap(a=>a.drinkers||[]), electric:audits.flatMap(a=>a.electric||[]),
    litters:audits.flatMap(a=>a.litters||[]), ambience:audits.map(a=>a.ambience||{}),
    questionnaire:audits.flatMap(a=>Object.values(a.questionnaire||{}))
  };
}
function dataQualityForGroup(visit, group){
  const subjects=group.subjects,total=Math.max(1,subjects.length);
  const count=(keys,source='analysis')=>subjects.filter(s=>keys.some(k=>{const v=s.measurements?.[source]?.[k];return Array.isArray(v)?v.length>0:(v!==''&&v!==null&&v!==undefined);})).length;
  const build=buildingRecords(visit);
  const rows=[
    {label:'Urines',value:count(['urinePH','urineRedox','urineDensity','urineColor']),total},
    {label:'Sang',value:count(['glucose','boh','bloodPH','urea']),total},
    {label:'Bouses',value:count(['fecesPH','fecesRedox'])+count(['fecesAspect'],'observations'),total:total*2},
    {label:'Physique',value:count(['nec'])+count(['rumenFill','muscles','coat','limbs'],'observations'),total:total*2},
    {label:'Alimentation',value:(visit.feeding?.rations||[]).length?1:0,total:1},
    {label:'Bâtiment / eau',value:(build.drinkers.length+build.litters.length+build.electric.length)>0?1:0,total:1}
  ];
  return rows.map(r=>({...r,ratio:r.total?r.value/r.total:0,level:r.total&&r.value/r.total>=.7?'high':r.total&&r.value/r.total>=.3?'medium':'low'}));
}
function makePiste(rule,evidence,nuance,missing,score,sources){
  return {...rule,evidence,nuance,missing,causes:rule.causes||[],confidence:confidenceLabel(score,evidence.length,nuance.length,new Set(sources).size),sourceCount:new Set(sources).size};
}
function buildKnowledgePistes(visit,group){
  const subjects=group.subjects,pistes=[];
  const rule=id=>KNOWLEDGE_RULES.find(r=>r.id===id);
  const measured=(key)=>subjects.filter(s=>numericValue(s.measurements.analysis?.[key])!==null);
  const abnormal=(key,direction='any')=>subjects.filter(s=>{const r=resultFor(s,key);if(!r)return false;const st=r.classification.status;return direction==='low'?['red-low','yellow-low'].includes(st):direction==='high'?['red-high','yellow-high'].includes(st):statusSeverity(st)>=2;});
  const obs=(key,vals)=>subjects.filter(s=>hasObservation(s,key,vals));
  const build=buildingRecords(visit);
  {
    const e=[],n=[],m=[],src=[];let score=0;
    const boh=abnormal('boh','high'),gly=abnormal('glucose','low'),nec=abnormal('nec','low'),rumen=obs('rumenFill',['1','2']),muscle=obs('muscles',['--','-']);
    if(boh.length){e.push(`${boh.length}/${subjects.length} BOH au-dessus du repère`);score+=3;src.push('sang')}
    if(gly.length){e.push(`${gly.length}/${subjects.length} glycémie(s) basse(s)`);score+=2;src.push('sang')}
    if(nec.length){e.push(`${nec.length}/${subjects.length} NEC basse(s)`);score+=2;src.push('physique')}
    if(rumen.length){e.push(`${rumen.length}/${subjects.length} remplissage(s) ruminal(aux) faible(s)`);score+=1;src.push('observation')}
    if(muscle.length){e.push(`${muscle.length}/${subjects.length} musculature(s) faible(s)`);score+=1;src.push('observation')}
    if(measured('glucose').length&&abnormal('glucose').length===0)n.push('Les glycémies renseignées sont majoritairement dans la plage de référence.');
    if(!measured('glucose').length)m.push('Glycémies non renseignées');if(!measured('boh').length)m.push('BOH non renseignés');if(!measured('nec').length)m.push('NEC non renseignées');
    if(e.length)pistes.push(makePiste(rule('energy-balance'),e,n,m,score,src));
  }
  {
    const e=[],n=[],m=[],src=[];let score=0;const ph=abnormal('urinePH'),redox=abnormal('urineRedox');
    if(ph.length){e.push(`${ph.length}/${subjects.length} pH urinaire(s) hors repère`);score+=2;src.push('urines')}
    if(redox.length){e.push(`${redox.length}/${subjects.length} redox urinaire(s) hors repère`);score+=2;src.push('urines')}
    if(visit.feeding?.settings?.mineralization){e.push('Minéralisation renseignée dans le module Alimentation');score+=1;src.push('alimentation')}
    if(!measured('urinePH').length)m.push('pH urinaires non renseignés');if(!measured('urineRedox').length)m.push('Redox urinaires non renseignés');
    if(e.length)pistes.push(makePiste(rule('urine-balance'),e,n,m,score,src));
  }
  {
    const e=[],n=[],m=[],src=[];let score=0;const ph=abnormal('fecesPH'),redox=abnormal('fecesRedox'),aspect=obs('fecesAspect',['Liquides','Molles','Collantes','Grains','Fibres longues']),rumen=obs('rumenFill',['1','2']);
    if(ph.length){e.push(`${ph.length}/${subjects.length} pH de bouses hors repère`);score+=2;src.push('bouses')}
    if(redox.length){e.push(`${redox.length}/${subjects.length} redox de bouses hors repère`);score+=2;src.push('bouses')}
    if(aspect.length){e.push(`${aspect.length}/${subjects.length} aspect(s) de bouses à surveiller`);score+=2;src.push('observation')}
    if(rumen.length){e.push(`${rumen.length}/${subjects.length} remplissage(s) ruminal(aux) faible(s)`);score+=1;src.push('observation')}
    if((visit.analysisGeneral?.tamis||[]).length){e.push(`${visit.analysisGeneral.tamis.length} relevé(s) de tamis disponible(s)`);score+=1;src.push('tamis')}
    if(!measured('fecesPH').length)m.push('pH des bouses non renseigné');if(!measured('fecesRedox').length)m.push('Redox des bouses non renseigné');
    if(e.length)pistes.push(makePiste(rule('intestinal-imbalance'),e,n,m,score,src));
    const fiberEvidence=[];let fiberScore=0;const fibers=obs('fecesAspect',['Fibres longues','Grains']),lowRumen=obs('rumenFill',['1','2']);
    if(fibers.length){fiberEvidence.push(`${fibers.length}/${subjects.length} sujet(s) avec fibres longues ou grains visibles dans les bouses`);fiberScore+=2;}
    if(lowRumen.length){fiberEvidence.push(`${lowRumen.length}/${subjects.length} remplissage(s) ruminal(aux) faible(s)`);fiberScore+=1;}
    if((visit.analysisGeneral?.tamis||[]).length){fiberEvidence.push(`${visit.analysisGeneral.tamis.length} relevé(s) de tamis disponible(s)`);fiberScore+=1;}
    if(fiberEvidence.length>=2)pistes.push(makePiste(rule('fiber-structure'),fiberEvidence,[],[],fiberScore,['bouses','physique','tamis']));
  }
  {
    const e=[],n=[],m=[],src=[];let score=0;const dense=abnormal('urineDensity','high'),dark=abnormal('urineColor','high'),lowFlow=build.drinkers.filter(d=>numericValue(d.flow)!==null&&numericValue(d.flow)<10),poorAccess=build.drinkers.filter(d=>['Moyenne','Insuffisante'].includes(d.accessibility));
    if(dense.length){e.push(`${dense.length}/${subjects.length} densité(s) urinaire(s) élevée(s)`);score+=2;src.push('urines')}
    if(dark.length){e.push(`${dark.length}/${subjects.length} urine(s) foncée(s)`);score+=1;src.push('urines')}
    if(lowFlow.length){e.push(`${lowFlow.length} abreuvoir(s) avec débit inférieur à 10 L/min`);score+=2;src.push('bâtiment')}
    if(poorAccess.length){e.push(`${poorAccess.length} point(s) d’eau à accessibilité moyenne ou insuffisante`);score+=2;src.push('bâtiment')}
    if(!build.drinkers.length)m.push('Aucun abreuvoir renseigné dans le bâtiment');if(!measured('urineDensity').length)m.push('Densités urinaires non renseignées');
    if(e.length)pistes.push(makePiste(rule('water-access'),e,n,m,score,src));
  }
  {
    const e=[],n=[],m=[],src=[];let score=0;const ration=visit.feeding?.rations||[],settings=visit.feeding?.settings||{};
    if(ration.length){e.push(`${ration.length} ligne(s) de ration renseignée(s)`);score+=1;src.push('alimentation')}
    if(settings.transition){e.push('Une transition alimentaire est documentée');score+=1;src.push('alimentation')}
    if(settings.saltAccess==='Absent'){e.push('Accès au sel indiqué comme absent');score+=2;src.push('alimentation')}
    if((visit.analysisGeneral?.silos||[]).length){e.push(`${visit.analysisGeneral.silos.length} relevé(s) de silo disponible(s)`);score+=1;src.push('fourrages')}
    if(!ration.length)m.push('Ration non renseignée');if(!settings.mineralization)m.push('Minéralisation non précisée');
    if(e.length>=2||settings.saltAccess==='Absent')pistes.push(makePiste(rule('feeding-practices'),e,n,m,score,src));
    if(settings.saltAccess==='Absent'||settings.saltAccess==='Insuffisant'||/absent|insuffisant|rare/i.test(settings.mineralization||'')){
      const se=['Accès au sel indiqué comme absent ou insuffisant'];
      if(abnormal('urineDensity','high').length)se.push('Urines concentrées sur une partie du lot');
      if(build.drinkers.some(d=>numericValue(d.flow)!==null&&numericValue(d.flow)<10))se.push('Au moins un débit d’abreuvoir faible');
      pistes.push(makePiste(rule('salt-deficiency'),se,[],['Consommation réelle de sel non mesurée'],3+se.length,['alimentation','urines','bâtiment']));
    }
    const ureaHigh=abnormal('urea','high'),ureaLow=abnormal('urea','low');
    if(ureaHigh.length||ureaLow.length){
      const ne=[];if(ureaHigh.length)ne.push(`${ureaHigh.length}/${subjects.length} urémie(s) élevée(s)`);if(ureaLow.length)ne.push(`${ureaLow.length}/${subjects.length} urémie(s) basse(s)`);
      if(ration.length)ne.push('Ration renseignée pour permettre un croisement azote–énergie');
      pistes.push(makePiste(rule('nitrogen-balance'),ne,[],ration.length?[]:['Ration non renseignée'],2+ne.length,['sang','alimentation']));
    }
  }
  {
    const e=[],n=[],m=[],src=[];let score=0;const wet=build.litters.filter(l=>numericValue(l.humidity)!==null&&numericValue(l.humidity)>=60),hot=build.litters.filter(l=>numericValue(l.temperature)!==null&&numericValue(l.temperature)>=35),electric=build.electric.filter(x=>numericValue(x.value)!==null&&numericValue(x.value)>20),q=build.questionnaire.filter(x=>['À surveiller','À corriger'].includes(x.status));
    if(wet.length){e.push(`${wet.length} zone(s) de litière avec humidité élevée`);score+=2;src.push('litière')}
    if(hot.length){e.push(`${hot.length} zone(s) de litière avec température élevée`);score+=2;src.push('litière')}
    if(electric.length){e.push(`${electric.length} mesure(s) électrique(s) supérieure(s) à 20 mV`);score+=2;src.push('électricité')}
    if(q.length){e.push(`${q.length} point(s) du questionnaire bâtiment à surveiller ou corriger`);score+=2;src.push('questionnaire')}
    if(!(build.litters.length+build.electric.length+build.questionnaire.length))m.push('Volet bâtiment peu ou pas renseigné');
    if(e.length)pistes.push(makePiste(rule('building-conditions'),e,n,m,score,src));
  }
  {
    const e=[],n=[],m=[],src=[];let score=0;const count=auditAttentionCount(visit,'reproduction');
    if(count){e.push(`${count} réponse(s) reproduction à surveiller ou corriger`);score+=Math.min(4,count);src.push('audit')}
    if(visit.auditGlobal?.renewal?.cowsEmpty){e.push(`${visit.auditGlobal.renewal.cowsEmpty} vache(s) vide(s) renseignée(s)`);score+=1;src.push('renouvellement')}
    if(!visit.auditGlobal)m.push('Audit global non renseigné');
    if(e.length)pistes.push(makePiste(rule('reproduction-practices'),e,n,m,score,src));
  }
  return pistes;
}
function reasoningState(visit,pisteId){visit.reasoningReview=visit.reasoningReview||{};return visit.reasoningReview[pisteId]||{status:'active',note:''};}
function renderQualityTable(rows){return `<div class="quality-grid">${rows.map(r=>`<div class="quality-item ${r.level}"><div><strong>${escapeHtml(r.label)}</strong><small>${r.value}/${r.total}</small></div><div class="quality-bar"><i style="width:${Math.min(100,Math.round(r.ratio*100))}%"></i></div></div>`).join('')}</div>`;}
function renderKnowledgePiste(visit,h,group){const state=reasoningState(visit,`${group.category}:${h.id}`);const list=(title,items,cls)=>items?.length?`<div class="reason-block ${cls}"><strong>${title}</strong><ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`:'';return `<article class="reason-card ${state.status==='dismissed'?'dismissed':''}"><div class="reason-head"><div><span class="reason-domain">${escapeHtml(KNOWLEDGE_AXES.find(a=>a.id===h.axis)?.label||h.axis)}</span><h4>${escapeHtml(h.title)}</h4></div><span class="confidence ${h.confidence.className}">Confiance ${h.confidence.label} · ${h.sourceCount} source(s)</span></div><p>${escapeHtml(h.summary)}</p>${h.mechanism?`<div class="reason-explanation"><strong>Ce que cette piste peut traduire</strong><p>${escapeHtml(h.mechanism)}</p></div>`:''}${list('Faits et observations qui vont dans ce sens',h.evidence,'supports')}${list('Éléments qui invitent à la prudence',h.nuance,'nuances')}${list('Facteurs possibles à examiner',h.causes,'causes')}${list('Données manquantes',h.missing,'missing')}${list('Pistes de vérification',h.checks,'checks')}<div class="reason-review"><select data-reason-status="${escapeHtml(group.category+':'+h.id)}"><option value="active" ${state.status==='active'?'selected':''}>Piste retenue</option><option value="dismissed" ${state.status==='dismissed'?'selected':''}>Piste écartée</option><option value="watch" ${state.status==='watch'?'selected':''}>À surveiller</option></select><textarea data-reason-note="${escapeHtml(group.category+':'+h.id)}" placeholder="Justification / commentaire du technicien">${escapeHtml(state.note||'')}</textarea></div></article>`;}
function renderReasoningSection(visit){
  const groups=categoryAnalysis(visit);if(!groups.length)return'<div class="empty">Classez les sujets et saisissez des valeurs pour générer le raisonnement.</div>';
  return `<div class="notice"><strong>Moteur transparent :</strong> les faits mesurés, observations, données manquantes et pistes d’interprétation sont séparés. Le technicien peut retenir, surveiller ou écarter chaque piste.</div><div class="reason-groups">${groups.map(group=>{const quality=dataQualityForGroup(visit,group),pistes=buildKnowledgePistes(visit,group);return `<section class="card"><div class="section-title"><div><h3>${escapeHtml(group.category)}</h3><span class="muted">${group.subjects.length} sujet(s) · analyse par lot</span></div></div><h4>Fiabilité des données</h4>${renderQualityTable(quality)}<h4 style="margin-top:18px">Pistes d’interprétation</h4>${pistes.length?`<div class="reason-grid">${pistes.map(h=>renderKnowledgePiste(visit,h,group)).join('')}</div>`:'<div class="empty">Aucune piste suffisamment étayée avec les données actuelles.</div>'}</section>`}).join('')}</div>`;
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
  const minWidth = 180 + 170 + (params.length * 125) + 290;
  const rows = visit.subjects.map(subject => `<tr data-analysis-subject-row="${subject.id}" class="${focusedAnalysisSubjectId===subject.id?'focused-subject-row':''}">
    <td class="sticky-col subject-sticky-cell" style="min-width:180px"><strong class="subject-sticky-tag">${escapeHtml(subject.tag||'Sujet')}</strong>${subject.name?`<small class="subject-sticky-name">${escapeHtml(subject.name)}</small>`:''}${subject.location?`<small class="subject-sticky-location">${escapeHtml(subject.location)}</small>`:''}${subjectContextMini(subject)}</td>
    <td class="sticky-col-2" style="min-width:170px"><span class="badge ${subject.category&&subject.category!=='Non classé'?'complete':'unclassified'}">${escapeHtml(subject.category||'Non classé')}</span></td>
    ${params.map(p=>analysisCell(subject,p)).join('')}
    <td class="matrix-comment-cell" style="min-width:280px"><textarea class="matrix-comment" data-family-comment data-subject-id="${subject.id}" data-family="${activeAnalysisFamily}" placeholder="Commentaire libre…">${escapeHtml(subject.measurements.comments?.[activeAnalysisFamily]||'')}</textarea></td>
  </tr>`).join('');
  return `<section class="card"><div class="section-title"><div><h3>Mesures numériques par famille</h3><span class="muted">Les sujets sont repris automatiquement. La valeur est sauvegardée quand vous quittez la cellule.</span></div><span class="analysis-legend"><i class="green"></i> Référence <i class="yellow"></i> Vigilance <i class="red"></i> Écart <i class="grey"></i> En attente</span></div>
  <div class="family-tabs-row"><nav class="family-tabs">${families.map(f=>`<button class="family-tab ${activeAnalysisFamily===f?'active':''}" data-analysis-family="${f}">${f}</button>`).join('')}</nav><button class="btn secondary library-context-btn" data-open-library-theme="${escapeHtml(activeAnalysisFamily)}">📑 Planche ${escapeHtml(activeAnalysisFamily)}</button></div>
  ${params.length ? `<div class="table-wrap analysis-table-wrap"><table class="analysis-table matrix-table" style="min-width:${minWidth}px;width:${minWidth}px"><thead><tr><th class="sticky-col" style="min-width:180px">Sujet</th><th class="sticky-col-2" style="min-width:170px">Catégorie</th>${params.map(p=>`<th style="min-width:125px">${escapeHtml(p.short)}</th>`).join('')}<th class="comment-head" style="min-width:280px">Commentaire / observation</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="notice warning"><strong>Aucun paramètre configuré pour ${escapeHtml(activeAnalysisFamily)}.</strong></div>`}
  </section>`;
}

function obsControl(subject,field) { const data=subject.measurements.observations||{}; const current=data[field.key]; if(field.type==='number')return `<input data-observation data-numeric-observation class="decimal-input" data-subject-id="${subject.id}" data-key="${field.key}" type="text" inputmode="decimal" autocomplete="off" data-step="${field.step||'1'}" value="${escapeHtml(current??'')}"/>`; if(field.type==='text')return `<input data-observation data-subject-id="${subject.id}" data-key="${field.key}" value="${escapeHtml(current??'')}"/>`; if(field.type==='single')return `<select data-observation data-subject-id="${subject.id}" data-key="${field.key}"><option value="">—</option>${field.options.map(o=>`<option ${current===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select>`; const selected=Array.isArray(current)?current:[]; return `<div class="chip-options">${field.options.map(o=>`<label class="choice-chip ${selected.includes(o)?'selected':''}"><input type="checkbox" data-observation-multi data-subject-id="${subject.id}" data-key="${field.key}" value="${escapeHtml(o)}" ${selected.includes(o)?'checked':''}/>${escapeHtml(o)}</label>`).join('')}</div>`; }
function renderObservationsSection(visit) { return `<div class="subject-observation-list">${visit.subjects.map((s,i)=>`<details class="card observation-card" ${i===0?'open':''}><summary><div class="observation-subject-head"><strong>${escapeHtml(s.tag||`Sujet ${i+1}`)}${s.name?` · ${escapeHtml(s.name)}`:''}</strong><span>${escapeHtml(s.category||'Non classé')}${s.location?` · ${escapeHtml(s.location)}`:''}</span>${subjectContextMini(s)}</div><span class="observation-chevron">▾</span></summary><div class="observation-grid">${observationFields.map(f=>`<div class="field"><label>${escapeHtml(f.label)}</label>${obsControl(s,f)}</div>`).join('')}</div></details>`).join('')}</div>`; }
function generalField(record,configKey,field) { const [key,label,type,options]=field; const value=record[key]??''; if(type==='select')return `<div class="field"><label>${label}</label><select data-general-field data-kind="${configKey}" data-id="${record.id}" data-key="${key}"><option value="">—</option>${options.map(o=>`<option ${value===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div>`; if(type==='multi'){const selected=Array.isArray(value)?value:[];return `<div class="field field-wide"><label>${label}</label><div class="chip-options">${options.map(o=>`<label class="choice-chip ${selected.includes(o)?'selected':''}"><input type="checkbox" data-general-multi data-kind="${configKey}" data-id="${record.id}" data-key="${key}" value="${escapeHtml(o)}" ${selected.includes(o)?'checked':''}/>${escapeHtml(o)}</label>`).join('')}</div></div>`;} return `<div class="field ${type==='text'&&key==='comment'?'field-wide':''}"><label>${label}</label><input data-general-field ${type==='number'?'data-numeric-general class="decimal-input"':''} data-kind="${configKey}" data-id="${record.id}" data-key="${key}" type="${type==='number'?'text':type}" ${type==='number'?'inputmode="decimal" autocomplete="off"':''} value="${escapeHtml(value)}"/></div>`; }
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
    <div class="section-title"><div><h3>${cfg.icon} ${cfg.title}</h3><span class="muted">Relevés indépendants des animaux · sauvegarde automatique.</span></div><div class="actions"><button class="btn secondary" data-open-library-theme="${escapeHtml(cfg.title)}">📑 Planche</button><button class="btn primary" data-add-general="${activeGeneralKind}">Ajouter un relevé</button></div></div>
    <div class="general-records">${records.length?records.map((r,i)=>`<article class="general-record"><div class="section-title"><strong>${escapeHtml(cfg.title)} ${i+1}</strong><button class="btn small danger" data-remove-general="${activeGeneralKind}" data-id="${r.id}">Supprimer</button></div><div class="general-grid">${cfg.fields.map(f=>generalField(r,activeGeneralKind,f)).join('')}${activeGeneralKind==='tamis'?`<div class="calculated-box"><strong>Pourcentages automatiques</strong><span>Tamis 1 : ${numericValue(r.total)>0&&numericValue(r.t1)!==null?(100*numericValue(r.t1)/numericValue(r.total)).toFixed(1):'—'} %</span><span>Tamis 2 : ${numericValue(r.total)>0&&numericValue(r.t2)!==null?(100*numericValue(r.t2)/numericValue(r.total)).toFixed(1):'—'} %</span></div>`:''}</div></article>`).join(''):`<div class="empty">Aucun relevé. Cliquez sur « Ajouter un relevé ».</div>`}</div>
  </section>`;
}
function suggestedActions(visit) { const out=[]; categoryAnalysis(visit).forEach(g=>interpretationItems(g).filter(i=>i.level!=='good').forEach(i=>out.push({category:g.category,...i}))); return out; }
function ensureActionFields(action){
  action.priority=action.priority||'Moyenne';
  action.status=action.status||'À faire';
  action.responsible=action.responsible||'';
  action.dueDate=action.dueDate||'';
  action.progressNote=action.progressNote||'';
  action.createdAt=action.createdAt||new Date().toISOString();
  return action;
}
function actionPriorityClass(priority){return priority==='Haute'?'danger':priority==='Basse'?'archived':'in-progress';}
function renderSynthesisSection(visit) {
  const suggestions=suggestedActions(visit);visit.analysisActions=Array.isArray(visit.analysisActions)?visit.analysisActions:[];visit.analysisActions.forEach(ensureActionFields);
  return `<div id="analysis-summary">${renderAnalysisSummary(visit)}</div><section class="card" style="margin-top:16px"><div class="section-title"><div><h3>Plan d’action vivant</h3><span class="muted">Priorité, responsable, échéance et état d’avancement.</span></div><button class="btn" id="add-custom-action">Ajouter une action libre</button></div><div class="action-suggestions">${suggestions.length?suggestions.map((a,i)=>`<div class="action-line"><span class="badge ${a.level==='danger'?'in-progress':'archived'}">${a.level==='danger'?'Priorité haute':'À surveiller'}</span><div><strong>${escapeHtml(a.category)} — ${escapeHtml(a.theme)}</strong><br><span>${escapeHtml(a.action)}</span></div><button class="btn small" data-accept-action="${i}">Ajouter</button></div>`).join(''):'<div class="empty">Aucune action automatique proposée à ce stade.</div>'}</div><div class="action-list enriched">${visit.analysisActions.length?visit.analysisActions.map(a=>`<article class="action-edit enriched"><div class="action-edit-head"><select data-action-field="priority" data-action-id="${a.id}" class="priority-${escapeHtml(a.priority.toLowerCase())}"><option ${a.priority==='Haute'?'selected':''}>Haute</option><option ${a.priority==='Moyenne'?'selected':''}>Moyenne</option><option ${a.priority==='Basse'?'selected':''}>Basse</option></select><select data-action-field="status" data-action-id="${a.id}"><option ${a.status==='À faire'?'selected':''}>À faire</option><option ${a.status==='En cours'?'selected':''}>En cours</option><option ${a.status==='Réalisé'?'selected':''}>Réalisé</option><option ${a.status==='Abandonné'?'selected':''}>Abandonné</option></select><button class="btn small danger" data-remove-action="${a.id}">Supprimer</button></div><div class="field"><label>Action</label><input data-action-field="text" data-action-id="${a.id}" value="${escapeHtml(a.text||'')}"/></div><div class="row"><div class="field"><label>Responsable</label><input data-action-field="responsible" data-action-id="${a.id}" placeholder="Éleveur, technicien…" value="${escapeHtml(a.responsible||'')}"/></div><div class="field"><label>Échéance</label><input type="date" data-action-field="dueDate" data-action-id="${a.id}" value="${escapeHtml(a.dueDate||'')}"/></div></div><div class="field"><label>Point d’avancement</label><textarea data-action-field="progressNote" data-action-id="${a.id}" placeholder="Ce qui a été fait, difficultés, prochaine étape…">${escapeHtml(a.progressNote||'')}</textarea></div></article>`).join(''):''}</div></section>`;
}

function allPilotageActions(){
  const rows=[];db.visits.forEach(v=>(v.analysisActions||[]).forEach(a=>{ensureActionFields(a);rows.push({action:a,visit:v,farm:db.farms.find(f=>f.id===v.farmId)});}));return rows;
}
function renderPilotageActions(){
  const today=new Date().toISOString().slice(0,10),all=allPilotageActions();
  const open=all.filter(x=>!['Réalisé','Abandonné'].includes(x.action.status));
  const overdue=open.filter(x=>x.action.dueDate&&x.action.dueDate<today);
  const dueSoon=open.filter(x=>x.action.dueDate&&x.action.dueDate>=today&&x.action.dueDate<=new Date(Date.now()+30*86400000).toISOString().slice(0,10));
  const completed=all.filter(x=>x.action.status==='Réalisé');
  const farmsWithOpen=new Set(open.map(x=>x.visit.farmId)).size;
  const rows=all.slice().sort((a,b)=>{const pa={Haute:0,Moyenne:1,Basse:2}[a.action.priority]??3,pb={Haute:0,Moyenne:1,Basse:2}[b.action.priority]??3;return pa-pb||(a.action.dueDate||'9999').localeCompare(b.action.dueDate||'9999');});
  app.innerHTML=`<div class="section-title"><div><h2>🎯 Pilotage des actions</h2><div class="muted">Vue commune de toutes les actions décidées lors des visites.</div></div><span class="badge autosave">v14.6.15</span></div>
  <section class="grid cols-4 professional-kpis"><article class="card"><span>Actions ouvertes</span><strong>${open.length}</strong></article><article class="card"><span>En retard</span><strong>${overdue.length}</strong></article><article class="card"><span>Échéance sous 30 j</span><strong>${dueSoon.length}</strong></article><article class="card"><span>Exploitations concernées</span><strong>${farmsWithOpen}</strong></article></section>
  <section class="card pilotage-toolbar"><div class="field"><label>Filtrer</label><select id="pilotage-filter"><option value="all">Toutes les actions</option><option value="open">Ouvertes</option><option value="overdue">En retard</option><option value="high">Priorité haute</option><option value="done">Réalisées</option></select></div><div class="field"><label>Recherche</label><input id="pilotage-search" placeholder="Exploitation, action, responsable…"></div><div class="actions"><button class="btn secondary" id="pilotage-csv">Exporter CSV</button><button class="btn" id="pilotage-print">Imprimer / PDF</button></div></section>
  <section class="card"><div id="pilotage-list" class="pilotage-list"></div></section>`;
  const renderList=()=>{const f=document.getElementById('pilotage-filter').value,q=normalizeSearchText(document.getElementById('pilotage-search').value);let list=rows.filter(x=>{if(f==='open'&&['Réalisé','Abandonné'].includes(x.action.status))return false;if(f==='overdue'&&!(x.action.dueDate&&x.action.dueDate<today&&!['Réalisé','Abandonné'].includes(x.action.status)))return false;if(f==='high'&&x.action.priority!=='Haute')return false;if(f==='done'&&x.action.status!=='Réalisé')return false;const hay=normalizeSearchText([x.farm?.name,x.farm?.farmNumber,x.action.text,x.action.responsible,x.action.progressNote].join(' '));return !q||hay.includes(q);});document.getElementById('pilotage-list').innerHTML=list.length?list.map(x=>{const late=x.action.dueDate&&x.action.dueDate<today&&!['Réalisé','Abandonné'].includes(x.action.status);return `<article class="pilotage-action ${late?'overdue':''}"><div class="pilotage-action-main"><select data-pilotage-field="priority" data-action-id="${x.action.id}" data-visit-id="${x.visit.id}"><option ${x.action.priority==='Haute'?'selected':''}>Haute</option><option ${x.action.priority==='Moyenne'?'selected':''}>Moyenne</option><option ${x.action.priority==='Basse'?'selected':''}>Basse</option></select><div><strong>${escapeHtml(x.action.text||'Action sans intitulé')}</strong><small>${escapeHtml(x.farm?.name||'Exploitation')} · visite du ${formatDate(x.visit.date)}</small></div></div><div class="pilotage-action-meta"><input data-pilotage-field="responsible" data-action-id="${x.action.id}" data-visit-id="${x.visit.id}" value="${escapeHtml(x.action.responsible||'')}" placeholder="Responsable"><input type="date" data-pilotage-field="dueDate" data-action-id="${x.action.id}" data-visit-id="${x.visit.id}" value="${escapeHtml(x.action.dueDate||'')}"><select data-pilotage-status="${x.action.id}" data-visit-id="${x.visit.id}"><option ${x.action.status==='À faire'?'selected':''}>À faire</option><option ${x.action.status==='En cours'?'selected':''}>En cours</option><option ${x.action.status==='Réalisé'?'selected':''}>Réalisé</option><option ${x.action.status==='Bloquée'?'selected':''}>Bloquée</option><option ${x.action.status==='Abandonné'?'selected':''}>Abandonné</option></select><button class="btn small" data-action-news="${x.action.id}" data-farm-id="${x.farm?.id||''}">Ajouter une nouvelle</button><button class="btn small" data-open-pilotage-visit="${x.visit.id}">Ouvrir la visite</button></div>${x.action.progressNote?`<p>${escapeHtml(x.action.progressNote)}</p>`:''}</article>`;}).join(''):'<div class="empty">Aucune action correspondant au filtre.</div>';document.querySelectorAll('[data-pilotage-status]').forEach(el=>el.onchange=()=>{const v=db.visits.find(v=>v.id===el.dataset.visitId),a=v?.analysisActions?.find(a=>a.id===el.dataset.pilotageStatus);if(a){a.status=el.value;a.updatedAt=new Date().toISOString();saveDatabase(db);renderPilotageActions();}});document.querySelectorAll('[data-pilotage-field]').forEach(el=>el.onchange=()=>{const v=db.visits.find(v=>v.id===el.dataset.visitId),a=v?.analysisActions?.find(a=>a.id===el.dataset.actionId);if(a){a[el.dataset.pilotageField]=el.value;a.updatedAt=new Date().toISOString();saveDatabase(db);renderPilotageActions();}});document.querySelectorAll('[data-action-news]').forEach(b=>b.onclick=()=>{localStorage.setItem('audit-bovin-journal-farm',b.dataset.farmId);localStorage.setItem('audit-bovin-journal-action',b.dataset.actionNews);setView('journal');});document.querySelectorAll('[data-open-pilotage-visit]').forEach(b=>b.onclick=()=>{setActiveVisit(b.dataset.openPilotageVisit);setView('analysis');});};
  document.getElementById('pilotage-filter').onchange=renderList;document.getElementById('pilotage-search').oninput=renderList;document.getElementById('pilotage-csv').onclick=()=>{const lines=[['Exploitation','EDE','Date visite','Action','Priorité','Statut','Responsable','Échéance','Avancement'],...rows.map(x=>[x.farm?.name||'',x.farm?.farmNumber||'',x.visit.date||'',x.action.text||'',x.action.priority||'',x.action.status||'',x.action.responsible||'',x.action.dueDate||'',x.action.progressNote||''])];const csv=lines.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`pilotage-actions-${today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};document.getElementById('pilotage-print').onclick=()=>window.print();renderList();
}

function renderAnalysis() {
  const visits=db.visits.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(!activeVisitId&&visits.length)setActiveVisit(visits[0].id);
  const visit=activeVisit();
  if(visit){enrichVisitSubjectsFromReproduction(visit);ensureAnalysisVisit(visit);restoreAnalysisPending(visit);}
  const tabs=[['numeric','Matrices par famille'],['observations','Observations'],['general','Tamis · Silos · Sol · Plantes'],['reasoning','Raisonnement'],['summary','Statistiques & actions'],['conclusion','Conclusion de visite']];
  app.innerHTML=`<div class="section-title"><div><h2>Mesures</h2><div class="muted">Saisie des mesures, observations et relevés généraux. La synthèse et le raisonnement restent accessibles dans les onglets internes.</div></div><span class="badge autosave">Sauvegarde automatique</span></div>
  ${activeVisitBanner(visit)}
  ${!visit?'<div class="empty" style="margin-top:16px">Choisissez une visite dans l’onglet Visites.</div>':!visit.subjects?.length?'<div class="empty" style="margin-top:16px">Ajoutez des sujets dans l’onglet Animaux.</div>':`<section class="card analysis-utilities"><div class="actions"><button class="btn" id="analysis-demo">Jeu d’essai</button><button class="btn secondary" id="analysis-clear">Effacer l’analyse</button></div></section><nav class="analysis-tabs">${tabs.map(([k,l])=>`<button class="analysis-tab ${activeAnalysisSection===k?'active':''}" data-analysis-section="${k}">${l}</button>`).join('')}</nav><section class="analysis-content">${activeAnalysisSection==='numeric'?renderNumericSection(visit):activeAnalysisSection==='observations'?renderObservationsSection(visit):activeAnalysisSection==='general'?renderGeneralSection(visit):activeAnalysisSection==='reasoning'?renderReasoningSection(visit):activeAnalysisSection==='summary'?renderSynthesisSection(visit):renderConclusionSection(visit)}</section>`}`;
  enhanceNumericEntry(app);
  app.querySelectorAll('[data-analysis-section]').forEach(b=>b.onclick=()=>{activeAnalysisSection=b.dataset.analysisSection;localStorage.setItem('audit-bovin-active-analysis-section',activeAnalysisSection);renderAnalysis();});
  app.querySelectorAll('[data-analysis-family]').forEach(b=>b.onclick=()=>{activeAnalysisFamily=b.dataset.analysisFamily;localStorage.setItem('audit-bovin-active-analysis-family',activeAnalysisFamily);renderAnalysis();});
  app.querySelectorAll('[data-general-kind]').forEach(b=>b.onclick=()=>{activeGeneralKind=b.dataset.generalKind;localStorage.setItem('audit-bovin-active-general-kind',activeGeneralKind);renderAnalysis();});
  app.querySelectorAll('[data-open-library-theme]').forEach(b=>b.onclick=()=>openLibraryTheme(b.dataset.openLibraryTheme));
  bindAnalysisEvents(visit);
  if(activeAnalysisSection==='conclusion')bindConclusionEvents(visit);
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
  enhanceNumericEntry(app);
  app.querySelectorAll('.analysis-input').forEach(input=>{let blurTimer=null;const persist=(normalize=false,immediate=false)=>{const subject=visit.subjects.find(x=>x.id===input.dataset.subjectId);if(!subject)return;let value=input.value??'';if(normalize){value=normalizedMeasurementValue(value);input.value=value;}subject.measurements.analysis[input.dataset.param]=value;subject.updatedAt=new Date().toISOString();visit.updatedAt=new Date().toISOString();writeAnalysisPending(visit.id,subject.id,input.dataset.param,value);if(immediate)scheduleAnalysisSave(180,visit.id);else scheduleAnalysisSave(700,visit.id);const result=subject.category&&subject.category!=='Non classé'?classifyValue(value,thresholdFor(subject,input.dataset.param)):(value===''?{status:'empty',label:'Non mesuré'}:{status:'unclassified',label:'Classer le sujet'});const cell=input.closest('.analysis-value-cell');if(cell){cell.className=`analysis-value-cell ${result.status}`;const small=cell.querySelector('small');if(small)small.textContent=result.label;}};const capture=()=>persist(false,false);input.addEventListener('input',capture);input.addEventListener('keyup',capture);input.addEventListener('compositionend',capture);input.addEventListener('beforeinput',()=>setTimeout(capture,0));input.addEventListener('change',()=>{clearTimeout(blurTimer);setTimeout(()=>persist(true,true),80)});input.addEventListener('blur',()=>{clearTimeout(blurTimer);blurTimer=setTimeout(()=>persist(true,true),180)});});
  app.querySelectorAll('[data-family-comment]').forEach(el=>{const save=(immediate=false)=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);if(!s)return;s.measurements.comments=s.measurements.comments||{};s.measurements.comments[el.dataset.family]=el.value;s.updatedAt=new Date().toISOString();visit.updatedAt=new Date().toISOString();if(immediate)scheduleAnalysisSave(80,visit.id);else scheduleAnalysisSave(650,visit.id);};el.oninput=()=>save(false);el.onchange=()=>save(true);el.onblur=()=>save(true);});
  app.querySelectorAll('[data-observation]').forEach(el=>{const save=(normalize=false,immediate=false)=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);if(!s)return;let value=el.value;if(normalize&&el.hasAttribute('data-numeric-observation')){value=normalizedMeasurementValue(value);el.value=value;}s.measurements.observations[el.dataset.key]=value;visit.updatedAt=new Date().toISOString();if(immediate)scheduleAnalysisSave(80,visit.id);else scheduleAnalysisSave(650,visit.id);};el.oninput=()=>save(false,false);el.onchange=()=>save(true,true);el.onblur=()=>save(true,true);});
  app.querySelectorAll('[data-observation-multi]').forEach(el=>el.onchange=()=>{const s=visit.subjects.find(x=>x.id===el.dataset.subjectId);const key=el.dataset.key;s.measurements.observations[key]=[...app.querySelectorAll(`[data-observation-multi][data-subject-id="${s.id}"][data-key="${key}"]:checked`)].map(x=>x.value);visit.updatedAt=new Date().toISOString();saveDatabase(db);el.closest('.choice-chip')?.classList.toggle('selected',el.checked);});
  app.querySelectorAll('[data-add-general]').forEach(b=>b.onclick=()=>{visit.analysisGeneral[b.dataset.addGeneral].push({id:uid(b.dataset.addGeneral),date:new Date().toISOString().slice(0,10)});saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-remove-general]').forEach(b=>b.onclick=()=>{visit.analysisGeneral[b.dataset.removeGeneral]=visit.analysisGeneral[b.dataset.removeGeneral].filter(r=>r.id!==b.dataset.id);saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-general-field]').forEach(el=>{const save=(normalize=false)=>{const r=visit.analysisGeneral[el.dataset.kind].find(x=>x.id===el.dataset.id);if(!r)return;let value=el.value;if(normalize&&el.hasAttribute('data-numeric-general')){value=normalizedMeasurementValue(value);el.value=value;}r[el.dataset.key]=value;visit.updatedAt=new Date().toISOString();if(normalize)flushAnalysisSave(visit.id);else scheduleAnalysisSave(900);if(el.dataset.kind==='tamis'&&['total','t1','t2'].includes(el.dataset.key)){const box=el.closest('.general-record')?.querySelector('.calculated-box');if(box){const total=numericValue(r.total),t1=numericValue(r.t1),t2=numericValue(r.t2),spans=box.querySelectorAll('span');if(spans[0])spans[0].textContent=`Tamis 1 : ${total>0&&t1!==null?(100*t1/total).toFixed(1):'—'} %`;if(spans[1])spans[1].textContent=`Tamis 2 : ${total>0&&t2!==null?(100*t2/total).toFixed(1):'—'} %`;}}};el.oninput=()=>save(false);el.onchange=()=>save(true);el.onblur=()=>save(true);});
  app.querySelectorAll('[data-general-multi]').forEach(el=>el.onchange=()=>{const r=visit.analysisGeneral[el.dataset.kind].find(x=>x.id===el.dataset.id);r[el.dataset.key]=[...app.querySelectorAll(`[data-general-multi][data-kind="${el.dataset.kind}"][data-id="${el.dataset.id}"][data-key="${el.dataset.key}"]:checked`)].map(x=>x.value);saveDatabase(db);el.closest('.choice-chip')?.classList.toggle('selected',el.checked);});
  app.querySelectorAll('[data-analysis-conclusion]').forEach(el=>el.oninput=()=>{visit.analysisConclusions[el.dataset.analysisConclusion]=el.value;saveDatabase(db);});
  const suggestions=suggestedActions(visit); app.querySelectorAll('[data-accept-action]').forEach(b=>b.onclick=()=>{const s=suggestions[Number(b.dataset.acceptAction)];visit.analysisActions.push({id:uid('action'),text:`${s.category} — ${s.action}`,responsible:'',status:'À faire',priority:s.level==='danger'?'Haute':'Moyenne',dueDate:'',progressNote:'',createdAt:new Date().toISOString()});saveDatabase(db);renderAnalysis();});
  document.getElementById('add-custom-action')?.addEventListener('click',()=>{visit.analysisActions.push({id:uid('action'),text:'',responsible:'',status:'À faire',priority:'Moyenne',dueDate:'',progressNote:'',createdAt:new Date().toISOString()});saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-action-field]').forEach(el=>{const save=()=>{const a=visit.analysisActions.find(x=>x.id===el.dataset.actionId);a[el.dataset.actionField]=el.value;saveDatabase(db);};el.oninput=save;el.onchange=save;});
  app.querySelectorAll('[data-remove-action]').forEach(b=>b.onclick=()=>{visit.analysisActions=visit.analysisActions.filter(a=>a.id!==b.dataset.removeAction);saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-reason-status]').forEach(el=>el.onchange=()=>{visit.reasoningReview=visit.reasoningReview||{};const cur=visit.reasoningReview[el.dataset.reasonStatus]||{};visit.reasoningReview[el.dataset.reasonStatus]={...cur,status:el.value};saveDatabase(db);renderAnalysis();});
  app.querySelectorAll('[data-reason-note]').forEach(el=>el.oninput=()=>{visit.reasoningReview=visit.reasoningReview||{};const cur=visit.reasoningReview[el.dataset.reasonNote]||{status:'active'};visit.reasoningReview[el.dataset.reasonNote]={...cur,note:el.value};saveDatabase(db);});
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


const forageTypes = ['Ensilage de maïs','Ensilage d’herbe','Enrubannage','Foin de prairie','Foin de luzerne','Herbe pâturée','Paille','Maïs grain humide','Autre'];
function nValue(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null;}
function nutritionFlag(level,title,text){return `<div class="analysis-message ${level}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;}
function interpretForage(a){
  const out=[]; const ms=nValue(a.ms), mat=nValue(a.mat), ndf=nValue(a.ndf), starch=nValue(a.starch), sugar=nValue(a.sugar), ph=nValue(a.ph), dmo=nValue(a.dmo), ca=nValue(a.ca), p=nValue(a.p), k=nValue(a.k), na=nValue(a.na), cl=nValue(a.cl), sulfur=nValue(a.s);
  if(ms!==null){if(a.type.includes('Ensilage')&&ms<28)out.push(['warning','Matière sèche basse','Fourrage humide : surveiller les jus, l’ingestion et la qualité de fermentation.']);else if(a.type.includes('Ensilage')&&ms>40)out.push(['warning','Matière sèche élevée','Tassement et conservation potentiellement plus délicats ; vérifier échauffement et tri.']);else out.push(['good','Matière sèche renseignée',`MS : ${ms} %. À rapprocher des quantités réellement ingérées.`]);}
  if(mat!==null){if(mat<8)out.push(['danger','Protéines faibles',`MAT ${mat} % MS : apport protéique faible, à confronter aux besoins du lot.`]);else if(mat>18)out.push(['warning','Protéines élevées',`MAT ${mat} % MS : vérifier l’équilibre avec l’énergie fermentescible et l’urée.`]);else out.push(['good','Niveau protéique intermédiaire',`MAT ${mat} % MS.`]);}
  if(ndf!==null){if(ndf<30)out.push(['warning','NDF faible','Peu de fibre totale : vérifier la fibre physiquement efficace et le risque acidogène.']);else if(ndf>60)out.push(['warning','NDF élevée','Fourrage très fibreux : ingestion et digestibilité peuvent être limitées.']);else out.push(['good','Fibres présentes',`NDF ${ndf} % MS, à interpréter avec la digestibilité et la longueur des particules.`]);}
  if(starch!==null&&starch>35)out.push(['warning','Amidon élevé',`Amidon ${starch} % MS : sécuriser la transition, la fibre et la répartition des apports.`]);
  if(sugar!==null&&sugar>15)out.push(['warning','Sucres élevés',`Sucres ${sugar} % MS : tenir compte de l’ensemble de la ration fermentescible.`]);
  if(dmo!==null){if(dmo<60)out.push(['warning','Digestibilité faible',`Digestibilité ${dmo} % : la valeur énergétique et l’ingestion peuvent être pénalisées.`]);else if(dmo>=70)out.push(['good','Bonne digestibilité',`Digestibilité ${dmo} % : fourrage potentiellement bien valorisable si la conservation et l’ingestion sont bonnes.`]);}
  if(ph!==null&&a.type.includes('Ensilage')){if(ph>4.5)out.push(['warning','pH de conservation à vérifier',`pH ${ph} : à interpréter avec la matière sèche, le type d’ensilage, l’odeur et l’échauffement.`]);else out.push(['good','pH de fermentation bas',`pH ${ph}, à confirmer avec l’aspect, l’odeur et la stabilité à l’air.`]);}
  if(ca!==null&&p!==null&&p>0){const ratio=ca/p; if(ratio<1.2||ratio>3)out.push(['warning','Rapport calcium/phosphore à surveiller',`Ca/P ≈ ${ratio.toFixed(1)} sur ce fourrage seul. L’équilibre doit être calculé sur la ration complète.`]);}
  if([na,k,cl,sulfur].every(x=>x!==null)){const baca=na*43.5+k*25.6-cl*28.2-sulfur*62.5; out.push([baca>300?'warning':'good','BACA estimée du fourrage',`${Math.round(baca)} mEq/kg MS (formule indicative). ${baca>300?'Valeur élevée, vigilance particulière pour les taries.':'À intégrer au calcul de la ration complète.'}`]);}
  if(!out.length)out.push(['warning','Analyse incomplète','Renseignez au minimum la matière sèche, la MAT et les fibres pour obtenir une première lecture.']);
  return out;
}
function interpretRation(r){
  const out=[]; const dm=nValue(r.dm), ufl=nValue(r.ufl), needUfl=nValue(r.needUfl), pdi=nValue(r.pdi), needPdi=nValue(r.needPdi), mat=nValue(r.mat), ndf=nValue(r.ndf), starch=nValue(r.starch), sugar=nValue(r.sugar), ca=nValue(r.ca), phosphorus=nValue(r.p), baca=nValue(r.baca);
  if(ufl!==null&&needUfl!==null&&needUfl>0){const cov=ufl/needUfl*100;out.push([cov<90?'danger':cov>115?'warning':'good','Couverture énergétique',`${Math.round(cov)} % du besoin saisi. ${cov<90?'Déficit théorique : vérifier ingestion réelle, pertes, tri et stade physiologique.':cov>115?'Apport supérieur au besoin saisi : vérifier le risque d’engraissement ou de ration trop dense.':'Couverture théorique proche de l’objectif.'}`]);}
  if(pdi!==null&&needPdi!==null&&needPdi>0){const cov=pdi/needPdi*100;out.push([cov<90?'danger':cov>120?'warning':'good','Couverture protéique',`${Math.round(cov)} % du besoin PDI saisi. ${cov<90?'Apport potentiellement insuffisant.':cov>120?'Apport élevé : vérifier la valorisation de l’azote et l’urée.':'Couverture théorique proche de l’objectif.'}`]);}
  if(ufl!==null&&pdi!==null&&ufl>0)out.push(['good','Rapport protéines / énergie',`${Math.round(pdi/ufl)} g PDI/UFL. À comparer aux objectifs du lot et au système de rationnement utilisé.`]);
  if(mat!==null){if(mat<11)out.push(['warning','MAT de ration basse',`MAT ${mat} % MS : peut limiter les performances selon le lot.`]);else if(mat>18)out.push(['warning','MAT de ration élevée',`MAT ${mat} % MS : contrôler l’équilibre énergétique et l’urée.`]);}
  if(ndf!==null){if(ndf<28)out.push(['danger','Fibres totales faibles',`NDF ${ndf} % MS : risque de rumination insuffisante selon la fibre efficace.`]);else if(ndf>48)out.push(['warning','Fibres élevées',`NDF ${ndf} % MS : l’encombrement peut limiter l’ingestion.`]);else out.push(['good','NDF dans une zone intermédiaire',`NDF ${ndf} % MS ; vérifier aussi la longueur des particules et le tri.`]);}
  if(starch!==null&&starch>28)out.push(['warning','Amidon élevé',`Amidon ${starch} % MS : vigilance acidose, transition et répartition des repas.`]);
  if(sugar!==null&&sugar>10)out.push(['warning','Sucres élevés',`Sucres ${sugar} % MS : additionner sucres, amidon et autres glucides rapidement fermentescibles.`]);
  if(ca!==null&&phosphorus!==null&&phosphorus>0){const ratio=ca/phosphorus;out.push([ratio<1.3||ratio>2.5?'warning':'good','Rapport Ca/P',`Rapport ≈ ${ratio.toFixed(1)}. À adapter à la catégorie et au stade physiologique.`]);}
  if(baca!==null){if(r.category==='Préparation vêlage')out.push([baca>100?'warning':'good','BACA des taries',`${baca} mEq/kg MS : ${baca>100?'valeur positive, vérifier l’objectif du protocole et le pH urinaire.':'valeur abaissée ; contrôler ingestion, minéraux et pH urinaire.'}`]);else out.push(['good','BACA renseignée',`${baca} mEq/kg MS. L’objectif dépend du lot et du stade physiologique.`]);}
  if(dm!==null&&dm<=0)out.push(['danger','Ingestion invalide','La matière sèche ingérée doit être supérieure à zéro.']);
  if(!out.length)out.push(['warning','Ration incomplète','Renseignez les apports et besoins énergie/protéines ou, au minimum, MAT, NDF et amidon.']);
  return out;
}
function renderNutritionAnalysis(){
  const visit=activeVisit();
  if(!visit){app.innerHTML=`<div class="section-title"><div><h2>Analyse nutritionnelle</h2><div class="muted">Interprétation simple des analyses de fourrage et de ration.</div></div><span class="badge autosave">v14.6.15</span></div><section class="empty">Choisissez une visite dans l’onglet Visites.</section>`;return;}
  visit.feeding=visit.feeding&&typeof visit.feeding==='object'?visit.feeding:{rations:[],settings:{},history:[]};
  visit.feeding.nutrition=visit.feeding.nutrition&&typeof visit.feeding.nutrition==='object'?visit.feeding.nutrition:{};
  const nutrition=visit.feeding.nutrition;
  nutrition.forageAnalyses=Array.isArray(nutrition.forageAnalyses)?nutrition.forageAnalyses:[];
  nutrition.ration=nutrition.ration&&typeof nutrition.ration==='object'?nutrition.ration:{};
  const fields=(a)=>`<div class="grid cols-4 nutrition-fields">
    <div class="field"><label>Nom / lot</label><input data-forage-field="name" data-id="${a.id}" value="${escapeHtml(a.name||'')}" placeholder="Ex. silo maïs 2026"></div>
    <div class="field"><label>Type</label><select data-forage-field="type" data-id="${a.id}">${forageTypes.map(v=>`<option ${a.type===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>MS (%)</label><input inputmode="decimal" data-forage-field="ms" data-id="${a.id}" value="${escapeHtml(a.ms||'')}"></div>
    <div class="field"><label>MAT (% MS)</label><input inputmode="decimal" data-forage-field="mat" data-id="${a.id}" value="${escapeHtml(a.mat||'')}"></div>
    <div class="field"><label>NDF (% MS)</label><input inputmode="decimal" data-forage-field="ndf" data-id="${a.id}" value="${escapeHtml(a.ndf||'')}"></div>
    <div class="field"><label>ADF (% MS)</label><input inputmode="decimal" data-forage-field="adf" data-id="${a.id}" value="${escapeHtml(a.adf||'')}"></div>
    <div class="field"><label>Amidon (% MS)</label><input inputmode="decimal" data-forage-field="starch" data-id="${a.id}" value="${escapeHtml(a.starch||'')}"></div>
    <div class="field"><label>Sucres (% MS)</label><input inputmode="decimal" data-forage-field="sugar" data-id="${a.id}" value="${escapeHtml(a.sugar||'')}"></div>
    <div class="field"><label>Digestibilité (%)</label><input inputmode="decimal" data-forage-field="dmo" data-id="${a.id}" value="${escapeHtml(a.dmo||'')}"></div>
    <div class="field"><label>pH</label><input inputmode="decimal" data-forage-field="ph" data-id="${a.id}" value="${escapeHtml(a.ph||'')}"></div>
    <div class="field"><label>Ca (% MS)</label><input inputmode="decimal" data-forage-field="ca" data-id="${a.id}" value="${escapeHtml(a.ca||'')}"></div>
    <div class="field"><label>P (% MS)</label><input inputmode="decimal" data-forage-field="p" data-id="${a.id}" value="${escapeHtml(a.p||'')}"></div>
    <div class="field"><label>Na (% MS)</label><input inputmode="decimal" data-forage-field="na" data-id="${a.id}" value="${escapeHtml(a.na||'')}"></div>
    <div class="field"><label>K (% MS)</label><input inputmode="decimal" data-forage-field="k" data-id="${a.id}" value="${escapeHtml(a.k||'')}"></div>
    <div class="field"><label>Cl (% MS)</label><input inputmode="decimal" data-forage-field="cl" data-id="${a.id}" value="${escapeHtml(a.cl||'')}"></div>
    <div class="field"><label>S (% MS)</label><input inputmode="decimal" data-forage-field="s" data-id="${a.id}" value="${escapeHtml(a.s||'')}"></div>
  </div>`;
  const r=nutrition.ration;
  app.innerHTML=`<div class="section-title"><div><h2>Analyse nutritionnelle</h2><div class="muted">Lecture pratique des analyses de laboratoire et de la ration complète.</div></div><div class="actions"><button class="btn secondary" id="nutrition-library">📚 Fiches énergie, protéines et BACA</button><span class="badge autosave">v14.6.15</span></div></div>${activeVisitBanner(visit)}
  <div class="notice warning"><strong>Outil d’aide à l’interprétation.</strong> Les repères sont généraux et ne remplacent pas un calcul de ration validé selon l’espèce, la production, le stade physiologique et les unités du laboratoire.</div>
  <section class="card"><div class="section-title"><div><h3>🌾 Analyses de fourrage</h3><div class="muted">Saisissez les valeurs en pourcentage de matière sèche, sauf indication contraire.</div></div><button class="btn primary" id="add-forage-analysis">Ajouter une analyse</button></div>
  ${nutrition.forageAnalyses.length?nutrition.forageAnalyses.map(a=>`<article class="nutrition-analysis-card"><div class="section-title"><h4>${escapeHtml(a.name||a.type||'Analyse de fourrage')}</h4><button class="btn small danger" data-delete-forage="${a.id}">Supprimer</button></div>${fields(a)}<div class="analysis-interpretations">${interpretForage(a).map(x=>nutritionFlag(...x)).join('')}</div><div class="field"><label>Commentaire du technicien</label><textarea data-forage-field="comment" data-id="${a.id}">${escapeHtml(a.comment||'')}</textarea></div></article>`).join(''):'<div class="empty">Aucune analyse renseignée.</div>'}</section>
  <section class="card" style="margin-top:16px"><h3>🥣 Analyse de la ration complète</h3><div class="grid cols-4 nutrition-fields">
    <div class="field"><label>Catégorie</label><select data-ration-field="category">${feedingCategories.map(v=>`<option ${r.category===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Ingestion MS (kg/j)</label><input inputmode="decimal" data-ration-field="dm" value="${escapeHtml(r.dm||'')}"></div>
    <div class="field"><label>Apport énergie (UFL/j)</label><input inputmode="decimal" data-ration-field="ufl" value="${escapeHtml(r.ufl||'')}"></div>
    <div class="field"><label>Besoin énergie (UFL/j)</label><input inputmode="decimal" data-ration-field="needUfl" value="${escapeHtml(r.needUfl||'')}"></div>
    <div class="field"><label>Apport PDI (g/j)</label><input inputmode="decimal" data-ration-field="pdi" value="${escapeHtml(r.pdi||'')}"></div>
    <div class="field"><label>Besoin PDI (g/j)</label><input inputmode="decimal" data-ration-field="needPdi" value="${escapeHtml(r.needPdi||'')}"></div>
    <div class="field"><label>MAT ration (% MS)</label><input inputmode="decimal" data-ration-field="mat" value="${escapeHtml(r.mat||'')}"></div>
    <div class="field"><label>NDF ration (% MS)</label><input inputmode="decimal" data-ration-field="ndf" value="${escapeHtml(r.ndf||'')}"></div>
    <div class="field"><label>Amidon (% MS)</label><input inputmode="decimal" data-ration-field="starch" value="${escapeHtml(r.starch||'')}"></div>
    <div class="field"><label>Sucres (% MS)</label><input inputmode="decimal" data-ration-field="sugar" value="${escapeHtml(r.sugar||'')}"></div>
    <div class="field"><label>Ca (% MS)</label><input inputmode="decimal" data-ration-field="ca" value="${escapeHtml(r.ca||'')}"></div>
    <div class="field"><label>P (% MS)</label><input inputmode="decimal" data-ration-field="p" value="${escapeHtml(r.p||'')}"></div>
    <div class="field"><label>BACA (mEq/kg MS)</label><input inputmode="decimal" data-ration-field="baca" value="${escapeHtml(r.baca||'')}"></div>
  </div><div class="analysis-interpretations">${interpretRation(r).map(x=>nutritionFlag(...x)).join('')}</div><div class="field"><label>Conclusion du technicien</label><textarea data-ration-field="comment">${escapeHtml(r.comment||'')}</textarea></div></section>`;
  document.getElementById('nutrition-library').onclick=()=>openPlanche('Nutrition');
  document.getElementById('add-forage-analysis').onclick=()=>{nutrition.forageAnalyses.push({id:uid('forage'),name:'',type:'Ensilage de maïs'});saveDatabase(db);renderNutritionAnalysis();};
  app.querySelectorAll('[data-forage-field]').forEach(el=>{const save=()=>{const a=nutrition.forageAnalyses.find(x=>x.id===el.dataset.id);if(!a)return;a[el.dataset.forageField]=el.value;visit.updatedAt=new Date().toISOString();saveDatabase(db);};el.onchange=()=>{save();renderNutritionAnalysis()};el.onblur=save;});
  app.querySelectorAll('[data-delete-forage]').forEach(b=>b.onclick=()=>{if(confirm('Supprimer cette analyse de fourrage ?')){nutrition.forageAnalyses=nutrition.forageAnalyses.filter(x=>x.id!==b.dataset.deleteForage);saveDatabase(db);renderNutritionAnalysis();}});
  app.querySelectorAll('[data-ration-field]').forEach(el=>{const save=()=>{nutrition.ration[el.dataset.rationField]=el.value;visit.updatedAt=new Date().toISOString();saveDatabase(db);};el.onchange=()=>{save();renderNutritionAnalysis()};el.onblur=save;});
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
    <div class="section-title"><div><h2>Alimentation</h2><div class="muted">Rations par catégorie, distribution, minéralisation et transitions.</div></div><div class="actions"><button class="btn primary" id="open-nutrition-analysis">🧪 Analyser fourrage / ration</button><button class="btn secondary" data-open-library-theme="Alimentation">📑 Fiches nutrition</button><span class="badge autosave">Sauvegarde automatique</span></div></div>
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

  app.querySelectorAll('[data-open-library-theme]').forEach(b=>b.onclick=()=>openLibraryTheme(b.dataset.openLibraryTheme));
  document.getElementById('open-nutrition-analysis')?.addEventListener('click',()=>setView('nutrition'));
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
  app.innerHTML=`<div class="section-title"><div><h2>Bâtiment</h2><div class="muted">Données permanentes, mesures de visite et plan interactif.</div></div><div class="actions"><button class="btn secondary" data-open-library-theme="Plan bâtiment">📑 Planche</button><span class="badge autosave">Sauvegarde automatique</span></div></div>
  ${activeVisitBanner(visit)}
  ${!visit?'<section class="empty">Choisissez une visite dans l’onglet Visites.</section>':`
    <section class="card building-selector"><div class="field no-margin"><label>Bâtiment étudié</label><select id="building-select"><option value="">Sélectionner…</option>${farm.buildings.map(b=>`<option value="${b.id}" ${b.id===activeBuildingId?'selected':''}>${escapeHtml(b.name||'Bâtiment')}</option>`).join('')}</select></div><div class="actions"><button class="btn primary" id="add-building">Ajouter un bâtiment</button>${building?'<button class="btn danger" id="delete-building">Supprimer</button>':''}</div></section>
    ${!building?'<section class="empty">Ajoutez un bâtiment pour commencer.</section>':`${buildingTabsHtml()}<section id="building-panel"></section>`}
  `}`;
  app.querySelectorAll('[data-open-library-theme]').forEach(b=>b.onclick=()=>openLibraryTheme(b.dataset.openLibraryTheme));
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

function updateBuildingOutline(building){
  const lengthM=Number(building.length), widthM=Number(building.width);
  if(!(lengthM>0&&widthM>0)) return false;
  building.plan=building.plan||{shapes:[]};
  building.plan.shapes=Array.isArray(building.plan.shapes)?building.plan.shapes:[];
  const maxW=860,maxH=520,padX=70,padY=65;
  const scale=Math.min(maxW/lengthM,maxH/widthM);
  const w=Math.max(80,lengthM*scale),h=Math.max(60,widthM*scale);
  let outline=building.plan.shapes.find(x=>x.type==='building_outline');
  if(!outline){
    outline={id:'building-outline',type:'building_outline'};
    building.plan.shapes.unshift(outline);
  }
  Object.assign(outline,{x:(1000-w)/2,y:(650-h)/2,w,h,label:`${building.name||'Bâtiment'} — ${lengthM} × ${widthM} m`,lengthM,widthM,color:'#b53670',width:5,locked:true});
  building.plan.scalePxPerM=scale;
  building.updatedAt=new Date().toISOString();
  saveDatabase(db);
  return true;
}

function renderBuildingStructure(panel,{visit,building}){
  panel.innerHTML=`<section class="card"><div class="section-title"><div><h3>Fiche permanente du bâtiment</h3><div class="muted">Renseignez longueur et largeur : le contour du bâtiment est créé automatiquement sur le plan.</div></div><button class="btn primary" id="create-building-outline">Créer / actualiser le contour</button></div><div class="grid cols-3">
    <div class="field"><label>Nom</label><input data-bfield="name" value="${escapeHtml(building.name||'')}"></div>
    <div class="field"><label>Type</label><select data-bfield="type">${buildingTypes.map(v=>`<option ${building.type===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Année / ancienneté</label><input data-bfield="year" value="${escapeHtml(building.year||'')}"></div>
    <div class="field"><label>Orientation</label><select data-bfield="orientation">${buildingOrientations.map(v=>`<option ${building.orientation===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Ventilation</label><select data-bfield="ventilation">${ventilationTypes.map(v=>`<option ${building.ventilation===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Catégories accueillies</label><input data-bfield="categories" value="${escapeHtml(building.categories||'')}" placeholder="Veaux, génisses, vaches…"></div>
    <div class="field"><label>Longueur du bâtiment (m)</label><input type="number" step="0.1" min="0" data-bfield="length" value="${escapeHtml(building.length||'')}"></div>
    <div class="field"><label>Largeur du bâtiment (m)</label><input type="number" step="0.1" min="0" data-bfield="width" value="${escapeHtml(building.width||'')}"></div>
    <div class="field"><label>Hauteur / volume</label><input data-bfield="height" value="${escapeHtml(building.height||'')}"></div>
    <div class="field"><label>Sol</label><input data-bfield="floor" value="${escapeHtml(building.floor||'')}"></div>
    <div class="field"><label>Toiture</label><input data-bfield="roof" value="${escapeHtml(building.roof||'')}"></div>
    <div class="field"><label>Bardage / ouvertures</label><input data-bfield="cladding" value="${escapeHtml(building.cladding||'')}"></div>
    <div class="field field-wide"><label>Observations permanentes</label><textarea data-bfield="notes">${escapeHtml(building.notes||'')}</textarea></div>
  </div><div class="info-box small-text">Le rectangle est mis à l’échelle pour tenir dans le plan. Vous pourrez ensuite ajouter les cloisons, zones et équipements à l’intérieur.</div></section>`;
  panel.querySelectorAll('[data-bfield]').forEach(el=>{
    const save=()=>{saveBuildingPermanent(building,el.dataset.bfield,el.value);if(['length','width','name'].includes(el.dataset.bfield))updateBuildingOutline(building)};
    el.addEventListener('input',save);el.addEventListener('change',save);el.addEventListener('blur',save);
  });
  document.getElementById('create-building-outline')?.addEventListener('click',()=>{
    if(updateBuildingOutline(building)){toast('Contour du bâtiment créé / actualisé.');activeBuildingTab='plan';localStorage.setItem('audit-bovin-building-tab','plan');renderBuilding();}
    else toast('Renseignez une longueur et une largeur supérieures à 0.');
  });
}

function planToolButton(tool,icon,label,title=''){return `<button class="plan-tool" data-tool="${tool}" title="${escapeHtml(title||label)}"><span class="plan-tool-icon">${icon}</span><span>${label}</span></button>`}
function planToolGroup(title,buttons){return `<details class="plan-toolbox-group"><summary><span>${title}</span><span class="plan-group-chevron">⌄</span></summary><div class="plan-toolbox-grid">${buttons.join('')}</div></details>`}
function planCanvasHtml(){return `<section class="card plan-card"><div class="section-title plan-title"><div><h3>Plan interactif</h3><div class="muted">Les familles d’outils sont repliées par défaut. Ouvrez uniquement celle dont vous avez besoin.</div></div><span class="badge autosave">Auto</span></div>
  <div class="plan-designer-grid">
    <aside class="plan-toolbox" aria-label="Outils du plan">
      ${planToolGroup('Dessin',[`<button class="plan-tool active" data-tool="select"><span class="plan-tool-icon">↖</span><span>Sélection</span></button>`,planToolButton('free','✏️','Libre'),planToolButton('line','📏','Trait droit'),planToolButton('rect','▭','Rectangle'),planToolButton('text','T','Texte')])}
      ${planToolGroup('Structure',[planToolButton('porte','🚪','Porte'),planToolButton('fenetre','▣','Fenêtre'),planToolButton('barriere','━','Barrière'),planToolButton('passage_homme','🚶','Passage homme')])}
      ${planToolGroup('Alimentation',[planToolButton('cornadis','▥','Cornadis'),planToolButton('barre_garrot','▔','Barre garrot'),planToolButton('attaches','⛓️','Attaches'),planToolButton('mangeoire','🥣','Mangeoire')])}
      ${planToolGroup('Eau / ambiance',[planToolButton('water','💧','Abreuvoir'),planToolButton('ventilateur','🌀','Ventilateur'),planToolButton('electric','⚡','Point électrique')])}
      ${planToolGroup('Zones',[planToolButton('zone_litter','🛏️','Aire paillée'),planToolButton('zone_feed','🌾','Couloir alim.'),planToolButton('zone_exercise','🐄','Aire exercice'),planToolButton('logette','▱','Logette'),planToolButton('litter','🟫','Litière mesurée'),planToolButton('zone_custom','🏷️','Zone libre')])}
      <details class="plan-toolbox-group plan-toolbox-settings"><summary><span>Réglages</span><span class="plan-group-chevron">⌄</span></summary><div class="plan-toolbox-settings-body"><label class="plan-width compact">Épaisseur <select id="plan-width"><option value="2">Fine</option><option value="4" selected>Moyenne</option><option value="7">Épaisse</option></select></label><div class="plan-history-actions"><button class="btn small" id="plan-fit" title="Afficher tout le bâtiment">⛶ Ajuster</button><button class="btn small" id="plan-undo" title="Annuler">↩ Annuler</button><button class="btn small" id="plan-redo" title="Rétablir">↪ Rétablir</button><button class="btn small danger" id="plan-delete-selected" title="Supprimer la sélection">🗑 Sélection</button><button class="btn small danger" id="plan-clear" title="Effacer tout sauf le contour">Effacer le contenu</button></div></div></details>
    </aside>
    <div class="plan-canvas-column"><div class="plan-canvas-wrap"><canvas id="building-canvas" width="1000" height="650"></canvas></div><div class="muted small-text">Le contour vert correspond aux dimensions renseignées dans la fiche Structure. Les objets linéaires et les zones se dessinent par glisser-déposer.</div></div>
    <aside id="plan-inspector" class="plan-inspector collapsed"><h4>Objet sélectionné</h4><p class="muted">Cliquez sur un objet pour afficher ses propriétés.</p></aside>
  </div></section>`;}

function renderBuildingPlan(panel,{building,audit,visit}){
  if(!building.plan?.shapes?.some(s=>s.type==='building_outline')) updateBuildingOutline(building);
  panel.innerHTML=planCanvasHtml(); initPlanCanvas(building,audit,visit);
}

function initPlanCanvas(building,audit,visit){
  const canvas=document.getElementById('building-canvas'); if(!canvas)return; const ctx=canvas.getContext('2d');
  building.plan=building.plan||{shapes:[]}; building.plan.shapes=Array.isArray(building.plan.shapes)?building.plan.shapes:[];
  let tool='select',drawing=false,start=null,temp=null,redo=[],selectedId='',dragOffset=null; const history=building.plan.shapes;
  const point=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}};
  const objectMeta={
    cornadis:{label:'Cornadis',icon:'C',color:'#475569',kind:'linear'},barriere:{label:'Barrière',icon:'B',color:'#6b7280',kind:'linear'},barre_garrot:{label:'Barre au garrot',icon:'BG',color:'#9a3412',kind:'linear'},attaches:{label:'Attaches individuelles',icon:'AI',color:'#7e22ce',kind:'linear'},passage_homme:{label:'Passage d’homme',icon:'PH',color:'#7c3aed',kind:'linear'},
    mangeoire:{label:'Mangeoire',icon:'M',color:'#ca8a04',kind:'point'},logette:{label:'Logette',icon:'L',color:'#8b5cf6',kind:'point'},ventilateur:{label:'Ventilateur',icon:'V',color:'#0f766e',kind:'point'},porte:{label:'Porte',icon:'P',color:'#92400e',kind:'point'},fenetre:{label:'Fenêtre',icon:'F',color:'#38bdf8',kind:'point'},
    zone_litter:{label:'Aire paillée',color:'#d6a85f',kind:'zone'},zone_feed:{label:'Couloir alimentation',color:'#d4b44c',kind:'zone'},zone_exercise:{label:'Aire d’exercice',color:'#6ba88a',kind:'zone'},zone_custom:{label:'Zone personnalisée',color:'#94a3b8',kind:'zone'},
    water:{label:'Abreuvoir',icon:'A',color:'#0ea5e9',kind:'point'},electric:{label:'Électricité',icon:'E',color:'#eab308',kind:'point'},litter:{label:'Litière',icon:'Li',color:'#a16207',kind:'zone'}
  };
  const color=t=>({free:'#1f2937',line:'#1f2937',rect:'#b53670',text:'#1f2937',...Object.fromEntries(Object.entries(objectMeta).map(([k,v])=>[k,v.color]))}[t]||'#1f2937');
  const meta=s=>objectMeta[s.type]; const isLinear=s=>meta(s)?.kind==='linear'; const isZone=s=>meta(s)?.kind==='zone'; const isPoint=s=>meta(s)?.kind==='point'; const isObject=s=>!!meta(s);
  const drawShape=s=>{ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=s.color||color(s.type);ctx.fillStyle=s.color||color(s.type);ctx.lineWidth=s.width||4;
    if(s.type==='building_outline'){ctx.strokeStyle=s.color||'#b53670';ctx.lineWidth=s.width||5;ctx.setLineDash([12,6]);ctx.strokeRect(s.x,s.y,s.w,s.h);ctx.setLineDash([]);ctx.fillStyle='#b53670';ctx.font='bold 15px sans-serif';ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(s.label||'Contour du bâtiment',s.x,s.y-8);ctx.restore();return;}
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
  const hit=p=>[...history].reverse().find(s=>{if(s.type==='building_outline')return false;if(isPoint(s))return Math.abs(p.x-s.x)<(s.w||54)/2+8&&Math.abs(p.y-s.y)<(s.h||38)/2+8;if(isZone(s)||s.type==='rect')return p.x>=s.x-7&&p.x<=s.x+s.w+7&&p.y>=s.y-7&&p.y<=s.y+s.h+7;if(isLinear(s)||s.type==='line')return distanceToSegment(p,{x:s.x1,y:s.y1},{x:s.x2,y:s.y2})<12;if(s.type==='text')return Math.abs(p.x-s.x)<80&&Math.abs(p.y-s.y)<24;return false});
  const linkedRow=s=>s.linkKind==='drinker'?audit.drinkers.find(r=>r.id===s.linkId):s.linkKind==='electric'?audit.electric.find(r=>r.id===s.linkId):s.linkKind==='litter'?audit.litters.find(r=>r.id===s.linkId):null;
  const setLinearLength=(s,newLength)=>{const dx=s.x2-s.x1,dy=s.y2-s.y1,old=Math.hypot(dx,dy)||1;const ux=dx/old,uy=dy/old;s.x2=s.x1+ux*newLength;s.y2=s.y1+uy*newLength};
  const renderInspector=()=>{const box=document.getElementById('plan-inspector');if(!box)return;const s=history.find(x=>x.id===selectedId);if(!s){box.classList.add('collapsed');box.innerHTML='<h4>Objet sélectionné</h4><p class="muted">Cliquez sur un objet pour afficher ses propriétés.</p>';return}box.classList.remove('collapsed');const row=linkedRow(s);const m=meta(s);const isLin=isLinear(s),isZn=isZone(s),isPt=isPoint(s);const length=isLin?Math.round(Math.hypot(s.x2-s.x1,s.y2-s.y1)):0;box.innerHTML=`<h4>${escapeHtml(s.label||m?.label||s.type)}</h4><div class="field"><label>Libellé / nom de zone</label><input id="shape-label" value="${escapeHtml(s.label||'')}"></div><div class="muted small-text">Type : ${escapeHtml(m?.label||s.type)}</div>${s.type==='cornadis'?`<div class="field"><label>Nombre de places</label><input id="shape-places" type="number" min="0" step="1" value="${escapeHtml(s.places??'')}"></div><div class="field"><label>Type de cornadis</label><select id="shape-cornadis-type">${['Autobloquant','Simple','Tubulaire','Autre'].map(v=>`<option ${s.cornadisType===v?'selected':''}>${v}</option>`).join('')}</select></div>`:''}${s.type==='barre_garrot'?`<div class="field"><label>Hauteur (cm)</label><input id="shape-garrot-height" type="number" min="0" step="1" value="${escapeHtml(s.heightCm??'')}"></div>`:''}${s.type==='attaches'?`<div class="field"><label>Nombre d’attaches</label><input id="shape-places" type="number" min="0" step="1" value="${escapeHtml(s.places??'')}"></div><div class="field"><label>Type d’attache</label><select id="shape-attach-type">${['Chaîne','Collier','Licol','Câble','Autre'].map(v=>`<option ${s.attachType===v?'selected':''}>${v}</option>`).join('')}</select></div>`:''}${isLin?`<div class="field"><label>Longueur sur le plan</label><input id="shape-length" type="number" min="20" max="950" value="${length}"></div><div class="actions compact"><button class="btn small" id="linear-horizontal">Horizontal</button><button class="btn small" id="linear-vertical">Vertical</button></div>`:''}${isZn||isPt?`<div class="grid cols-2"><div class="field"><label>Largeur</label><input id="shape-w" type="number" min="20" max="950" value="${Math.round(s.w||(isPt?54:150))}"></div><div class="field"><label>Hauteur</label><input id="shape-h" type="number" min="20" max="550" value="${Math.round(s.h||(isPt?38:100))}"></div></div>`:''}${isZn?`<div class="field"><label>Correspondance / usage de la zone</label><select id="shape-zone-type">${['Aire paillée','Couloir d’alimentation','Aire d’exercice','Logettes','Case veaux','Zone de stockage','Aire d’attente','Parc d’isolement','Autre'].map(v=>`<option ${s.zoneType===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Commentaire de zone</label><textarea id="shape-zone-comment">${escapeHtml(s.comment||'')}</textarea></div>`:''}${row?`<div class="plan-linked-summary">${s.linkKind==='drinker'?`Type : ${escapeHtml(row.type||'')}<br>Matériau : ${escapeHtml(row.material||'')}<br>Débit : ${escapeHtml(row.flow||'—')} L/min`:s.linkKind==='electric'?`Valeur : ${escapeHtml(row.value||'—')} ${escapeHtml(row.unit||'')}`:`Zone : ${escapeHtml(row.zone||'')}<br>pH : ${escapeHtml(row.ph||'—')}`}</div><button class="btn primary" id="open-linked-row">Ouvrir la fiche liée</button>`:'<p class="muted">Objet permanent du plan.</p>'}<button class="btn danger" id="delete-shape-inspector">Supprimer cet objet</button>`;
    document.getElementById('shape-label')?.addEventListener('input',e=>{s.label=e.target.value;if(row){if(s.linkKind==='drinker')row.name=e.target.value;if(s.linkKind==='electric')row.equipment=e.target.value;if(s.linkKind==='litter')row.zone=e.target.value;saveBuildingAudit(visit)}persist()});
    document.getElementById('shape-length')?.addEventListener('change',e=>{setLinearLength(s,Math.max(20,Number(e.target.value)||20));persist()});
    document.getElementById('linear-horizontal')?.addEventListener('click',()=>{const len=Math.hypot(s.x2-s.x1,s.y2-s.y1)||120;s.x2=s.x1+len;s.y2=s.y1;persist()});
    document.getElementById('linear-vertical')?.addEventListener('click',()=>{const len=Math.hypot(s.x2-s.x1,s.y2-s.y1)||120;s.x2=s.x1;s.y2=s.y1+len;persist()});
    document.getElementById('shape-w')?.addEventListener('change',e=>{s.w=Math.max(20,Number(e.target.value)||20);persist()});document.getElementById('shape-h')?.addEventListener('change',e=>{s.h=Math.max(20,Number(e.target.value)||20);persist()});
    document.getElementById('shape-zone-type')?.addEventListener('change',e=>{s.zoneType=e.target.value;persist()});document.getElementById('shape-zone-comment')?.addEventListener('input',e=>{s.comment=e.target.value;persist()});
    document.getElementById('shape-places')?.addEventListener('change',e=>{s.places=Math.max(0,Number(e.target.value)||0);persist()});document.getElementById('shape-cornadis-type')?.addEventListener('change',e=>{s.cornadisType=e.target.value;persist()});document.getElementById('shape-garrot-height')?.addEventListener('change',e=>{s.heightCm=Math.max(0,Number(e.target.value)||0);persist()});document.getElementById('shape-attach-type')?.addEventListener('change',e=>{s.attachType=e.target.value;persist()});
    document.getElementById('delete-shape-inspector').onclick=()=>{const i=history.findIndex(x=>x.id===s.id);if(i>=0)history.splice(i,1);selectedId='';persist()};
    document.getElementById('open-linked-row')?.addEventListener('click',()=>{activeBuildingTab=s.linkKind==='drinker'?'water':s.linkKind==='electric'?'electric':'litter';localStorage.setItem('audit-bovin-building-tab',activeBuildingTab);renderBuilding();setTimeout(()=>document.querySelector(`[data-id="${s.linkId}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),100)});};
  const createLinkedObject=(type,p)=>{let row,label;if(type==='water'){const n=audit.drinkers.length+1;row={id:uid('drinker'),name:`Abreuvoir ${n}`,type:'Bac collectif',material:'Inox',origin:'Réseau'};audit.drinkers.push(row);label=row.name;saveBuildingAudit(visit);commit({type,x:p.x,y:p.y,label,linkKind:'drinker',linkId:row.id,w:60,h:40});}else if(type==='electric'){const n=audit.electric.length+1;row={id:uid('electric'),equipment:`Point électrique ${n}`,unit:'mV',current:'AC'};audit.electric.push(row);label=row.equipment;saveBuildingAudit(visit);commit({type,x:p.x,y:p.y,label,linkKind:'electric',linkId:row.id,w:58,h:40});}};
  const createLinkedLitterZone=(rect)=>{const n=audit.litters.length+1;const row={id:uid('litter'),zone:`Zone litière ${n}`,type:'Paille',quantityUnit:'kg/j'};audit.litters.push(row);saveBuildingAudit(visit);commit({...rect,type:'litter',label:row.zone,zoneType:'Aire paillée',linkKind:'litter',linkId:row.id});};
  document.querySelectorAll('.plan-tool').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.plan-tool').forEach(b=>b.classList.remove('active'));btn.classList.add('active');tool=btn.dataset.tool;document.querySelectorAll('.plan-more[open]').forEach(d=>d.removeAttribute('open'));if(window.matchMedia('(max-width:760px)').matches){const group=btn.closest('details.plan-toolbox-group');if(group)group.removeAttribute('open');document.querySelector('.plan-canvas-wrap')?.scrollIntoView({behavior:'smooth',block:'start'});}});
  document.getElementById('plan-fit')?.addEventListener('click',()=>{document.querySelector('.plan-canvas-wrap')?.scrollIntoView({behavior:'smooth',block:'center'});renderCanvas();});
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);const p=point(e);const width=Number(document.getElementById('plan-width')?.value||4);if(tool==='select'){const s=hit(p);selectedId=s?.id||'';if(s){if(isPoint(s))dragOffset={kind:'point',x:p.x-s.x,y:p.y-s.y};else if(isZone(s)||s.type==='rect')dragOffset={kind:'zone',x:p.x-s.x,y:p.y-s.y};else if(isLinear(s)||s.type==='line')dragOffset={kind:'linear',x:p.x-s.x1,y:p.y-s.y1,x2:s.x2-s.x1,y2:s.y2-s.y1};drawing=true}else dragOffset=null;renderInspector();renderCanvas();return}if(['water','electric'].includes(tool)){createLinkedObject(tool,p);return}if(isPoint({type:tool})){commit({type:tool,x:p.x,y:p.y,label:meta({type:tool}).label,w:54,h:38});return}if(tool==='text'){const text=prompt('Texte à ajouter :');if(text)commit({type:'text',x:p.x,y:p.y,text});return}drawing=true;start=p;if(tool==='free')temp={type:'free',points:[p],width,color:color(tool)};});
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);if(tool==='select'){const s=history.find(x=>x.id===selectedId);if(s&&dragOffset){if(dragOffset.kind==='point'){s.x=p.x-dragOffset.x;s.y=p.y-dragOffset.y}else if(dragOffset.kind==='zone'){s.x=p.x-dragOffset.x;s.y=p.y-dragOffset.y}else if(dragOffset.kind==='linear'){s.x1=p.x-dragOffset.x;s.y1=p.y-dragOffset.y;s.x2=s.x1+dragOffset.x2;s.y2=s.y1+dragOffset.y2}renderCanvas()}return}const width=Number(document.getElementById('plan-width')?.value||4);if(tool==='free')temp.points.push(p);if(tool==='line'||['cornadis','barriere','barre_garrot','attaches','passage_homme'].includes(tool))temp={type:tool,x1:start.x,y1:start.y,x2:p.x,y2:p.y,width,color:color(tool),label:meta({type:tool})?.label};if(tool==='rect'||['zone_litter','zone_feed','zone_exercise','zone_custom','litter'].includes(tool))temp={type:tool,x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y),width,color:color(tool),label:meta({type:tool})?.label,zoneType:meta({type:tool})?.label};renderCanvas();});
  const finish=()=>{if(!drawing)return;drawing=false;if(tool==='select'){persist();return}if(temp&&(tool==='free'?temp.points.length>1:(isLinear(temp)||temp.type==='line'?Math.hypot(temp.x2-temp.x1,temp.y2-temp.y1)>8:(isZone(temp)||temp.type==='rect'?temp.w>8&&temp.h>8:true)))){if(tool==='litter')createLinkedLitterZone(temp);else commit(temp)}else{temp=null;renderCanvas()}};canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  document.getElementById('plan-undo').onclick=()=>{const s=history.pop();if(s)redo.push(s);selectedId='';persist()};document.getElementById('plan-redo').onclick=()=>{const s=redo.pop();if(s)history.push(s);persist()};document.getElementById('plan-delete-selected').onclick=()=>{if(!selectedId)return;const i=history.findIndex(x=>x.id===selectedId);if(i>=0)history.splice(i,1);selectedId='';persist()};document.getElementById('plan-clear').onclick=()=>{if(confirm('Effacer tous les objets ajoutés en conservant le contour du bâtiment ?')){const kept=history.filter(s=>s.type==='building_outline');const removed=history.filter(s=>s.type!=='building_outline');redo.push(...removed);history.splice(0,history.length,...kept);selectedId='';persist()}};
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


const sectionPalette=['violet','blue','teal','amber','coral','rose'];
const auditSectionThemes={sanitaire:'violet',reproduction:'blue',jeunes:'teal',pratiques:'amber',fourrages:'coral',organisation:'rose'};
function auditSectionTheme(section,index=0){return auditSectionThemes[section?.id]||sectionPalette[index%sectionPalette.length];}
function completionState(done,total){return done<=0?'empty':done>=total?'complete':'progress';}
function buildingGroupIcon(group=''){if(group.includes('Eau'))return '💧';if(group.includes('Couchage'))return '🛏️';if(group.includes('Ventilation'))return '🌬️';if(group.includes('Circulation'))return '🚪';if(group.includes('Veaux'))return '🐮';if(group.includes('Hygiène'))return '🧼';return '🏠';}
function auditSectionProgress(section,a){const done=section.questions.filter(q=>{const i=a.answers[q]||{};return i.answer||(i.values||[]).length||i.comment}).length;return{done,total:section.questions.length,pct:Math.round(done/Math.max(1,section.questions.length)*100),state:completionState(done,section.questions.length)};}
function renderBuildingQuestionnaire(panel,{visit,audit}){
  const groupStats=buildingQuestionGroups.map(([group,questions],gi)=>{const done=questions.filter(q=>audit.questionnaire[q]?.status).length;return{group,questions,gi,done,total:questions.length,pct:Math.round(done/questions.length*100),state:completionState(done,questions.length)};});
  panel.innerHTML=`<div class="section-title"><div><h3>Questionnaire bâtiment</h3><div class="muted">Les couleurs permettent de repérer rapidement les thèmes et leur avancement.</div></div></div><div class="building-progress-overview">${groupStats.map(x=>`<button class="building-progress-chip theme-${sectionPalette[x.gi%sectionPalette.length]} state-${x.state}" data-open-building-group="${x.gi}"><span>${buildingGroupIcon(x.group)}</span><b>${escapeHtml(x.group)}</b><small>${x.done}/${x.total}</small><i><em style="width:${x.pct}%"></em></i></button>`).join('')}</div><div class="question-groups">${groupStats.map(x=>`<details class="card question-group theme-${sectionPalette[x.gi%sectionPalette.length]} state-${x.state}" data-building-group="${x.gi}"><summary><span class="section-summary-title"><span class="section-icon">${buildingGroupIcon(x.group)}</span><strong>${escapeHtml(x.group)}</strong></span><span class="section-progress"><b>${x.done}/${x.total}</b><small>${x.state==='complete'?'✓ Terminé':x.state==='progress'?'En cours':'À commencer'}</small></span></summary><div class="question-list">${x.questions.map(q=>{const item=audit.questionnaire[q]||{};return `<div class="question-row"><div><strong>${escapeHtml(q)}</strong><input class="question-comment" data-qcomment="${escapeHtml(q)}" value="${escapeHtml(item.comment||'')}" placeholder="Commentaire"></div><select data-qstatus="${escapeHtml(q)}"><option value="">Non renseigné</option>${['Satisfaisant','À surveiller','À corriger','Non concerné'].map(v=>`<option ${item.status===v?'selected':''}>${v}</option>`).join('')}</select></div>`}).join('')}</div></details>`).join('')}</div>`;
  panel.querySelectorAll('[data-open-building-group]').forEach(b=>b.onclick=()=>{const d=panel.querySelector(`[data-building-group="${b.dataset.openBuildingGroup}"]`);if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});}});
  panel.querySelectorAll('[data-qstatus]').forEach(el=>el.addEventListener('change',()=>{const q=el.dataset.qstatus;audit.questionnaire[q]=audit.questionnaire[q]||{};audit.questionnaire[q].status=el.value;saveBuildingAudit(visit);renderBuildingQuestionnaire(panel,currentBuildingContext())}));
  panel.querySelectorAll('[data-qcomment]').forEach(el=>{const save=()=>{const q=el.dataset.qcomment;audit.questionnaire[q]=audit.questionnaire[q]||{};audit.questionnaire[q].comment=el.value;saveBuildingAudit(visit)};el.addEventListener('input',save);el.addEventListener('blur',save)});
}


const auditQuestionConfigs = {
  'Principaux problèmes sanitaires rencontrés sur les 12 derniers mois': ['multi',['Aucun problème majeur','Diarrhées','Troubles respiratoires','Avortements','Mammites','Boiteries','Omphalites / arthrites','Mortalité veaux','Mortalité adultes','Problèmes de reproduction','Autre']],
  'Organisation de la vaccination': ['multi',['Plan écrit','Plan oral','Vaccination collective','Vaccination ciblée','Rappels planifiés','Selon le contexte','Aucune vaccination','Autre']],
  'Gestion du parasitisme et recours aux coprologies': ['multi',['Coprologies régulières','Coprologies ponctuelles','Traitement raisonné selon résultats','Traitement selon risque / saison','Traitement systématique','Aucun suivi','Autre']],
  'Gestion des traitements et respect des délais d’attente': ['select',['Traçabilité complète','Traçabilité partielle','Gestion orale / mémoire','À améliorer']],
  'Registre sanitaire et traçabilité des interventions': ['select',['Papier à jour','Informatique à jour','Mise à jour irrégulière','Non tenu']],
  'Gestion des animaux malades et possibilité d’isolement': ['multi',['Case dédiée','Lot spécifique','Isolement ponctuel','Soins dans le lot','Pas de zone dédiée','Autre']],
  'Gestion des introductions et quarantaine': ['multi',['Pas d’introduction','Quarantaine systématique','Quarantaine ponctuelle','Analyses avant introduction','Vaccination avant mélange','Mélange direct','Autre']],
  'Statut sanitaire des animaux achetés': ['multi',['Documents contrôlés','Analyses demandées','Historique sanitaire connu','Contrôle partiel','Non vérifié','Pas d’achat']],
  'Gestion des cadavres et des déchets de soins': ['multi',['Zone dédiée','Équarrissage organisé','Déchets de soins triés','Stockage temporaire sécurisé','À améliorer']],
  'Plan de lutte contre les nuisibles': ['multi',['Dératisation planifiée','Pièges / appâts suivis','Lutte contre les mouches','Protection des aliments','Prestataire','Aucun plan']],
  'Relation et fréquence de suivi avec le vétérinaire sanitaire': ['select',['Suivi régulier planifié','À la demande','Urgences principalement','Peu de suivi']],
  'Mode de mise à la reproduction': ['multi',['Monte naturelle','Insémination artificielle','Synchronisation','Transfert embryonnaire','Mixte','Autre']],
  'Période de mise à la reproduction': ['select',['Toute l’année','Saison groupée','Deux périodes','Variable selon lots','Autre']],
  'Suivi des chaleurs et des retours': ['multi',['Observation visuelle','Taureau détecteur','Colliers / capteurs','Planning papier','Logiciel','Peu de suivi','Autre']],
  'Diagnostics de gestation': ['select',['Systématiques','Sur une partie du troupeau','Selon suspicion','Non réalisés']],
  'Gestion des vaches vides': ['multi',['Réforme rapide','Nouvelle mise à la reproduction','Lot spécifique','Engraissement avant vente','Décision au cas par cas','Autre']],
  'Préparation des animaux à la mise bas': ['multi',['Lot dédié','Ration spécifique','Minéral spécifique','Surveillance renforcée','Case de vêlage','Pas de préparation particulière','Autre']],
  'Surveillance des vêlages': ['multi',['Présence régulière','Caméra','Capteur de vêlage','Rondes nocturnes','Surveillance ponctuelle','Autre']],
  'Gestion des délivrances et complications post-partum': ['multi',['Protocole vétérinaire','Surveillance systématique','Traitement selon signes','Enregistrement des cas','Pas de protocole','Autre']],
  'Âge moyen au premier vêlage': ['number','mois'],
  'Intervalle vêlage-vêlage': ['number','jours'],
  'Origine des génisses de renouvellement': ['select',['100 % élevage','Majoritairement élevage','Mixte élevage / achat','Majoritairement achat','100 % achat']],
  'Critères de sélection des génisses': ['multi',['Origine maternelle','Croissance','Conformation','Aplombs','Docilité','Santé','Valeur génétique','Facilité de naissance','Autre']],
  'Désinfection du nombril': ['select',['Systématique à la naissance','Systématique avec renouvellement','Selon état','Rarement','Jamais']],
  'Délai de distribution du colostrum': ['select',['Moins de 2 h','2 à 4 h','4 à 6 h','Plus de 6 h','Variable / non suivi']],
  'Contrôle de la qualité du colostrum': ['select',['Réfractomètre systématique','Réfractomètre ponctuel','Contrôle visuel','Non contrôlée']],
  'Quantité de colostrum distribuée': ['select',['Quantité mesurée et adaptée','Quantité estimée','Tétée naturelle surveillée','Variable','Non suivie']],
  'Mode de logement des veaux': ['multi',['Case individuelle','Case collective','Nurserie','Avec la mère','Extérieur','Mixte','Autre']],
  'Nettoyage et désinfection entre lots': ['multi',['Curage complet','Lavage','Désinfection','Vide sanitaire','Paillage seul','Pas systématique','Autre']],
  'Accès à l’eau et à l’aliment solide': ['multi',['Eau dès la naissance','Eau après quelques jours','Concentré précoce','Foin précoce','Accès irrégulier','Autre']],
  'Mode et âge de sevrage': ['multi',['Progressif','Brutal','Selon âge','Selon poids','Selon consommation','Par lot','Autre']],
  'Suivi de la croissance': ['multi',['Pesées régulières','Pesées ponctuelles','Ruban barymétrique','Observation visuelle','Pas de suivi','Autre']],
  'Organisation de l’allotement': ['multi',['Par âge','Par poids','Par stade physiologique','Par besoins alimentaires','Par sexe','Peu d’allotement','Autre']],
  'Mode de pâturage': ['multi',['Continu','Tournant','Tournant dynamique','Paddocks','Estive','Affouragement au champ','Pas de pâturage','Autre']],
  'Gestion de l’estive': ['select',['Pas d’estive','Tous les animaux concernés','Une partie du troupeau','Selon années','Autre']],
  'Transitions alimentaires': ['select',['Plus de 2 semaines','7–14 jours','Moins de 7 jours','Sans transition','Variable']],
  'Organisation du tarissement': ['multi',['Lot dédié','Ration dédiée','Tarissement groupé','Tarissement individuel','Pas de conduite spécifique','Non concerné','Autre']],
  'Fréquence d’observation du troupeau': ['select',['Plusieurs fois par jour','Une fois par jour','Quelques fois par semaine','Irrégulière']],
  'Parage et suivi des aplombs': ['multi',['Parage préventif planifié','Parage curatif','Observation régulière','Intervention ponctuelle','Pas de suivi','Autre']],
  'Type de sol des principales surfaces': ['multi',['Argileux','Limoneux','Sableux','Argilo-limoneux','Limono-argileux','Calcaire','Hydromorphe','Tourbeux','Plusieurs types','Non connu','Autre']],
  'Type de prairies': ['multi',['Prairies permanentes','Prairies temporaires','Parcours / landes','Prairies naturelles','Mixte','Autre']],
  'Pratique du sur-semis': ['select',['Régulière','Occasionnelle','Après dégradation','Jamais']],
  'Espèces semées dans les prairies temporaires ou sur-semis': ['multi',['Ray-grass anglais','Ray-grass hybride','Ray-grass italien','Dactyle','Fétuque élevée','Fétuque des prés','Fléole','Brome','Luzerne','Trèfle blanc','Trèfle violet','Lotier','Méteil','Mélange multi-espèces','Autre']],
  'Rotation des cultures et prairies': ['multi',['Rotation planifiée','Prairie longue durée','Maïs / prairie','Céréales / prairie','Luzerne dans la rotation','Rotation variable','Pas de rotation formalisée','Autre']],
  'Fertilisation et amendements': ['multi',['Fumier','Lisier','Compost','Azote minéral','Phosphore','Potasse','Chaulage','Analyse de sol utilisée','Plan de fumure','Selon habitudes','Autre']],
  'Irrigation': ['select',['Aucune','Ponctuelle','Régulière','Uniquement certaines cultures','Selon disponibilité en eau']],
  'Stade de récolte des fourrages': ['multi',['Feuillu / précoce','Début épiaison','Épiaison','Floraison','Après floraison','Variable selon météo','Autre']],
  'Hauteur de coupe': ['select',['Moins de 5 cm','5–7 cm','7–10 cm','Plus de 10 cm','Variable / non mesurée']],
  'Qualité visuelle du foin': ['multi',['Vert','Bonne odeur','Peu poussiéreux','Sans moisissure','Jauni','Poussiéreux','Moisissures visibles','Échauffement','Hétérogène selon lots','Autre']],
  'Matière sèche du foin': ['select',['Mesurée','Estimée','Non connue','Variable selon lots']],
  'Méthode de réalisation du foin': ['multi',['Fauché sans conditionneur','Fauché avec conditionneur','Fanage','Andains de nuit','Andainage au soleil','Balles rondes','Balles carrées','Séchage en grange','Conservateur','Autre']],
  'Réalisation des ensilages': ['multi',['Récolte directe','Préfanage','Conditionneur','Hachage court','Hachage long','Conservateur','Chantier rapide','Chantier étalé','Autre']],
  'Tassement, bâchage et protection des silos': ['multi',['Tassage continu','Couches fines','Double bâche','Film barrière oxygène','Bâche simple','Filet / sacs','Pneus','Protection des bords','Défauts visibles','Autre']],
  'Réalisation de l’enrubannage': ['multi',['Préfanage','Balles rondes','Balles carrées','4 couches','6 couches ou plus','Film clair','Film foncé','Stockage vertical','Stockage horizontal','Perforations observées','Autre']],
  'Stockage des fourrages': ['multi',['Sous bâtiment','Sur dalle','Sur palettes','Bâché extérieur','Directement au sol','Séparé par lots','Protégé des nuisibles','Autre']],
  'Analyses de fourrages disponibles': ['multi',['Foin','Enrubannage','Ensilage maïs','Ensilage herbe','Céréales','Méteil','Paille','Minéral','Aucune','Autre']],
  'Gestion du front d’attaque et distribution': ['multi',['Avancement régulier','Front net','Reprise quotidienne','Échauffement limité','Échauffement présent','Moisissures retirées','Mélange des lots','Autre']],
  'Temps de travail et astreintes': ['select',['Compatible avec l’organisation','Tendu en période de pointe','Très contraignant','Recours fréquent à des prestataires','À réorganiser']],
  'Suivi des actions décidées lors des visites précédentes': ['select',['Systématique','Partiel','Occasionnel','Non formalisé','Première visite']]
};
const herdTimelineTypes=['Mise à l’herbe','Retour en bâtiment','Estive','Descente d’estive','Changement de ration','Changement de fourrage','Changement de minéral','Vaccination du troupeau','Vermifugation','Coproscopie','Parage','Autre'];
const cropTimelineTypes=['Préparation du sol','Semis printemps','Semis été','Semis automne','Semis hiver','Fumier','Lisier','Compost','Fertilisation','Irrigation','Traitement','Fauche foin','Regain','Enrubannage','Ensilage','Récolte grain','Pâturage','Autre'];
const purchaseProducts=['Foin','Paille','Ensilage','Enrubannage','Maïs grain','Maïs épi','Luzerne','Aliment complet','Concentré','Minéral','Correcteur azoté','Pulpes','Coproduits','Autre'];
const saleProducts=['Céréales','Foin','Paille','Enrubannage','Ensilage','Fourrage autre','Reproducteurs','Broutards','Veaux sous la mère','Animaux engraissés','Vente directe viande','Vaches de réforme','Autre'];
const reformReasons=['Problème de reproduction','Aplombs / boiterie','Âge','Mamelle','Sanitaire','Production insuffisante','Accident','Tempérament','Autre'];
const mortalityClasses=['0–2 jours','2 jours–1 mois','1–6 mois','6–12 mois','12–24 mois','> 24 mois'];
const mortalityCauses=['Diarrhée','Respiratoire','Accident','Métabolique','Mise bas','Intoxication','Prédation','Malformation','Inconnue','Autre'];
const farmerObjectives=['Gain économique / réduction des coûts','Améliorer la santé animale','Améliorer la reproduction','Améliorer les performances','Mieux valoriser les fourrages','Gagner en autonomie','Simplifier la charge de travail','Améliorer le bien-être animal','Transmission / installation','Adapter les bâtiments','Autre'];
function ensureAuditGlobal(visit){const a=visit.auditGlobal=visit.auditGlobal&&typeof visit.auditGlobal==='object'?visit.auditGlobal:{};a.answers=a.answers&&typeof a.answers==='object'?a.answers:{};a.purchases=Array.isArray(a.purchases)?a.purchases:[];a.sales=Array.isArray(a.sales)?a.sales:(Array.isArray(a.outlets)?a.outlets.map(x=>({...x,product:x.product||x.type})):[]);a.reforms=a.reforms&&typeof a.reforms==='object'?a.reforms:{};a.reforms.reasons=a.reforms.reasons&&typeof a.reforms.reasons==='object'?a.reforms.reasons:{};a.renewal=a.renewal&&typeof a.renewal==='object'?a.renewal:{};a.mortality=a.mortality&&typeof a.mortality==='object'?a.mortality:{};mortalityClasses.forEach(c=>a.mortality[c]=a.mortality[c]&&typeof a.mortality[c]==='object'?a.mortality[c]:{count:'',causes:[]});a.economics=a.economics&&typeof a.economics==='object'?a.economics:{};a.organization=a.organization&&typeof a.organization==='object'?a.organization:{objectives:[]};a.organization.objectives=Array.isArray(a.organization.objectives)?a.organization.objectives:[];a.chapterSummaries=a.chapterSummaries&&typeof a.chapterSummaries==='object'?a.chapterSummaries:{};a.timelines=a.timelines&&typeof a.timelines==='object'?a.timelines:{};a.timelines.startMonth=a.timelines.startMonth||`${(visit.date||new Date().toISOString().slice(0,10)).slice(0,7)}`;a.timelines.herd=Array.isArray(a.timelines.herd)?a.timelines.herd:[];a.timelines.crops=Array.isArray(a.timelines.crops)?a.timelines.crops:[];return a}
function auditCompletion(a){const qs=auditGlobalSections.flatMap(s=>s.questions),done=qs.filter(q=>{const i=a.answers[q]||{};return i.answer||(Array.isArray(i.values)&&i.values.length)||i.comment}).length,extra=[a.purchases.length,a.sales.length,Object.values(a.renewal).filter(Boolean).length,Object.values(a.mortality).filter(x=>x?.count).length].filter(Boolean).length;return{done:done+extra,total:qs.length+4,pct:Math.round((done+extra)/(qs.length+4)*100)}}
function saveAuditGlobal(v){v.updatedAt=new Date().toISOString();saveDatabase(db)}
function qConfig(q){const c=auditQuestionConfigs[q];return c?{type:c[0],options:Array.isArray(c[1])?c[1]:[],unit:typeof c[1]==='string'?c[1]:''}:{type:'text'}}
function auditInputHtml(q,item){const c=qConfig(q);if(c.type==='select')return `<select data-audit-answer="${escapeHtml(q)}"><option value="">Choisir…</option>${c.options.map(v=>`<option value="${escapeHtml(v)}" ${item.answer===v?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select>`;if(c.type==='number')return `<div class="input-with-unit"><input type="number" step="any" data-audit-answer="${escapeHtml(q)}" value="${escapeHtml(item.answer||'')}"><span>${escapeHtml(c.unit)}</span></div>`;if(c.type==='multi'){const vals=Array.isArray(item.values)?item.values:[];return `<div class="audit-multi">${c.options.map(v=>`<label><input type="checkbox" data-audit-multi="${escapeHtml(q)}" value="${escapeHtml(v)}" ${vals.includes(v)?'checked':''}><span>${escapeHtml(v)}</span></label>`).join('')}</div><input data-audit-answer="${escapeHtml(q)}" value="${escapeHtml(item.answer||'')}" placeholder="Précision / autre">`}return `<textarea data-audit-answer="${escapeHtml(q)}" placeholder="Réponse / description">${escapeHtml(item.answer||'')}</textarea>`}
function auditQuestionRow(q,a){const i=a.answers[q]||{};return `<div class="audit-question-row audit-question-smart"><div class="audit-question-title"><strong>${escapeHtml(q)}</strong></div><div class="audit-question-control">${auditInputHtml(q,i)}</div><textarea data-audit-comment="${escapeHtml(q)}" placeholder="Commentaire facultatif">${escapeHtml(i.comment||'')}</textarea></div>`}
function chapterSummaryHtml(id,a){const s=a.chapterSummaries[id]||{};return `<div class="chapter-summary"><h4>Synthèse du technicien</h4><div class="grid cols-3"><div class="field"><label>Points forts</label><textarea data-summary="${id}" data-summary-field="strengths">${escapeHtml(s.strengths||'')}</textarea></div><div class="field"><label>Points de vigilance</label><textarea data-summary="${id}" data-summary-field="watch">${escapeHtml(s.watch||'')}</textarea></div><div class="field"><label>Commentaires / pistes</label><textarea data-summary="${id}" data-summary-field="comments">${escapeHtml(s.comments||'')}</textarea></div></div></div>`}
function timelineMonths(start){const[y,m]=(start||new Date().toISOString().slice(0,7)).split('-').map(Number);return Array.from({length:18},(_,i)=>{const d=new Date(y,m-1+i,1);return{key:d.toISOString().slice(0,7),label:d.toLocaleDateString('fr-FR',{month:'short',year:'2-digit'})}})}
function timelineVisual(kind,a){const ms=timelineMonths(a.timelines.startMonth),events=a.timelines[kind]||[];return `<div class="timeline-board"><div class="timeline-months">${ms.map(m=>`<span>${escapeHtml(m.label)}</span>`).join('')}</div><div class="timeline-events">${events.length?events.map(ev=>{const si=Math.max(0,ms.findIndex(m=>m.key===ev.start)),ri=ms.findIndex(m=>m.key===(ev.end||ev.start)),ei=Math.max(si,ri<0?si:ri);return `<div class="timeline-event-row"><div class="timeline-event-label"><strong>${escapeHtml(ev.type)}</strong>${ev.comment?`<small>${escapeHtml(ev.comment)}</small>`:''}</div><div class="timeline-track"><div class="timeline-bar ${kind}" style="left:${si/18*100}%;width:${(ei-si+1)/18*100}%">${si===ei?'●':''}</div></div><button class="btn small danger" data-delete-timeline="${kind}" data-id="${ev.id}">×</button></div>`}).join(''):'<div class="empty compact">Aucun événement placé.</div>'}</div></div>`}
function timelineEditor(kind,a){const ms=timelineMonths(a.timelines.startMonth),types=kind==='herd'?herdTimelineTypes:cropTimelineTypes;return `<section class="card timeline-card"><div class="section-title"><div><h3>${kind==='herd'?'🐄 Frise conduite de l’élevage':'🌱 Frise cultures et fourrages'}</h3><div class="muted">Repères globaux sur la façon de travailler.</div></div></div>${timelineVisual(kind,a)}<div class="timeline-add"><select data-timeline-type="${kind}">${types.map(v=>`<option>${escapeHtml(v)}</option>`).join('')}</select><select data-timeline-start="${kind}">${ms.map(m=>`<option value="${m.key}">${escapeHtml(m.label)}</option>`).join('')}</select><select data-timeline-end="${kind}">${ms.map(m=>`<option value="${m.key}">${escapeHtml(m.label)}</option>`).join('')}</select><input data-timeline-comment="${kind}" placeholder="Note facultative"><button class="btn primary" data-add-timeline="${kind}">Ajouter</button></div></section>`}
function economicTable(kind,rows,products){const purchase=kind==='purchase';return `<section class="card"><div class="section-title"><div><h3>${purchase?'Achats':'Ventes / revenus'}</h3></div><button class="btn primary" data-add-economic="${kind}">Ajouter une ligne</button></div>${rows.length?`<div class="table-wrap"><table class="audit-table"><thead><tr><th>Produit</th><th>Précision</th><th>Quantité</th><th>Unité</th><th>Tarif unitaire €</th><th>Total €</th><th>${purchase?'Fournisseur':'Acheteur / débouché'}</th><th>Commentaire</th><th></th></tr></thead><tbody>${rows.map(r=>{const total=(Number(r.quantity)||0)*(Number(r.unitPrice)||0);return `<tr><td><select data-economic-field="product" data-kind="${kind}" data-id="${r.id}">${products.map(v=>`<option ${r.product===v?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select></td><td><input data-economic-field="detail" data-kind="${kind}" data-id="${r.id}" value="${escapeHtml(r.detail||'')}"></td><td><input type="number" step="any" data-economic-field="quantity" data-kind="${kind}" data-id="${r.id}" value="${escapeHtml(r.quantity||'')}"></td><td><input data-economic-field="unit" data-kind="${kind}" data-id="${r.id}" value="${escapeHtml(r.unit||'')}"></td><td><input type="number" step="any" data-economic-field="unitPrice" data-kind="${kind}" data-id="${r.id}" value="${escapeHtml(r.unitPrice||'')}"></td><td><strong>${total?total.toLocaleString('fr-FR',{maximumFractionDigits:2}):''}</strong></td><td><input data-economic-field="partner" data-kind="${kind}" data-id="${r.id}" value="${escapeHtml(r.partner||'')}"></td><td><textarea data-economic-field="comment" data-kind="${kind}" data-id="${r.id}">${escapeHtml(r.comment||'')}</textarea></td><td><button class="btn small danger" data-delete-economic="${kind}" data-id="${r.id}">Suppr.</button></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">Aucune ligne renseignée.</div>'}</section>`}
const renewalRate=a=>Number(a.cowsTotal)?Math.round((Number(a.replacementHeifers)||0)/Number(a.cowsTotal)*1000)/10:null;
const reformRate=a=>Number(a.cowsTotal)?Math.round((Number(a.annualReforms)||0)/Number(a.cowsTotal)*1000)/10:null;
function renderAuditGlobal(){const visit=activeVisit();if(!visit){renderNoActiveVisit('Audit de l’exploitation');return}const a=ensureAuditGlobal(visit),c=auditCompletion(a),rr=renewalRate(a.renewal),rf=reformRate(a.renewal);app.innerHTML=`<div class="section-title"><div><h2>Audit de l’exploitation</h2><div class="muted">Réponses adaptées à chaque question et tableaux technico-économiques.</div></div><div class="actions"><span class="badge autosave">Sauvegarde automatique</span></div></div>${activeVisitBanner(visit)}${a.importedHerdData?`<section class="notice imported-data-notice"><strong>📥 Données d’élevage importées</strong><br>Source : ${escapeHtml(a.importedHerdData.sourceFile||'CSV')} · appliquées le ${formatDateTime(a.importedHerdData.appliedAt)}. Les effectifs, mortalités, achats, débouchés et indicateurs de reproduction doivent être vérifiés avec l’éleveur.<details><summary>Voir les indicateurs complémentaires</summary><div class="grid cols-3">${Object.entries(a.importedHerdData.summary||{}).filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([k,v])=>`<div class="calculated-box"><span>${escapeHtml(({totalHerd:'Effectif total',births:'Naissances',purchases:'Achats',totalOutputs:'Sorties totales',mortalityTotal:'Mortalité totale',mortalityYoungRate:'Taux mortalité jeunes (%)',abortions:'Avortements',productivity:'Productivité numérique',unproductiveFemales:'Femelles improductives'})[k]||k)}</span><strong>${escapeHtml(String(v).replace('.',','))}</strong></div>`).join('')}</div></details></section>`:''}<section class="card audit-progress-card"><div><strong>Avancement</strong><span>${c.done}/${c.total} éléments</span></div><div class="progress-track large"><div style="width:${c.pct}%"></div></div><strong>${c.pct}%</strong></section><section class="card audit-docs-card"><div class="section-title"><div><h3>Documents imprimables</h3><div class="muted">Les documents vierges ne reprennent aucun animal enregistré.</div></div></div><div class="audit-toolbar wrap"><button class="btn secondary" id="print-full-blank">Guide complet vierge</button><button class="btn secondary" id="print-analysis-blank">Analyses seules</button><button class="btn secondary" id="print-audit-blank">Audit seul vierge</button><button class="btn secondary" id="print-audit-filled">Audit renseigné</button><button class="btn" id="open-all-audit">Tout ouvrir</button><button class="btn" id="close-all-audit">Tout fermer</button></div></section><section class="card timeline-settings"><div class="field"><label>Mois de départ des frises</label><input type="month" id="timeline-start-month" value="${escapeHtml(a.timelines.startMonth)}"></div></section><div class="timeline-grid">${timelineEditor('herd',a)}${timelineEditor('crops',a)}</div><div class="audit-section-overview">${auditGlobalSections.map((s,si)=>{const p=auditSectionProgress(s,a);return `<button class="audit-overview-item theme-${auditSectionTheme(s,si)} state-${p.state}" data-open-audit-section="${s.id}"><span>${s.icon}</span><b>${escapeHtml(s.title)}</b><small>${p.done}/${p.total}</small><i><em style="width:${p.pct}%"></em></i></button>`}).join('')}</div><div class="audit-sections">${auditGlobalSections.map((s,si)=>{const p=auditSectionProgress(s,a);return `<details class="card audit-section theme-${auditSectionTheme(s,si)} state-${p.state}" data-audit-section-id="${s.id}"><summary><span><span class="audit-icon">${s.icon}</span><strong>${escapeHtml(s.title)}</strong></span><span class="audit-section-status"><span class="audit-count">${p.done}/${p.total}</span><small>${p.state==='complete'?'✓ Terminé':p.state==='progress'?'En cours':'À commencer'}</small></span></summary><div class="audit-question-list">${s.questions.map(q=>auditQuestionRow(q,a)).join('')}${chapterSummaryHtml(s.id,a)}</div></details>`}).join('')}</div><section class="card structured-audit accent-rose"><h3>🎯 Objectifs de l’éleveur et pluriactivité</h3><div class="audit-multi objectives">${farmerObjectives.map(v=>`<label><input type="checkbox" data-objective value="${escapeHtml(v)}" ${a.organization.objectives.includes(v)?'checked':''}><span>${escapeHtml(v)}</span></label>`).join('')}</div><div class="grid cols-3"><div class="field"><label>Pluriactif</label><select data-org="pluriactive"><option value="">Non renseigné</option>${['Non','Oui'].map(v=>`<option ${a.organization.pluriactive===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Organisation</label><select data-org="pluriactivityMode"><option value="">Choisir…</option>${['Activité annuelle','Activité saisonnière','Activité ponctuelle'].map(v=>`<option ${a.organization.pluriactivityMode===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Période / répartition / % du temps</label><input data-org="pluriactivityDetail" value="${escapeHtml(a.organization.pluriactivityDetail||'')}"></div></div></section><section class="grid cols-2 structured-audit"><article class="card accent-teal"><h3>🐄 Structure du troupeau et renouvellement</h3>${[['cowsTotal','Vaches mères / production'],['cowsPregnant','Vaches pleines'],['cowsEmpty','Vaches vides'],['nurseCows','Tantes / nourrices'],['bulls','Taureaux reproducteurs'],['pregnantHeifers','Génisses pleines'],['heifers12_24','Génisses 12–24 mois'],['heifers6_12','Génisses 6–12 mois'],['calvesUnder6','Veaux < 6 mois'],['replacementHeifers','Génisses de renouvellement'],['annualReforms','Nombre annuel de réformes']].map(([k,l])=>`<div class="field inline-field"><label>${l}</label><input type="number" min="0" data-renewal="${k}" value="${escapeHtml(a.renewal[k]||'')}"></div>`).join('')}<div class="calculated-box"><span>Taux de renouvellement</span><strong>${rr===null?'—':rr+' %'}</strong></div><div class="calculated-box"><span>Taux de réforme</span><strong>${rf===null?'—':rf+' %'}</strong></div></article><article class="card accent-coral"><h3>📉 Motifs des réformes</h3>${reformReasons.map(v=>`<div class="field inline-field"><label>${v}</label><input type="number" min="0" data-reform-reason="${v}" value="${escapeHtml(a.reforms.reasons[v]||'')}"></div>`).join('')}<div class="field"><label>Commentaire</label><textarea data-reform-comment>${escapeHtml(a.reforms.comment||'')}</textarea></div></article></section>${a.importedHerdData?`<section class="card imported-mortality-recap"><div class="section-title"><div><h3>📥 Mortalité importée</h3><div class="muted">Valeurs issues du fichier élevage et reprises ci-dessous dans les champs de l’audit.</div></div></div><div class="grid cols-3">${mortalityClasses.map(cl=>`<div class="calculated-box"><span>${escapeHtml(cl)}</span><strong>${escapeHtml(a.mortality[cl]?.count||'—')}</strong></div>`).join('')}</div></section>`:''}<section class="card structured-audit accent-red"><h3>⚕️ Mortalité par classe d’âge</h3><div class="table-wrap"><table class="audit-table"><thead><tr><th>Classe</th><th>Nombre</th><th>Causes</th><th>Commentaire</th></tr></thead><tbody>${mortalityClasses.map(cl=>{const r=a.mortality[cl];return `<tr><td><strong>${cl}</strong></td><td><input type="number" min="0" data-mortality-count="${cl}" value="${escapeHtml(r.count||'')}"></td><td><div class="audit-multi compact">${mortalityCauses.map(v=>`<label><input type="checkbox" data-mortality-cause="${cl}" value="${v}" ${r.causes.includes(v)?'checked':''}><span>${v}</span></label>`).join('')}</div></td><td><textarea data-mortality-comment="${cl}">${escapeHtml(r.comment||'')}</textarea></td></tr>`}).join('')}</tbody></table></div></section><section class="grid cols-2 structured-audit"><article class="card accent-violet"><h3>💊 Charges sanitaires annuelles</h3><div class="field"><label>Fourchette</label><select data-econ="sanitaryRange"><option value="">Choisir…</option>${['< 2 000 €','2 000–5 000 €','5 000–10 000 €','10 000–20 000 €','> 20 000 €'].map(v=>`<option ${a.economics.sanitaryRange===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Somme exacte (€)</label><input type="number" data-econ="sanitaryAmount" value="${escapeHtml(a.economics.sanitaryAmount||'')}"></div><div class="field"><label>Précisions</label><textarea data-econ="sanitaryComment">${escapeHtml(a.economics.sanitaryComment||'')}</textarea></div></article><article class="card accent-amber"><h3>💶 Résultat économique annuel</h3><div class="field"><label>Indicateur</label><select data-econ="resultType"><option value="">Choisir…</option>${['EBE','Marge brute','Résultat courant','Résultat disponible','Autre'].map(v=>`<option ${a.economics.resultType===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Montant (€)</label><input type="number" data-econ="annualResult" value="${escapeHtml(a.economics.annualResult||'')}"></div><div class="field"><label>Commentaire</label><textarea data-econ="resultComment">${escapeHtml(a.economics.resultComment||'')}</textarea></div></article></section>${economicTable('purchase',a.purchases,purchaseProducts)}${economicTable('sale',a.sales,saleProducts)}<section class="card"><h3>Conclusion libre</h3><textarea id="audit-global-notes">${escapeHtml(a.notes||'')}</textarea></section>`;
app.querySelectorAll('[data-open-library-theme]').forEach(b=>b.onclick=()=>openLibraryTheme(b.dataset.openLibraryTheme));const saveA=(q,f,v)=>{a.answers[q]=a.answers[q]||{};a.answers[q][f]=v;saveAuditGlobal(visit)};app.querySelectorAll('[data-audit-answer]').forEach(e=>{const s=()=>saveA(e.dataset.auditAnswer,'answer',e.value);e.addEventListener('input',s);e.addEventListener('change',s)});app.querySelectorAll('[data-audit-multi]').forEach(e=>e.onchange=()=>{const q=e.dataset.auditMulti;a.answers[q]=a.answers[q]||{};a.answers[q].values=[...app.querySelectorAll(`[data-audit-multi="${CSS.escape(q)}"]:checked`)].map(x=>x.value);saveAuditGlobal(visit)});app.querySelectorAll('[data-audit-comment]').forEach(e=>e.oninput=()=>saveA(e.dataset.auditComment,'comment',e.value));app.querySelectorAll('[data-summary]').forEach(e=>e.oninput=()=>{a.chapterSummaries[e.dataset.summary]=a.chapterSummaries[e.dataset.summary]||{};a.chapterSummaries[e.dataset.summary][e.dataset.summaryField]=e.value;saveAuditGlobal(visit)});document.getElementById('open-all-audit').onclick=()=>app.querySelectorAll('.audit-section').forEach(d=>d.open=true);document.getElementById('close-all-audit').onclick=()=>app.querySelectorAll('.audit-section').forEach(d=>d.open=false);app.querySelectorAll('[data-open-audit-section]').forEach(b=>b.onclick=()=>{const d=app.querySelector(`[data-audit-section-id="${CSS.escape(b.dataset.openAuditSection)}"]`);if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});}});document.getElementById('timeline-start-month').onchange=e=>{a.timelines.startMonth=e.target.value;saveAuditGlobal(visit);renderAuditGlobal()};app.querySelectorAll('[data-add-timeline]').forEach(b=>b.onclick=()=>{const k=b.dataset.addTimeline,type=app.querySelector(`[data-timeline-type="${k}"]`).value,start=app.querySelector(`[data-timeline-start="${k}"]`).value,end=app.querySelector(`[data-timeline-end="${k}"]`).value,comment=app.querySelector(`[data-timeline-comment="${k}"]`).value;a.timelines[k].push({id:uid('event'),type,start,end:end<start?start:end,comment});saveAuditGlobal(visit);renderAuditGlobal()});app.querySelectorAll('[data-delete-timeline]').forEach(b=>b.onclick=()=>{const k=b.dataset.deleteTimeline;a.timelines[k]=a.timelines[k].filter(x=>x.id!==b.dataset.id);saveAuditGlobal(visit);renderAuditGlobal()});app.querySelectorAll('[data-objective]').forEach(e=>e.onchange=()=>{a.organization.objectives=[...app.querySelectorAll('[data-objective]:checked')].map(x=>x.value);saveAuditGlobal(visit)});app.querySelectorAll('[data-org]').forEach(e=>{const s=()=>{a.organization[e.dataset.org]=e.value;saveAuditGlobal(visit)};e.addEventListener('input',s);e.addEventListener('change',s)});app.querySelectorAll('[data-renewal]').forEach(e=>{e.oninput=()=>{a.renewal[e.dataset.renewal]=e.value;saveAuditGlobal(visit)};e.onblur=renderAuditGlobal});app.querySelectorAll('[data-reform-reason]').forEach(e=>e.oninput=()=>{a.reforms.reasons[e.dataset.reformReason]=e.value;saveAuditGlobal(visit)});app.querySelector('[data-reform-comment]').oninput=e=>{a.reforms.comment=e.target.value;saveAuditGlobal(visit)};app.querySelectorAll('[data-mortality-count]').forEach(e=>e.oninput=()=>{a.mortality[e.dataset.mortalityCount].count=e.value;saveAuditGlobal(visit)});app.querySelectorAll('[data-mortality-cause]').forEach(e=>e.onchange=()=>{const c=e.dataset.mortalityCause;a.mortality[c].causes=[...app.querySelectorAll(`[data-mortality-cause="${CSS.escape(c)}"]:checked`)].map(x=>x.value);saveAuditGlobal(visit)});app.querySelectorAll('[data-mortality-comment]').forEach(e=>e.oninput=()=>{a.mortality[e.dataset.mortalityComment].comment=e.value;saveAuditGlobal(visit)});app.querySelectorAll('[data-econ]').forEach(e=>{const s=()=>{a.economics[e.dataset.econ]=e.value;saveAuditGlobal(visit)};e.addEventListener('input',s);e.addEventListener('change',s)});app.querySelectorAll('[data-add-economic]').forEach(b=>b.onclick=()=>{const k=b.dataset.addEconomic,arr=k==='purchase'?a.purchases:a.sales,p=k==='purchase'?purchaseProducts:saleProducts;arr.push({id:uid(k),product:p[0],unit:'t'});saveAuditGlobal(visit);renderAuditGlobal()});app.querySelectorAll('[data-economic-field]').forEach(e=>{const s=()=>{const arr=e.dataset.kind==='purchase'?a.purchases:a.sales,r=arr.find(x=>x.id===e.dataset.id);if(r){r[e.dataset.economicField]=e.value;saveAuditGlobal(visit)}};e.addEventListener('input',s);e.addEventListener('change',s);e.onblur=()=>{s();if(['quantity','unitPrice'].includes(e.dataset.economicField))renderAuditGlobal()}});app.querySelectorAll('[data-delete-economic]').forEach(b=>b.onclick=()=>{const arr=b.dataset.deleteEconomic==='purchase'?a.purchases:a.sales,i=arr.findIndex(x=>x.id===b.dataset.id);if(i>=0)arr.splice(i,1);saveAuditGlobal(visit);renderAuditGlobal()});document.getElementById('audit-global-notes').oninput=e=>{a.notes=e.target.value;saveAuditGlobal(visit)};document.getElementById('print-full-blank').onclick=()=>printAuditDocument(visit,'full-blank');document.getElementById('print-analysis-blank').onclick=()=>printAuditDocument(visit,'analysis-blank');document.getElementById('print-audit-blank').onclick=()=>printAuditDocument(visit,'audit-blank');document.getElementById('print-audit-filled').onclick=()=>printAuditDocument(visit,'audit-filled')}
function printBaseStyles(){return `body{font-family:Arial,sans-serif;color:#172033;margin:18px}h1{color:#b53670}h2{color:#8e2e5b;border-bottom:2px solid #efd5e1;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin-bottom:18px}tr{page-break-inside:avoid}th,td{border:1px solid #aab5ad;padding:7px;vertical-align:top;font-size:9.5pt}th{background:#fbeaf2}.meta,.summary-print{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:15px 0}.box{border:1px solid #aab5ad;padding:10px;min-height:44px}.blank-line{height:30px}.writing{height:48px}.checks{line-height:1.65}.landscape{font-size:8pt}@page{size:A4;margin:11mm}@media print{button{display:none}.landscape-page{page:landscape}}`}
function printChapter(id,a,filled){const s=filled?(a.chapterSummaries[id]||{}):{};return `<div class="summary-print"><div class="box"><b>Points forts</b><br>${escapeHtml(s.strengths||'')}</div><div class="box"><b>Points de vigilance</b><br>${escapeHtml(s.watch||'')}</div><div class="box"><b>Commentaires / pistes</b><br>${escapeHtml(s.comments||'')}</div></div>`}
function auditPrintHtml(visit,filled){const a=ensureAuditGlobal(visit);let h=auditGlobalSections.map(s=>`<h2>${s.icon} ${escapeHtml(s.title)}</h2><table><thead><tr><th>Question</th><th>Propositions</th><th>Réponse</th><th>Commentaire</th></tr></thead><tbody>${s.questions.map(q=>{const c=qConfig(q),i=filled?(a.answers[q]||{}):{};return `<tr><td>${escapeHtml(q)}</td><td class="checks">${(c.options||[]).map(v=>'☐ '+escapeHtml(v)).join('<br>')}</td><td class="writing">${filled?escapeHtml((i.values||[]).join(', ')||i.answer||''):''}</td><td class="writing">${filled?escapeHtml(i.comment||''):''}</td></tr>`}).join('')}</tbody></table>${printChapter(s.id,a,filled)}`).join('');h+=structuredPrintHtml(a,filled);return h}
function printRows(rows,filled){const r=filled&&rows.length?rows:Array.from({length:8},()=>({}));return r.map(x=>`<tr><td>${escapeHtml(x.product||'')}</td><td>${escapeHtml(x.detail||'')}</td><td>${escapeHtml(x.quantity||'')}</td><td>${escapeHtml(x.unit||'')}</td><td>${escapeHtml(x.unitPrice||'')}</td><td>${escapeHtml(x.partner||'')}</td><td>${escapeHtml(x.comment||'')}</td></tr>`).join('')}
function structuredPrintHtml(a,filled){return `<h2>Structure du troupeau et renouvellement</h2><table><tbody>${[['cowsTotal','Vaches mères / production'],['cowsPregnant','Vaches pleines'],['cowsEmpty','Vaches vides'],['nurseCows','Tantes / nourrices'],['bulls','Taureaux reproducteurs'],['pregnantHeifers','Génisses pleines'],['heifers12_24','Génisses 12–24 mois'],['heifers6_12','Génisses 6–12 mois'],['calvesUnder6','Veaux < 6 mois'],['replacementHeifers','Génisses de renouvellement'],['annualReforms','Réformes annuelles']].map(([k,l])=>`<tr><th>${l}</th><td>${filled?escapeHtml(a.renewal[k]||''):''}</td></tr>`).join('')}</tbody></table><h2>Mortalité</h2><table><thead><tr><th>Classe</th><th>Nombre</th><th>Causes</th><th>Commentaire</th></tr></thead><tbody>${mortalityClasses.map(c=>{const r=a.mortality[c];return `<tr><td>${c}</td><td>${filled?escapeHtml(r.count||''):''}</td><td class="checks">${filled?escapeHtml(r.causes.join(', ')):mortalityCauses.map(v=>'☐ '+v).join('<br>')}</td><td>${filled?escapeHtml(r.comment||''):''}</td></tr>`}).join('')}</tbody></table><h2>Achats</h2><table><thead><tr><th>Produit</th><th>Précision</th><th>Quantité</th><th>Unité</th><th>Tarif</th><th>Fournisseur</th><th>Commentaire</th></tr></thead><tbody>${printRows(a.purchases,filled)}</tbody></table><h2>Ventes / revenus</h2><table><thead><tr><th>Produit</th><th>Précision</th><th>Quantité</th><th>Unité</th><th>Tarif</th><th>Acheteur</th><th>Commentaire</th></tr></thead><tbody>${printRows(a.sales,filled)}</tbody></table>`}
function analysisPrintHtml(){return `<h2>Grille complète des mesures animales — vierge</h2><div class="landscape-page"><table class="landscape"><thead><tr>${['Boucle / sujet','Emplacement','Catégorie','NEC','Coul. urine','pH U','Redox U','Brix U','Densité U','Gly','BOH','Urée','pH sang','Aspect bouses','pH B','Redox B','Muscles','Poils','Membres','SRR','Temp.','Commentaire'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${Array.from({length:20},()=>`<tr>${Array.from({length:22},()=>'<td class="blank-line"></td>').join('')}</tr>`).join('')}</tbody></table></div>`}
function feedingPrintHtml(){return `<h2>Alimentation</h2><table><thead><tr>${['Catégorie','Type d’aliment','Nature / composition','Quantité','Unité','Distribution','Fréquence','Commentaire'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${Array.from({length:18},()=>`<tr>${Array.from({length:8},()=>'<td class="blank-line"></td>').join('')}</tr>`).join('')}</tbody></table>`}
function printAuditDocument(visit,mode){const filled=mode==='audit-filled';let title,content;if(mode==='full-blank'){title='Guide complet vierge';content=analysisPrintHtml()+feedingPrintHtml()+auditPrintHtml(visit,false)}else if(mode==='analysis-blank'){title='Grilles analyses vierges';content=analysisPrintHtml()}else if(mode==='audit-blank'){title='Audit vierge';content=auditPrintHtml(visit,false)}else{title='Audit renseigné';content=auditPrintHtml(visit,true)}const w=window.open('','_blank');if(!w){showToast('Autorisez les fenêtres surgissantes.');return}w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${printBaseStyles()}</style></head><body><button onclick="window.print()">Imprimer / Enregistrer en PDF</button><h1>Audit Bovin GDS 32-65 — ${title}</h1><div class="meta"><div class="box"><b>Exploitation</b><br>${mode.includes('blank')?'':escapeHtml(farmName(visit.farmId))}</div><div class="box"><b>Date</b><br>${mode.includes('blank')?'':escapeHtml(formatDate(visit.date))}</div><div class="box"><b>Technicien</b><br>${mode.includes('blank')?'':escapeHtml(visit.technician||'')}</div></div>${content}</body></html>`);w.document.close()}
function printAuditGuide(visit,filled){printAuditDocument(visit,filled?'audit-filled':'audit-blank')}



function reportLines(value){
  return String(value||'').split(/\n|•|;/).map(x=>x.trim()).filter(Boolean);
}
function reportList(value, empty='Aucun élément renseigné.'){
  const items=reportLines(value);
  return items.length?`<ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:`<p class="report-empty">${escapeHtml(empty)}</p>`;
}
function reportFarm(visit){return db.farms.find(f=>f.id===visit.farmId)||{};}
function reportMeta(visit){
  const farm=reportFarm(visit);
  return {farm:farm.name||'Exploitation non renseignée',farmer:farm.manager||farm.owner||'',date:formatDate(visit.date),technician:visit.technician||'',type:visit.type||'',location:farm.address||farm.city||''};
}
function reportStats(visit){
  const subjects=visit.subjects||[];
  const measured=subjects.filter(s=>Object.values(s.measurements?.analysis||{}).some(v=>v!==''&&v!==null&&v!==undefined)).length;
  const general=visit.analysisGeneral||{};
  return {subjects:subjects.length,measured,general:(general.tamis?.length||0)+(general.silos?.length||0)+(general.soils?.length||0)+(general.plants?.length||0)};
}

async function photoFileToDataUrl(file){
  const source=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=URL.createObjectURL(file);});
  const maxSide=1280,scale=Math.min(1,maxSide/Math.max(source.naturalWidth,source.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.naturalWidth*scale));canvas.height=Math.max(1,Math.round(source.naturalHeight*scale));
  const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);URL.revokeObjectURL(source.src);
  return canvas.toDataURL('image/jpeg',0.72);
}
function photoSubjectLabel(visit,subjectId){const s=(visit.subjects||[]).find(x=>x.id===subjectId);return s?(s.identifier||s.name||s.category||'Sujet'):'Photo générale';}
function photoCardHtml(visit,photo){return `<article class="photo-card"><button class="photo-open" data-open-photo="${photo.id}" aria-label="Ouvrir la photo"><img src="${photo.dataUrl}" alt="${escapeHtml(photo.comment||'Photo de visite')}"></button><div class="photo-card-body"><div class="photo-meta"><strong>${escapeHtml(photoSubjectLabel(visit,photo.subjectId))}</strong><span>${formatDateTime(photo.createdAt)}</span></div><textarea data-photo-comment="${photo.id}" rows="2" placeholder="Commentaire de la photo">${escapeHtml(photo.comment||'')}</textarea><div class="actions"><button class="btn small" data-annotate-photo="${photo.id}">✏️ Annoter</button><button class="btn small danger" data-delete-photo="${photo.id}">Supprimer</button></div></div></article>`;}


// V11.9 — Suivi longitudinal et comparaison de plusieurs visites
function farmVisitsChronological(farmId){
  return db.visits.filter(v=>v.farmId===farmId).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
}
function avgForVisit(visit,key,category=''){
  const values=(visit.subjects||[]).filter(s=>!category||s.category===category).map(s=>numericValue(s.measurements?.analysis?.[key])).filter(v=>v!==null);
  return values.length?{avg:values.reduce((a,b)=>a+b,0)/values.length,n:values.length,min:Math.min(...values),max:Math.max(...values)}:null;
}
function followupFmt(v,key){if(v===null||v===undefined)return '—';const p=['urineDensity','urineRedox','fecesRedox','colostrumDensity'].includes(key)?0:2;return Number(v).toLocaleString('fr-FR',{maximumFractionDigits:p});}
function followupTrend(first,last){
  if(first===null||last===null)return {icon:'—',label:'Non comparable',cls:'neutral'};
  const d=last-first, tolerance=Math.max(Math.abs(first)*0.03,0.02);
  if(Math.abs(d)<=tolerance)return {icon:'→',label:'Stable',cls:'stable'};
  return d>0?{icon:'↗',label:'En hausse',cls:'up'}:{icon:'↘',label:'En baisse',cls:'down'};
}
function sparklineSvg(points){
  const vals=points.filter(v=>v!==null);if(vals.length<2)return '<span class="muted">Données insuffisantes</span>';
  const min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,w=160,h=42,p=5;
  const coords=points.map((v,i)=>v===null?null:[p+i*(w-2*p)/Math.max(1,points.length-1),h-p-(v-min)*(h-2*p)/span]);
  const segments=[];let current=[];coords.forEach(pt=>{if(pt)current.push(pt);else if(current.length){segments.push(current);current=[]}});if(current.length)segments.push(current);
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" role="img" aria-label="Courbe d’évolution">${segments.map(seg=>`<polyline points="${seg.map(x=>x.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}${coords.filter(Boolean).map(pt=>`<circle cx="${pt[0]}" cy="${pt[1]}" r="2.6" fill="currentColor"/>`).join('')}</svg>`;
}
function normalizedTag(tag){return String(tag||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function individualFollowupRows(visits,key){
  const map=new Map();visits.forEach(v=>(v.subjects||[]).forEach(s=>{const tag=normalizedTag(s.tag);const val=numericValue(s.measurements?.analysis?.[key]);if(!tag||val===null)return;if(!map.has(tag))map.set(tag,{tag:s.tag||tag,values:new Array(visits.length).fill(null)});map.get(tag).values[visits.indexOf(v)]=val;}));
  return [...map.values()].filter(x=>x.values.filter(v=>v!==null).length>=2);
}

function visitReproductionSnapshot(visit){
  const farm=db.farms.find(f=>f.id===visit?.farmId);if(!visit||!farm)return {};
  const source=reproductionSourceForVisit(visit,farm),original=farm.herdRegistry;farm.herdRegistry=source.registry||[];
  const today=new Date().toISOString().slice(0,10),registry=farm.herdRegistry||[],cows=currentReproductionCows(farm),present=registry.filter(a=>a.sex==='F'&&isRegistryAnimalPresent(a,today));
  const cowIds=new Set(cows.map(r=>normalizeAnimalId(r.cow.id))),breedingFemales=present.filter(a=>monthsBetweenDates(a.birthDate,today)>24),heifers=breedingFemales.filter(a=>!cowIds.has(normalizeAnimalId(a.id)));
  const allIvvs=cows.flatMap(r=>r.intervals),firstIvvs=cows.map(r=>r.intervals[0]).filter(x=>x!=null),calves=cows.flatMap(r=>r.calves),dead=calves.filter(c=>c.exitCause==='M'&&c.exitDate&&daysBetweenDates(c.birthDate,c.exitDate)<183);
  const maleIds=new Set(registry.filter(a=>a.sex==='M').map(a=>normalizeAnimalId(a.id)));const knownFather=calves.filter(c=>c.fatherId);const probableIA=knownFather.filter(c=>!maleIds.has(normalizeAnimalId(c.fatherId))).length;
  const primiparous=cows.filter(r=>r.calves.length===1),yearAgo=new Date(today+'T12:00:00');yearAgo.setFullYear(yearAgo.getFullYear()-1);const yearAgoIso=yearAgo.toISOString().slice(0,10);
  const calvedLast12=new Set(calves.filter(c=>c.birthDate>=yearAgoIso&&c.birthDate<=today).map(c=>normalizeAnimalId(c.motherId))).size;
  const a=ensureAuditGlobal(visit),mortTotal=Object.values(a.mortality||{}).reduce((n,x)=>n+(Number(x?.count)||0),0),rr=renewalRate(a.renewal),rf=reformRate(a.renewal);
  farm.herdRegistry=original;
  return {ivvMean:allIvvs.length?Math.round(allIvvs.reduce((x,y)=>x+y,0)/allIvvs.length):null,ivv12:firstIvvs.length?Math.round(firstIvvs.reduce((x,y)=>x+y,0)/firstIvvs.length):null,ivvLe400:allIvvs.filter(x=>x<=400).length,ivv401450:allIvvs.filter(x=>x>400&&x<=450).length,ivv451500:allIvvs.filter(x=>x>450&&x<=500).length,ivvOver500:allIvvs.filter(x=>x>500).length,cows:cows.length,withoutCalving:heifers.length,calves:calves.length,deadCalves:dead.length,calfMortalityRate:calves.length?Math.round(dead.length/calves.length*1000)/10:null,probableIA:knownFather.length?probableIA:null,probableIARate:knownFather.length?Math.round(probableIA/knownFather.length*1000)/10:null,calvingRate:breedingFemales.length?Math.round(calvedLast12/breedingFemales.length*1000)/10:null,primiparous:primiparous.length,primiparousRate:cows.length?Math.round(primiparous.length/cows.length*1000)/10:null,renewalRate:rr,reformRate:rf,mortalityTotal:mortTotal};
}
function compareScalarRows(selected){
 const defs=[['Reproduction','Taux de vêlage (12 mois)','calvingRate','%'],['Reproduction','Primipares','primiparous',''],['Reproduction','Part de primipares','primiparousRate','%'],['Reproduction','IVV moyen','ivvMean','j'],['Reproduction','IVV1–IVV2 moyen','ivv12','j'],['Reproduction','IVV ≤ 400 j','ivvLe400',''],['Reproduction','IVV 401–450 j','ivv401450',''],['Reproduction','IVV 451–500 j','ivv451500',''],['Reproduction','IVV > 500 j','ivvOver500',''],['Reproduction','Femelles > 24 mois sans vêlage','withoutCalving',''],['Reproduction','Veaux probablement issus d’IA','probableIA',''],['Reproduction','Part probable IA','probableIARate','%'],['Reproduction','Mortalité veaux < 6 mois','calfMortalityRate','%'],['Troupeau','Taux de renouvellement','renewalRate','%'],['Troupeau','Taux de réforme','reformRate','%'],['Mortalité','Mortalité totale saisie','mortalityTotal','']];
 const snaps=selected.map(visitReproductionSnapshot);return defs.map(([group,label,key,unit])=>({group,label,values:snaps.map(x=>x[key]??null),unit}));
}
function visitTextSummary(visit,type){
 if(type==='feeding')return (visit.feeding?.rations||[]).map(r=>[r.category,r.nature||r.detail,r.quantity,r.unit].filter(Boolean).join(' ')).join(' · ');
 if(type==='building'){const r=buildingRecords(visit);return `${r.drinkers.length} abreuvoir(s) · ${r.electric.length} mesure(s) électrique(s) · ${r.litters.length} zone(s) litière`;}
 if(type==='actions'){const c=ensureVisitConclusion(visit);return (c.priorities||[]).filter(x=>x.text).map(x=>`${x.text}${x.decision?' ('+x.decision+')':''}`).join(' · ');}
 return '';
}
function renderFollowup(){
  const defaultFarm=activeVisit()?.farmId||db.farms[0]?.id||'';
  const farmId=localStorage.getItem('audit-bovin-followup-farm')||defaultFarm;
  const visits=farmVisitsChronological(farmId);
  let selectedIds=JSON.parse(localStorage.getItem('audit-bovin-followup-visits')||'[]').filter(id=>visits.some(v=>v.id===id));
  if(!selectedIds.length&&visits.length)selectedIds=visits.slice(-2).map(v=>v.id);
  const selected=visits.filter(v=>selectedIds.includes(v.id)).slice(-2);
  const category=localStorage.getItem('audit-bovin-followup-category')||'';
  const availableCats=[...new Set(visits.flatMap(v=>(v.subjects||[]).map(s=>s.category).filter(c=>c&&c!=='Non classé')))].sort();
  const measureRows=analysisParameters.map(param=>{const stats=selected.map(v=>avgForVisit(v,param.key,category));const vals=stats.map(x=>x?.avg??null);if(!vals.some(v=>v!==null))return'';const d=vals.length===2&&vals[0]!=null&&vals[1]!=null?Math.round((vals[1]-vals[0])*100)/100:null;return `<tr><td><strong>${escapeHtml(param.label)}</strong><br><small>${escapeHtml(param.group)}</small></td>${stats.map(x=>`<td>${x?`<strong>${followupFmt(x.avg,param.key)}</strong><br><small>n=${x.n} · ${followupFmt(x.min,param.key)}–${followupFmt(x.max,param.key)}</small>`:'—'}</td>`).join('')}<td>${d==null?'—':(d>0?'+':'')+d}</td></tr>`}).join('');
  const scalarRows=compareScalarRows(selected);
  const grouped=[...new Set(scalarRows.map(r=>r.group))].map(g=>`<section class="card"><h3>${escapeHtml(g)}</h3><div class="table-wrap"><table class="followup-table"><thead><tr><th>Indicateur</th>${selected.map(v=>`<th>${formatDate(v.date)}</th>`).join('')}<th>Écart</th></tr></thead><tbody>${scalarRows.filter(r=>r.group===g).map(r=>{const a=r.values[0],b=r.values[1],d=a!=null&&b!=null?Math.round((b-a)*10)/10:null;return `<tr><td><strong>${escapeHtml(r.label)}</strong></td>${r.values.map(v=>`<td>${v==null?'—':v+' '+r.unit}</td>`).join('')}<td><span class="trend-badge ${d==null?'stable':d>0?'up':d<0?'down':'stable'}">${d==null?'—':(d>0?'+':'')+d+' '+r.unit}</span></td></tr>`}).join('')}</tbody></table></div></section>`).join('');
  app.innerHTML=`<div class="section-title"><div><h2>Historique & évolution</h2><div class="muted">Comparer deux visites d’une même exploitation : reproduction, mortalité, mesures, alimentation, bâtiment et plans d’action.</div></div><span class="badge autosave">v14.6.15</span></div>
  <section class="card followup-filters"><div class="grid cols-2"><div class="field"><label>Exploitation</label><select id="followup-farm">${db.farms.map(f=>`<option value="${f.id}" ${f.id===farmId?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}</select></div><div class="field"><label>Catégorie pour les mesures</label><select id="followup-category"><option value="">Toutes les catégories</option>${availableCats.map(c=>`<option ${c===category?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select></div></div><div class="followup-visit-picker"><strong>Sélectionner exactement deux visites</strong>${visits.length?visits.map(v=>`<label><input type="checkbox" data-followup-visit value="${v.id}" ${selectedIds.includes(v.id)?'checked':''}><span>${formatDate(v.date)} · ${escapeHtml(v.type||'Visite')} · ${(v.subjects||[]).length} sujet(s)</span></label>`).join(''):'<div class="empty">Cette exploitation ne possède aucune visite.</div>'}</div></section>
  ${selected.length!==2?'<section class="card notice warning"><strong>Sélectionnez exactement deux visites.</strong><br><span class="muted">Décochez ou cochez les visites souhaitées.</span></section>':`${grouped}<section class="card"><div class="section-title"><h3>Mesures biologiques et terrain</h3><button class="btn secondary" id="print-followup">Imprimer / PDF</button></div><div class="table-wrap"><table class="followup-table"><thead><tr><th>Mesure</th>${selected.map(v=>`<th>${formatDate(v.date)}</th>`).join('')}<th>Écart</th></tr></thead><tbody>${measureRows||'<tr><td colspan="4">Aucune mesure comparable.</td></tr>'}</tbody></table></div></section><section class="grid cols-3 comparison-text-grid"><article class="card"><h3>🥣 Alimentation</h3>${selected.map(v=>`<h4>${formatDate(v.date)}</h4><p>${escapeHtml(visitTextSummary(v,'feeding')||'Aucune ration renseignée.')}</p>`).join('')}</article><article class="card"><h3>🏠 Bâtiment</h3>${selected.map(v=>`<h4>${formatDate(v.date)}</h4><p>${escapeHtml(visitTextSummary(v,'building'))}</p>`).join('')}</article><article class="card"><h3>📋 Plan d’action</h3>${selected.map(v=>`<h4>${formatDate(v.date)}</h4><p>${escapeHtml(visitTextSummary(v,'actions')||'Aucune priorité renseignée.')}</p>`).join('')}</article></section>`}`;
  document.getElementById('followup-farm')?.addEventListener('change',e=>{localStorage.setItem('audit-bovin-followup-farm',e.target.value);localStorage.removeItem('audit-bovin-followup-visits');renderFollowup()});
  document.getElementById('followup-category')?.addEventListener('change',e=>{localStorage.setItem('audit-bovin-followup-category',e.target.value);renderFollowup()});
  app.querySelectorAll('[data-followup-visit]').forEach(e=>e.onchange=()=>{let ids=[...app.querySelectorAll('[data-followup-visit]:checked')].map(x=>x.value);if(ids.length>2){e.checked=false;showToast('Deux visites maximum.');ids=[...app.querySelectorAll('[data-followup-visit]:checked')].map(x=>x.value);}localStorage.setItem('audit-bovin-followup-visits',JSON.stringify(ids));renderFollowup()});
  document.getElementById('print-followup')?.addEventListener('click',()=>window.print());
}

function renderPhotos(){
  const visit=activeVisit();if(!visit){renderNoActiveVisit('Photothèque');return;}visit.photos=Array.isArray(visit.photos)?visit.photos:[];
  const subjectOptions=(visit.subjects||[]).map(s=>`<option value="${s.id}">${escapeHtml(s.identifier||s.name||s.category||'Sujet')}</option>`).join('');
  app.innerHTML=`<div class="section-title"><div><h2>Photothèque de la visite</h2><div class="muted">Photo directe ou galerie, commentaire et annotation au doigt.</div></div><span class="badge autosave">v14.6.15</span></div>${activeVisitBanner(visit)}<section class="card photo-toolbar"><div class="field"><label>Associer les prochaines photos à</label><select id="photo-subject"><option value="">Visite générale</option>${subjectOptions}</select></div><div class="photo-add-actions"><button class="btn primary" id="take-photo">📷 Prendre une photo</button><button class="btn" id="choose-photo">🖼️ Choisir dans la galerie</button></div><input id="camera-photo-input" type="file" accept="image/*" capture="environment" hidden><input id="gallery-photo-input" type="file" accept="image/*" multiple hidden></section><section class="card notice"><strong>${visit.photos.length} photo(s)</strong><br><span class="muted">Les images sont automatiquement réduites pour limiter le poids de la sauvegarde. Pensez à exporter régulièrement la sauvegarde JSON.</span></section><section class="photo-grid">${visit.photos.length?visit.photos.map(p=>photoCardHtml(visit,p)).join(''):'<div class="card empty">Aucune photo pour cette visite.</div>'}</section>`;
  const addFiles=async files=>{for(const file of files){if(!file.type.startsWith('image/'))continue;try{const dataUrl=await photoFileToDataUrl(file);visit.photos.unshift({id:uid('photo'),dataUrl,originalDataUrl:dataUrl,comment:'',subjectId:document.getElementById('photo-subject')?.value||'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});saveDatabase(db);}catch(e){console.error(e);showToast('Une photo n’a pas pu être ajoutée.');}}renderPhotos();showToast('Photo(s) ajoutée(s).');};
  document.getElementById('take-photo').onclick=()=>document.getElementById('camera-photo-input').click();document.getElementById('choose-photo').onclick=()=>document.getElementById('gallery-photo-input').click();
  document.getElementById('camera-photo-input').onchange=e=>addFiles([...e.target.files]);document.getElementById('gallery-photo-input').onchange=e=>addFiles([...e.target.files]);
  app.querySelectorAll('[data-photo-comment]').forEach(el=>{const save=()=>{const photo=visit.photos.find(p=>p.id===el.dataset.photoComment);if(!photo)return;photo.comment=el.value;photo.updatedAt=new Date().toISOString();saveDatabase(db);};el.oninput=save;el.onblur=save;});
  app.querySelectorAll('[data-delete-photo]').forEach(b=>b.onclick=()=>{if(!confirm('Supprimer cette photo ?'))return;visit.photos=visit.photos.filter(p=>p.id!==b.dataset.deletePhoto);saveDatabase(db);renderPhotos();});
  app.querySelectorAll('[data-open-photo]').forEach(b=>b.onclick=()=>openPhotoViewer(visit.photos.find(p=>p.id===b.dataset.openPhoto)));
  app.querySelectorAll('[data-annotate-photo]').forEach(b=>b.onclick=()=>openPhotoAnnotator(visit,visit.photos.find(p=>p.id===b.dataset.annotatePhoto)));
}
function openPhotoViewer(photo){if(!photo)return;const overlay=document.createElement('div');overlay.className='photo-overlay';overlay.innerHTML=`<div class="photo-viewer"><button class="photo-modal-close" aria-label="Fermer">×</button><img src="${photo.dataUrl}" alt="Photo"><p>${escapeHtml(photo.comment||'')}</p></div>`;document.body.appendChild(overlay);overlay.onclick=e=>{if(e.target===overlay||e.target.closest('.photo-modal-close'))overlay.remove();};}
function openPhotoAnnotator(visit,photo){if(!photo)return;const overlay=document.createElement('div');overlay.className='photo-overlay';overlay.innerHTML=`<div class="photo-annotator"><div class="photo-modal-head"><strong>Annoter la photo</strong><button class="photo-modal-close">×</button></div><canvas id="photo-annotation-canvas"></canvas><div class="annotation-tools"><label>Couleur <input type="color" id="annotation-color" value="#e32636"></label><label>Épaisseur <input type="range" id="annotation-width" min="2" max="18" value="6"></label><button class="btn" id="annotation-undo">Annuler le trait</button><button class="btn" id="annotation-reset">Revenir à l’original</button><button class="btn primary" id="annotation-save">Enregistrer</button></div></div>`;document.body.appendChild(overlay);
  const canvas=overlay.querySelector('canvas'),ctx=canvas.getContext('2d'),img=new Image(),history=[];let drawing=false,last=null;
  const snapshot=()=>{history.push(canvas.toDataURL('image/jpeg',.8));if(history.length>15)history.shift();};
  img.onload=()=>{canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;ctx.drawImage(img,0,0);};img.src=photo.dataUrl;
  const pos=e=>{const r=canvas.getBoundingClientRect(),t=e.touches?.[0]||e;return{x:(t.clientX-r.left)*canvas.width/r.width,y:(t.clientY-r.top)*canvas.height/r.height};};
  const start=e=>{e.preventDefault();snapshot();drawing=true;last=pos(e);};const move=e=>{if(!drawing)return;e.preventDefault();const q=pos(e);ctx.strokeStyle=overlay.querySelector('#annotation-color').value;ctx.lineWidth=Number(overlay.querySelector('#annotation-width').value);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(q.x,q.y);ctx.stroke();last=q;};const end=()=>{drawing=false;last=null;};
  canvas.addEventListener('pointerdown',start);canvas.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:false});
  overlay.querySelector('.photo-modal-close').onclick=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
  overlay.querySelector('#annotation-undo').onclick=()=>{const src=history.pop();if(!src)return;const i=new Image();i.onload=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(i,0,0);};i.src=src;};
  overlay.querySelector('#annotation-reset').onclick=()=>{snapshot();const i=new Image();i.onload=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(i,0,0,canvas.width,canvas.height);};i.src=photo.originalDataUrl||photo.dataUrl;};
  overlay.querySelector('#annotation-save').onclick=()=>{photo.dataUrl=canvas.toDataURL('image/jpeg',.76);photo.updatedAt=new Date().toISOString();saveDatabase(db);overlay.remove();renderPhotos();showToast('Annotation enregistrée.');};
}
function reportPhotosHtml(visit){const photos=visit.photos||[];if(!photos.length)return '<p class="report-empty">Aucune photo enregistrée.</p>';return `<div class="report-photo-grid">${photos.map(p=>`<figure><img src="${p.dataUrl}" alt="Photo de visite"><figcaption><strong>${escapeHtml(photoSubjectLabel(visit,p.subjectId))}</strong>${p.comment?`<br>${escapeHtml(p.comment)}`:''}</figcaption></figure>`).join('')}</div>`;}

function reportHeader(visit,title,subtitle=''){
  const m=reportMeta(visit),st=reportStats(visit);
  return `<header class="report-cover"><div class="report-brand"><div class="report-logo">GDS<br>32-65</div><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></div><div class="report-cover-grid"><div><span>Exploitation</span><strong>${escapeHtml(m.farm)}</strong></div><div><span>Date</span><strong>${escapeHtml(m.date)}</strong></div><div><span>Technicien</span><strong>${escapeHtml(m.technician||'Non renseigné')}</strong></div><div><span>Type de visite</span><strong>${escapeHtml(m.type||'Non renseigné')}</strong></div><div><span>Sujets observés</span><strong>${st.subjects}</strong></div><div><span>Sujets avec mesures</span><strong>${st.measured}</strong></div></div></header>`;
}
function reportConclusionHtml(visit){
  const c=ensureVisitConclusion(visit);
  const priorities=(c.priorities||[]).filter(x=>x.text);
  return `<section class="report-section"><h2>Résumé de la visite</h2><div class="report-summary-grid"><article class="report-box positive"><h3>✅ Points forts</h3>${reportList(c.strengths)}</article><article class="report-box warning"><h3>⚠️ Points à améliorer</h3>${reportList([c.high,c.medium,c.low].filter(Boolean).join('\n'))}</article></div><article class="report-box"><h3>Conclusion générale</h3><p>${escapeHtml(c.general||'').replace(/\n/g,'<br>')}</p></article></section><section class="report-section"><h2>Actions principales</h2><table><thead><tr><th>Action</th><th>Décision</th><th>Commentaire</th></tr></thead><tbody>${priorities.length?priorities.map((a,i)=>`<tr><td><strong>${i+1}. ${escapeHtml(a.text)}</strong>${a.source?`<br><small>${escapeHtml(a.source)}</small>`:''}</td><td>${escapeHtml(a.decision||'À étudier')}</td><td>${escapeHtml(a.comment||'')}</td></tr>`).join(''):'<tr><td colspan="3">Aucune action principale renseignée.</td></tr>'}</tbody></table><h3>À vérifier lors de la prochaine visite</h3>${reportList(c.next)}</section>`;
}
function reportAnalysisTable(visit){
  const groups=categoryAnalysis(visit);
  if(!groups.length)return '<p class="report-empty">Aucune donnée d’analyse exploitable.</p>';
  return groups.map(g=>`<article class="report-subsection"><h3>${escapeHtml(g.category)} <small>(${g.subjects.length} sujet(s))</small></h3><table><thead><tr><th>Paramètre</th><th>n</th><th>Min</th><th>Moy.</th><th>Max</th><th>Hors réf.</th></tr></thead><tbody>${g.parameterResults.map(r=>`<tr><td>${escapeHtml(r.parameter.label)}</td><td>${r.measured.length}</td><td>${r.minimum.toLocaleString('fr-FR',{maximumFractionDigits:2})}</td><td>${r.average.toLocaleString('fr-FR',{maximumFractionDigits:2})}</td><td>${r.maximum.toLocaleString('fr-FR',{maximumFractionDigits:2})}</td><td>${r.outOfRange}/${r.measured.length}</td></tr>`).join('')}</tbody></table>${visit.analysisConclusions?.[g.category]?`<p><strong>Conclusion du technicien :</strong> ${escapeHtml(visit.analysisConclusions[g.category])}</p>`:''}</article>`).join('');
}
function reportReasoningHtml(visit){
  const groups=categoryAnalysis(visit), cards=[];
  groups.forEach(g=>buildKnowledgePistes(visit,g).forEach(h=>{const state=reasoningState(visit,`${g.category}:${h.id}`);if(state.status!=='dismissed')cards.push({...h,category:g.category,state});}));
  if(!cards.length)return '<p class="report-empty">Aucune piste de raisonnement retenue.</p>';
  return cards.map(h=>`<article class="report-reason"><h3>${escapeHtml(h.title)} <small>— ${escapeHtml(h.category)}</small></h3><p><strong>Confiance :</strong> ${escapeHtml(h.confidence.label)} · ${h.sourceCount} source(s)</p><p>${escapeHtml(h.summary)}</p>${h.mechanism?`<p><strong>Ce que cette piste peut traduire :</strong> ${escapeHtml(h.mechanism)}</p>`:''}<div class="report-columns"><div><h4>Éléments en faveur</h4>${reportList((h.evidence||[]).join('\n'))}</div><div><h4>Prudence / contradictions</h4>${reportList((h.nuance||[]).join('\n'))}</div><div><h4>Facteurs à examiner</h4>${reportList((h.causes||[]).join('\n'))}</div><div><h4>Données manquantes</h4>${reportList((h.missing||[]).join('\n'))}</div></div>${h.state.note?`<p><strong>Commentaire du technicien :</strong> ${escapeHtml(h.state.note)}</p>`:''}</article>`).join('');
}
function reportFeedingHtml(visit){
  const rows=visit.feeding?.rations||[];
  if(!rows.length)return '<p class="report-empty">Aucune ration renseignée.</p>';
  return `<table><thead><tr><th>Catégorie</th><th>Type</th><th>Nature</th><th>Quantité</th><th>Distribution</th><th>Commentaire</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.category||'')}</td><td>${escapeHtml(r.type||'')}</td><td>${escapeHtml(r.nature||r.detail||'')}</td><td>${escapeHtml([r.quantity,r.unit].filter(Boolean).join(' '))}</td><td>${escapeHtml(r.distribution||'')}</td><td>${escapeHtml(r.comment||'')}</td></tr>`).join('')}</tbody></table>`;
}
function reportBuildingHtml(visit){
  const rec=buildingRecords(visit);
  return `<div class="report-kpis"><div><span>Abreuvoirs</span><strong>${rec.drinkers.length}</strong></div><div><span>Mesures électriques</span><strong>${rec.electric.length}</strong></div><div><span>Zones de litière</span><strong>${rec.litters.length}</strong></div></div>${rec.drinkers.length?`<h3>Abreuvoirs</h3><table><thead><tr><th>Nom</th><th>Type</th><th>Matériau</th><th>Débit</th><th>pH</th><th>Redox</th><th>Commentaire</th></tr></thead><tbody>${rec.drinkers.map(d=>`<tr><td>${escapeHtml(d.name||'')}</td><td>${escapeHtml(d.type||'')}</td><td>${escapeHtml(d.material||'')}</td><td>${escapeHtml(d.flow||'')}</td><td>${escapeHtml(d.ph||'')}</td><td>${escapeHtml(d.redox||'')}</td><td>${escapeHtml(d.comment||'')}</td></tr>`).join('')}</tbody></table>`:''}`;
}
function reportAuditHtml(visit){
  const a=ensureAuditGlobal(visit);
  return auditGlobalSections.map(s=>{const summary=a.chapterSummaries?.[s.id]||{};const answered=s.questions.filter(q=>{const x=a.answers[q]||{};return x.answer||(x.values||[]).length||x.comment;});return `<article class="report-subsection"><h3>${s.icon} ${escapeHtml(s.title)}</h3><p>${answered.length}/${s.questions.length} éléments renseignés.</p>${summary.strengths?`<p><strong>Points forts :</strong> ${escapeHtml(summary.strengths)}</p>`:''}${summary.watch?`<p><strong>Points de vigilance :</strong> ${escapeHtml(summary.watch)}</p>`:''}${summary.comments?`<p><strong>Commentaires :</strong> ${escapeHtml(summary.comments)}</p>`:''}</article>`}).join('');
}
function reportReproductionHtml(visit,includeProblemCows=false){
  const farm=db.farms.find(f=>f.id===visit.farmId),source=reproductionSourceForVisit(visit,farm),registry=source.registry||[];
  if(!registry.length)return '<p class="report-empty">Aucun registre Reproduction lié à cette visite.</p>';
  const reproFarm={...farm,herdRegistry:registry},full=reproductionRegistryPeriod(registry),periodMin=source.meta?.period?.from||full.from||'',periodMax=source.meta?.period?.to||full.to||new Date().toISOString().slice(0,10),periodKey=`audit-bovin-repro-period-${visit.id||visit.farmId||'default'}`;
  let saved={};try{saved=JSON.parse(localStorage.getItem(periodKey)||'{}')||{}}catch(_){saved={};}
  const periodStart=saved.start||reproductionDefaultYearStart(periodMin,periodMax),periodEnd=saved.end||periodMax,analysisDate=periodEnd||new Date().toISOString().slice(0,10);
  const presentFemales=registry.filter(a=>a.sex==='F'&&isRegistryAnimalPresent(a,analysisDate)),cows=currentReproductionCows(reproFarm,analysisDate),breeding24=presentFemales.filter(a=>monthsBetweenDates(a.birthDate,analysisDate)>24),breeding36=presentFemales.filter(a=>monthsBetweenDates(a.birthDate,analysisDate)>36);
  const intervalEvents=cows.flatMap(r=>r.intervals.map((v,i)=>({v,date:r.calvingDates[i+1]||''}))).filter(e=>e.date&&(!periodStart||e.date>=periodStart)&&(!periodEnd||e.date<=periodEnd)),ivvs=intervalEvents.map(e=>e.v),calves=cows.flatMap(r=>r.calves).filter(c=>c.birthDate&&(!periodStart||c.birthDate>=periodStart)&&(!periodEnd||c.birthDate<=periodEnd));
  const mothers=new Set(calves.map(c=>normalizeAnimalId(c.motherId))),ids24=new Set(breeding24.map(a=>normalizeAnimalId(a.id))),ids36=new Set(breeding36.map(a=>normalizeAnimalId(a.id))),calved24=[...mothers].filter(id=>ids24.has(id)).length,calved36=[...mothers].filter(id=>ids36.has(id)).length;
  const rate24=breeding24.length?Math.round(calved24/breeding24.length*1000)/10:null,rate36=breeding36.length?Math.round(calved36/breeding36.length*1000)/10:null,mean=ivvs.length?Math.round(ivvs.reduce((a,b)=>a+b,0)/ivvs.length):null,min=ivvs.length?Math.min(...ivvs):null,max=ivvs.length?Math.max(...ivvs):null;
  const dead=calves.filter(c=>c.exitCause==='M'&&c.exitDate&&daysBetweenDates(c.birthDate,c.exitDate)<183),firstAges=cows.map(r=>r.firstCalvingAgeMonths).filter(v=>v!=null),firstMean=firstAges.length?Math.round(firstAges.reduce((a,b)=>a+b,0)/firstAges.length*10)/10:null;
  const problemCows=cows.filter(r=>r.daysSinceLast>400||r.meanIVV>450||r.deadBefore6.length>=2||r.firstCalvingAgeMonths>36||reproductionScore(r)<60);
  let html=`<p><strong>Période analysée :</strong> ${periodStart?formatDate(periodStart):'—'} → ${periodEnd?formatDate(periodEnd):'—'}${source.meta?.fileName?` · Source : ${escapeHtml(source.meta.fileName)}`:''}</p><div class="report-kpis"><div><span>Taux vêlage &gt;24 mois</span><strong>${rate24??'—'}%</strong></div><div><span>Taux vêlage &gt;36 mois</span><strong>${rate36??'—'}%</strong></div><div><span>IVV moyen</span><strong>${mean??'—'} j</strong></div><div><span>IVV mini</span><strong>${min??'—'} j</strong></div><div><span>IVV maxi</span><strong>${max??'—'} j</strong></div><div><span>Âge moyen 1er vêlage</span><strong>${firstMean??'—'} mois</strong></div><div><span>Mortalité veaux &lt;6 mois</span><strong>${calves.length?Math.round(dead.length/calves.length*1000)/10:'—'}%</strong></div><div><span>Vaches à surveiller</span><strong>${problemCows.length}</strong></div></div>`;
  if(includeProblemCows)html+=problemCows.length?`<h3>Détail des vaches à problème / à surveiller</h3><table><thead><tr><th>Vache</th><th>Nom</th><th>Dernier vêlage</th><th>IVV moyen</th><th>IVV min/max</th><th>Veaux morts &lt;6 mois</th><th>Score</th></tr></thead><tbody>${problemCows.map(r=>`<tr><td>${escapeHtml(r.cow.workNumber||r.cow.id)}<br><small>${escapeHtml(r.cow.id)}</small></td><td>${escapeHtml(r.cow.name||'—')}</td><td>${r.lastCalvingDate?formatDate(r.lastCalvingDate):'—'}${r.daysSinceLast!=null?`<br><small>${r.daysSinceLast} j</small>`:''}</td><td>${r.meanIVV??'—'}</td><td>${r.minIVV??'—'} / ${r.maxIVV??'—'}</td><td>${r.deadBefore6.length}</td><td>${reproductionScore(r)}/100</td></tr>`).join('')}</tbody></table>`:'<p>Aucune vache ne répond aux critères d’alerte retenus.</p>';
  return html;
}
function reportDocumentHtml(visit,type,options={}){
  const titles={farmer:'Rapport Éleveur',technical:'Rapport Technique',expert:'Rapport Expert'};
  let body=reportHeader(visit,titles[type]||'Rapport de visite',type==='farmer'?'Synthèse claire et plan d’action':'Audit Bovin GDS 32-65');
  body+=reportConclusionHtml(visit);
  if(type!=='farmer'){
    if(options.analysis!==false)body+=`<section class="report-section page-break"><h2>Analyses et synthèses détaillées</h2>${reportAnalysisTable(visit)}</section>`;
    if(options.reproduction!==false)body+=`<section class="report-section"><h2>Reproduction</h2>${reportReproductionHtml(visit,options.reproductionDetails===true)}</section>`;
    if(options.feeding!==false)body+=`<section class="report-section"><h2>Alimentation</h2>${reportFeedingHtml(visit)}</section>`;
    if(options.building!==false)body+=`<section class="report-section"><h2>Bâtiment, eau et environnement</h2>${reportBuildingHtml(visit)}</section>`;
    if(options.audit!==false)body+=`<section class="report-section"><h2>Audit de l’exploitation</h2>${reportAuditHtml(visit)}</section>`;
    if(options.herddata!==false)body+=`<section class="report-section page-break"><h2>Données technico-économiques</h2>${reportHerdDataHtml(visit)}</section>`;
    if(options.photos!==false)body+=`<section class="report-section page-break"><h2>Photothèque de la visite</h2>${reportPhotosHtml(visit)}</section>`;
  }
  if(type==='expert')body+=`<section class="report-section page-break"><h2>Raisonnement 5mVet détaillé</h2>${reportReasoningHtml(visit)}</section>`;
  body+=`<footer class="report-footer"><p>Ce rapport constitue une aide au raisonnement fondée sur les données recueillies lors de la visite. Les pistes proposées restent soumises à la validation du technicien et, lorsque nécessaire, à l’appréciation du vétérinaire.</p><div class="signature-grid"><div><strong>Éleveur</strong><br><br>Signature :</div><div><strong>Technicien</strong><br><br>Signature :</div></div></footer>`;
  return body;
}
function fullReportStyles(){return `${printBaseStyles()} body{max-width:980px;margin:0 auto;padding:20px;background:#fff;color:#16231c}.report-cover{padding:24px;border:2px solid #b53670;border-radius:16px;margin-bottom:24px}.report-brand{display:flex;gap:18px;align-items:center}.report-logo{width:72px;height:72px;border-radius:18px;background:#b53670;color:white;display:grid;place-items:center;text-align:center;font-weight:800}.report-cover h1{margin:0}.report-cover-grid,.report-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:20px}.report-cover-grid>div,.report-kpis>div{padding:10px;background:#fff4f8;border-radius:8px}.report-cover-grid span,.report-kpis span{display:block;color:#66756c;font-size:9pt}.report-cover-grid strong,.report-kpis strong{display:block;margin-top:3px}.report-section{margin:22px 0}.report-summary-grid,.report-columns,.herd-chart-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.report-box,.report-reason,.report-subsection,.herd-chart-card{border:1px solid #cfdad3;border-radius:10px;padding:12px;margin:10px 0}.report-box.positive{border-left:6px solid #b53670}.report-box.warning{border-left:6px solid #e0a326}.report-empty{color:#6b746e;font-style:italic}.report-footer{margin-top:30px;border-top:2px solid #d5dfd8;padding-top:16px}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:25px}.signature-grid>div{min-height:90px;border:1px solid #aab5ad;padding:12px}.report-photo-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.report-photo-grid figure{margin:0;break-inside:avoid;border:1px solid #cfdad3;border-radius:10px;padding:8px}.report-photo-grid img{width:100%;max-height:360px;object-fit:contain}.report-photo-grid figcaption{padding:7px 2px;font-size:10pt}.herd-chart-grid{grid-template-columns:1fr}.herd-chart-card{break-inside:avoid;background:#fffafd}.herd-svg-chart{width:100%;height:auto;display:block}.herd-chart-legend{display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 10px}.herd-chart-legend span{display:inline-flex;align-items:center;gap:6px;font-size:10pt;color:#425047}.herd-chart-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}.page-break{page-break-before:always}@media(max-width:700px){.report-cover-grid,.report-kpis,.report-summary-grid,.report-columns{grid-template-columns:1fr}}`}
function reportStandaloneHtml(visit,type,options={}){return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rapport ${type}</title><style>${fullReportStyles()}</style></head><body><div class="no-print" style="position:sticky;top:0;background:white;padding:8px;border-bottom:1px solid #ddd;z-index:5"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>${reportDocumentHtml(visit,type,options)}</body></html>`;}
function downloadReportHtml(visit,type,options={}){const blob=new Blob(['\ufeff',reportStandaloneHtml(visit,type,options)],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`rapport-${type}-${slugify(farmName(visit.farmId))}-${visit.date||'visite'}.html`;a.target='_blank';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function openReportWindow(visit,type,options={}){
  const w=window.open('','_blank');if(!w){downloadReportHtml(visit,type,options);showToast('Le rapport a été téléchargé. Ouvrez-le puis utilisez Imprimer / PDF.');return null;}
  w.document.open();w.document.write(reportStandaloneHtml(visit,type,options));w.document.close();try{w.focus();}catch(e){}return w;
}
function downloadWordReport(visit,type,options={}){
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>${fullReportStyles()}</style></head><body>${reportDocumentHtml(visit,type,options)}</body></html>`;
  const blob=new Blob(['\ufeff',html],{type:'application/msword'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`rapport-${type}-${slugify(farmName(visit.farmId))}-${visit.date||'visite'}.doc`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  visit.generatedReports=Array.isArray(visit.generatedReports)?visit.generatedReports:[];visit.generatedReports.unshift({id:uid('report'),type,format:'Word',createdAt:new Date().toISOString()});saveDatabase(db);
}

function partnerExcelEscapeXml(value=''){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function partnerExcelNumber(value){if(value===null||value===undefined||value==='')return null;const n=Number(String(value).replace(',','.').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:null;}
function partnerAuditAnswer(visit,label){const item=ensureAuditGlobal(visit).answers?.[label]||{};return item.answer||((item.values||[]).join(', '))||'';}
function partnerAverageMeasure(visit,key){const vals=(visit.subjects||[]).map(s=>partnerExcelNumber(s.measurements?.analysis?.[key])).filter(v=>v!==null);return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*100)/100:null;}
function partnerPhaseColumn(visit,forced='auto'){
  if(forced&&forced!=='auto')return forced==='initial'?'C':forced==='final'?'E':'D';
  const visits=db.visits.filter(v=>v.farmId===visit.farmId).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const idx=visits.findIndex(v=>v.id===visit.id);if(idx<=0)return 'C';if(idx===visits.length-1&&/final/i.test(visit.type||''))return 'E';return 'D';
}
function partnerVisitSummary(visit){
  const c=ensureVisitConclusion(visit),a=ensureAuditGlobal(visit);
  return {
    expectations:[visit.objective,(a.organization.objectives||[]).join(', ')].filter(Boolean).join('\n'),
    problems:[c.high,c.medium,c.low,a.chapterSummaries?.sanitaire?.watch].filter(Boolean).join('\n'),
    advice:(c.priorities||[]).filter(x=>x.text).map((x,i)=>`${i+1}. ${x.text}${x.decision?` — ${x.decision}`:''}`).join('\n'),
    objectives:[c.next,c.general].filter(Boolean).join('\n')
  };
}
async function partnerWorkbookSetCell(zip,path,ref,value,cache){
  if(value===null||value===undefined||value==='')return;
  let entry=cache[path];if(!entry){const raw=await zip.file(path).async('string');entry=cache[path]={doc:new DOMParser().parseFromString(raw,'application/xml')};}
  const doc=entry.doc,ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';let cell=[...doc.getElementsByTagNameNS(ns,'c')].find(c=>c.getAttribute('r')===ref);if(!cell)return;
  [...cell.children].forEach(ch=>{if(['v','is','f'].includes(ch.localName))cell.removeChild(ch);});
  const numeric=typeof value==='number'&&Number.isFinite(value);if(numeric){cell.removeAttribute('t');const v=doc.createElementNS(ns,'v');v.textContent=String(value);cell.appendChild(v);}else{cell.setAttribute('t','inlineStr');const is=doc.createElementNS(ns,'is'),t=doc.createElementNS(ns,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=String(value);is.appendChild(t);cell.appendChild(is);}
}
async function exportPartnerWorkbook(visit,phase='auto'){
  if(typeof JSZip==='undefined'){showToast('Module Excel indisponible.');return;}
  const farm=db.farms.find(f=>f.id===visit.farmId);if(!farm)return showToast('Exploitation introuvable.');
  let response=await fetch('./modele-partenaires-passage-bv.xlsx?v=14.4.2',{cache:'no-store'});if(!response.ok)response=await fetch('./modele-partenaires-passage-bv.xlsx',{cache:'reload'});if(!response.ok)throw new Error('Modèle partenaire introuvable');
  const zip=await JSZip.loadAsync(await response.arrayBuffer()),cache={};const requiredSheets=[1,2,4,5,6].map(n=>`xl/worksheets/sheet${n}.xml`);const missingSheets=requiredSheets.filter(path=>!zip.file(path));if(missingSheets.length)throw new Error(`Modèle partenaire incomplet : ${missingSheets.join(', ')}`);const a=ensureAuditGlobal(visit),item=linkedHerdImportForVisit(visit),col=partnerPhaseColumn(visit,phase),summary=partnerVisitSummary(visit),st=item?.current?.structure||{},mv=item?.current?.movements||{},mort=item?.years?.N?.mortality||{},rep=item?.years?.N?.reproduction||{};
  const writes=[];const set=(sheet,cell,value)=>writes.push(()=>partnerWorkbookSetCell(zip,`xl/worksheets/sheet${sheet}.xml`,cell,value,cache));
  // Données exploitation
  set(1,'B2',farm.farmer||farm.name);set(1,'B4',farm.name);set(1,'B5',[farm.commune,farm.farmNumber?`N° EDE ${farm.farmNumber}`:''].filter(Boolean).join(' — '));set(1,'B16','Bovin viande');set(1,'B17',partnerExcelNumber(a.renewal.cowsTotal)||st.femalesOver36);set(1,'B18',st.total);set(1,'B28',partnerExcelNumber(a.renewal.replacementHeifers));set(1,'B31',partnerExcelNumber(a.renewal.bulls));set(1,'B32',partnerAuditAnswer(visit,'Période de mise à la reproduction'));
  const repro=partnerAuditAnswer(visit,'Mode de mise à la reproduction').toLowerCase();if(repro){set(1,'C34',repro.includes('insémin')||repro.includes('ia')?'Oui':'');set(1,'E34',repro.includes('monte')?'Oui':'');set(1,'G34',repro.includes('mixte')?'Oui':'');}
  set(1,'B45',visit.previousVisitReview?.summary||'');set(1,'B54',partnerAuditAnswer(visit,'Principaux problèmes sanitaires rencontrés sur les 12 derniers mois'));set(1,'B55',a.notes||'');set(1,'B67',summary.expectations);
  // Bilan sanitaire : colonne selon phase
  const cows=partnerExcelNumber(a.renewal.cowsTotal)||st.femalesOver36;const renewal=renewalRate(a.renewal);const births=partnerExcelNumber(mv.births)||partnerExcelNumber(item?.years?.N?.births);const calfDeaths=['h0_48','d2_7','d8_30','m1_6','m6_12'].reduce((s,k)=>s+(partnerExcelNumber(mort[k])||0),0);const adultDeaths=partnerExcelNumber(mort.over24)||0;
  set(2,`${col}3`,cows);set(2,`${col}4`,renewal);set(2,`${col}7`,partnerExcelNumber(rep.ivv)||partnerExcelNumber(partnerAuditAnswer(visit,'Intervalle vêlage-vêlage')));set(2,`${col}10`,partnerExcelNumber(rep.firstCalvingAge)||partnerExcelNumber(partnerAuditAnswer(visit,'Âge moyen au premier vêlage')));set(2,`${col}21`,partnerAverageMeasure(visit,'colostrumBrix'));set(2,`${col}22`,births?Math.round(calfDeaths/births*1000)/10:null);set(2,`${col}23`,cows?Math.round(adultDeaths/cows*1000)/10:null);set(2,`${col}24`,partnerExcelNumber(rep.abortions));
  const mortalityPairs=[['0–2 jours',mort.h0_48],['2 jours–1 mois',(partnerExcelNumber(mort.d2_7)||0)+(partnerExcelNumber(mort.d8_30)||0)],['1–6 mois',mort.m1_6],['6–12 mois',mort.m6_12],['12–24 mois',mort.m12_24],['> 24 mois',mort.over24]].map(([k,v])=>[k,partnerExcelNumber(v)||0]);const maxMort=mortalityPairs.sort((x,y)=>y[1]-x[1])[0];set(2,'G22',maxMort&&maxMort[1]?`${maxMort[0]} : ${maxMort[1]} mortalité(s)`:null);set(2,'G24',rep.abortions?`${rep.abortions} avortement(s) importé(s) — cause à préciser`:null);
  set(2,`${col}31`,partnerAuditAnswer(visit,'Gestion du parasitisme et recours aux coprologies'));set(2,`${col}33`,partnerAuditAnswer(visit,'Gestion du parasitisme et recours aux coprologies'));set(2,`${col}37`,partnerExcelNumber(partnerAuditAnswer(visit,'Consommation d’eau')));
  // Calendrier : audit initial + suivis + audit final
  const visits=db.visits.filter(v=>v.farmId===visit.farmId).slice().sort((x,y)=>(x.date||'').localeCompare(y.date||''));const initial=visits[0];if(initial){set(4,'B2',formatDate(initial.date));set(4,'B4',initial.technician||'');}
  const followRows=[10,19,28,37,46,55];visits.slice(1,7).forEach((v,i)=>{const row=followRows[i];if(!row)return;const s=partnerVisitSummary(v);set(4,`B${row}`,formatDate(v.date));set(4,`B${row+2}`,v.type||'');set(4,`B${row+3}`,v.technician||'');set(4,`B${row+5}`,s.objectives||s.advice);});
  const final=visits.find(v=>/final/i.test(v.type||''));if(final){const s=partnerVisitSummary(final);set(4,'H10',formatDate(final.date));set(4,'H12',final.technician||'');set(4,'H15',s.objectives);set(4,'H16',s.advice);}
  // Conseil ASG
  if(initial){const s=partnerVisitSummary(initial);set(5,'A3',s.expectations);set(5,'A13',s.problems);set(5,'A23',s.advice);set(5,'A36',s.objectives);}
  const followCols=['C','E','G','J','L','N'];visits.slice(1,7).forEach((v,i)=>{const c=followCols[i];if(!c)return;const s=partnerVisitSummary(v),review=v.previousVisitReview;const done=(review?.items||[]).map(x=>`${x.status||'À vérifier'} — ${x.text}${x.comment?` : ${x.comment}`:''}`).join('\n');set(5,`${c}3`,done||s.expectations);set(5,`${c}13`,s.problems);set(5,`${c}26`,s.advice);});if(final){const s=partnerVisitSummary(final);set(5,'C42',s.objectives);set(5,'C54',s.advice);}
  // Suivi temps : dates disponibles
  if(initial)set(6,'D4',formatDate(initial.date));if(visits.length>1)set(6,'D10',visits.slice(1,7).map(v=>formatDate(v.date)).join(' ; '));if(final)set(6,'D15',formatDate(final.date));
  for(const write of writes)await write();for(const [path,entry] of Object.entries(cache))zip.file(path,new XMLSerializer().serializeToString(entry.doc));
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`PASSAGE-${slugify(farm.name)}-${visit.date||'visite'}.xlsx`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);visit.generatedReports=Array.isArray(visit.generatedReports)?visit.generatedReports:[];visit.generatedReports.unshift({id:uid('report'),type:'Fichier partenaire PASSAGE',format:'Excel',createdAt:new Date().toISOString()});saveDatabase(db);showToast('Fichier partenaire Excel généré. Vérifiez les champs laissés vides avant transmission.');
}
function reportOptionsFromUi(){return {analysis:document.getElementById('report-opt-analysis')?.checked!==false,reproduction:document.getElementById('report-opt-reproduction')?.checked!==false,reproductionDetails:document.getElementById('report-opt-reproduction-details')?.checked===true,feeding:document.getElementById('report-opt-feeding')?.checked!==false,building:document.getElementById('report-opt-building')?.checked!==false,audit:document.getElementById('report-opt-audit')?.checked!==false,herddata:document.getElementById('report-opt-herddata')?.checked!==false,photos:document.getElementById('report-opt-photos')?.checked!==false};}
function renderReports(){
  const visit=activeVisit();if(!visit){renderNoActiveVisit('Restitution');return;}
  visit.generatedReports=Array.isArray(visit.generatedReports)?visit.generatedReports:[];
  app.innerHTML=`<div class="section-title"><div><h2>Restitution</h2><div class="muted">Trois niveaux de restitution à partir de la visite active.</div></div><span class="badge autosave">v14.6.15</span></div>${activeVisitBanner(visit)}<section class="report-choice-grid"><article class="card report-choice"><div class="report-choice-icon">👨‍🌾</div><h3>Rapport Éleveur</h3><p>Résumé, points forts, points à améliorer et actions principales.</p><div class="actions"><button class="btn" data-report-pdf="farmer">PDF / Imprimer</button><button class="btn secondary" data-report-word="farmer">Word modifiable</button></div></article><article class="card report-choice"><div class="report-choice-icon">👨‍⚕️</div><h3>Rapport Technique</h3><p>Conclusion, analyses, alimentation, bâtiment et audit détaillé.</p><div class="actions"><button class="btn" data-report-pdf="technical">PDF / Imprimer</button><button class="btn secondary" data-report-word="technical">Word modifiable</button></div></article><article class="card report-choice"><div class="report-choice-icon">🎓</div><h3>Rapport Expert</h3><p>Rapport technique enrichi du raisonnement 5mVet transparent.</p><div class="actions"><button class="btn" data-report-pdf="expert">PDF / Imprimer</button><button class="btn secondary" data-report-word="expert">Word modifiable</button></div></article></section><section class="card"><h3>Options des rapports Technique et Expert</h3><div class="report-options"><label><input type="checkbox" id="report-opt-analysis" checked> Analyses et synthèses</label><label><input type="checkbox" id="report-opt-reproduction" checked> Données Reproduction</label><label><input type="checkbox" id="report-opt-reproduction-details"> Détail des vaches à problème</label><label><input type="checkbox" id="report-opt-feeding" checked> Alimentation</label><label><input type="checkbox" id="report-opt-building" checked> Bâtiment et eau</label><label><input type="checkbox" id="report-opt-audit" checked> Audit global</label><label><input type="checkbox" id="report-opt-herddata" checked> Données élevage importées</label><label><input type="checkbox" id="report-opt-photos" checked> Photos de la visite</label></div></section><section class="card partner-export-card"><div class="section-title"><div><h3>Fichier partenaire PASSAGE</h3><div class="muted">Génère une copie du modèle Excel en complétant automatiquement les informations disponibles.</div></div></div><div class="row"><div class="field"><label>Colonne du bilan sanitaire</label><select id="partner-export-phase"><option value="auto">Détection automatique</option><option value="initial">Audit initial</option><option value="intermediate">Intermédiaire</option><option value="final">Audit final</option></select></div><div class="field partner-export-action"><label>&nbsp;</label><button class="btn primary" id="export-partner-excel">Exporter le fichier partenaire Excel</button></div></div><p class="muted">Les onglets Données exploitation, Bilan sanitaire, Calendrier des travaux, Conseil ASG et Suivi du temps sont complétés sans modifier le modèle d’origine. Les données absentes restent vides.</p></section><section class="card"><div class="section-title"><div><h3>Plan d’action sur une page</h3><div class="muted">Export court destiné au suivi avec l’éleveur.</div></div><button class="btn" id="print-action-report">Imprimer / PDF</button></div></section><section class="card"><h3>Historique des exports</h3>${visit.generatedReports.length?`<div class="report-history">${visit.generatedReports.slice(0,12).map(r=>`<div><strong>${escapeHtml(r.type)}</strong><span>${escapeHtml(r.format)} · ${formatDateTime(r.createdAt)}</span></div>`).join('')}</div>`:'<div class="empty">Aucun export enregistré pour cette visite.</div>'}</section>`;
  app.querySelectorAll('[data-report-pdf]').forEach(b=>b.onclick=()=>{const type=b.dataset.reportPdf;openReportWindow(visit,type,reportOptionsFromUi());visit.generatedReports.unshift({id:uid('report'),type,format:'PDF / impression',createdAt:new Date().toISOString()});saveDatabase(db);});
  app.querySelectorAll('[data-report-word]').forEach(b=>b.onclick=()=>downloadWordReport(visit,b.dataset.reportWord,reportOptionsFromUi()));
  document.getElementById('export-partner-excel')?.addEventListener('click',async()=>{const btn=document.getElementById('export-partner-excel');btn.disabled=true;const old=btn.textContent;btn.textContent='Génération…';try{await exportPartnerWorkbook(visit,document.getElementById('partner-export-phase')?.value||'auto');}catch(err){console.error(err);alert('Impossible de générer le fichier partenaire. Vérifiez que tous les fichiers de la version ont été déployés.');}finally{btn.disabled=false;btn.textContent=old;}});
  document.getElementById('print-action-report').onclick=()=>{const c=ensureVisitConclusion(visit),w=window.open('','_blank');if(!w){showToast('Autorisez les fenêtres surgissantes.');return;}w.document.write(`<!doctype html><html><head><meta charset="utf-8"><style>${fullReportStyles()}</style></head><body><button onclick="window.print()">Imprimer / Enregistrer en PDF</button>${reportHeader(visit,'Plan d’action','Synthèse sur une page')}<section class="report-section"><h2>Actions décidées</h2><table><thead><tr><th>Action</th><th>Décision</th><th>Commentaire</th><th>Réalisée</th></tr></thead><tbody>${(c.priorities||[]).filter(a=>a.text).map(a=>`<tr><td>${escapeHtml(a.text)}</td><td>${escapeHtml(a.decision||'')}</td><td>${escapeHtml(a.comment||'')}</td><td>☐</td></tr>`).join('')}</tbody></table><h2>À vérifier lors de la prochaine visite</h2>${reportList(c.next)}</section></body></html>`);w.document.close();};
}


// V11.10 — import des données techniques issues d'autres logiciels
let herdImportPreview = null;
let herdImportReadToken = 0;
let herdLibraryOpen = false;

function normalizeCsvHeader(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9]+/g,' ').trim();
}
function parseFrenchNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(n) ? n : null;
}
function parseCsvText(text) {
  const clean = text.replace(/^\uFEFF/,'');
  const firstLine = clean.split(/\r?\n/,1)[0] || '';
  const delimiter = (firstLine.match(/;/g)||[]).length >= (firstLine.match(/,/g)||[]).length ? ';' : ',';
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<clean.length;i++){
    const ch=clean[i], next=clean[i+1];
    if(ch==='"' && quoted && next==='"'){cell+='"';i++;continue;}
    if(ch==='"'){quoted=!quoted;continue;}
    if(ch===delimiter && !quoted){row.push(cell);cell='';continue;}
    if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell);cell='';if(row.some(v=>v!==''))rows.push(row);row=[];continue;}
    cell+=ch;
  }
  if(cell!==''||row.length){row.push(cell);if(row.some(v=>v!==''))rows.push(row);}
  const headers=(rows.shift()||[]).map(h=>h.trim());
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||'').trim()])));
}
function rowLookup(row) {
  const entries=Object.entries(row); const normalized=new Map(entries.map(([k,v])=>[normalizeCsvHeader(k),v]));
  return {
    exact:(...names)=>{for(const name of names){const v=normalized.get(normalizeCsvHeader(name));if(v!==undefined&&v!=='')return v;}return '';},
    includes:(tokens, period='')=>{const wanted=tokens.map(normalizeCsvHeader);const per=normalizeCsvHeader(period);for(const [k,v] of normalized){if(v!==''&&wanted.every(t=>k.includes(t))&&(!per||k.includes(per)))return v;}return '';},
    entries
  };
}
function periodValue(lookup, labelTokens, period) {
  const p=normalizeCsvHeader(period);
  for(const [key,value] of lookup.entries){const n=normalizeCsvHeader(key);if(value!==''&&labelTokens.every(t=>n.includes(normalizeCsvHeader(t)))&&n.endsWith(`periode ${p}`))return parseFrenchNumber(value);}
  return null;
}
function extractHerdRow(row, fileName='') {
  const l=rowLookup(row); const periods=['N-2','N-1','N'];
  const monthly=(kind,period)=>Array.from({length:12},(_,i)=>periodValue(l,['nombre','mouvements',kind,'mois',String(i+1)],period));
  const result={
    id:uid('herdimport'), sourceFile:fileName, importedAt:new Date().toISOString(), rawHeaderCount:Object.keys(row).length,
    identity:{
      holder:l.exact('Nom du détenteur','Nom détenteur','Eleveur','Éleveur'), farmNumber:l.exact("Numéro d'exploitation","N° exploitation",'Numero exploitation'), holderNumber:l.exact('Numéro de détenteur','N° détenteur','Numero detenteur'), siret:l.exact('N° SIRET','SIRET'), commune:l.exact('Commune'), postalCode:l.exact('Code postal'), phone:l.exact('Numéro portable','Telephone portable','Téléphone'), email:l.exact('Adresse mail','Email'), production:l.exact('Production bovine')
    },
    period:{start:l.exact('Date de début de période','Debut periode'),end:l.exact('Date de fin de période','Fin periode'),generated:l.exact("Date de génération du fichier = date d'impression sur le document",'Date de génération du fichier','Date generation')},
    years:{}, raw:row
  };
  periods.forEach(period=>{
    result.years[period]={
      births:periodValue(l,['nombre total','mouvements','naissance'],period), purchases:periodValue(l,['nombre total','mouvements','achat'],period), deaths:periodValue(l,['nombre total','mouvements','mort'],period),
      monthly:{births:monthly('naissance',period),purchases:monthly('achat',period),deaths:monthly('mort',period)},
      mortality:{h0_48:periodValue(l,['mortalite','0','48 heures'],period),d2_7:periodValue(l,['mortalite','48 heures','7 jours'],period),d8_30:periodValue(l,['mortalite','7 jours','1 mois'],period),m1_6:periodValue(l,['mortalite','1 mois','6 mois'],period),m6_12:periodValue(l,['mortalite','6 mois','12 mois'],period),m12_24:periodValue(l,['mortalite','12 mois','24 mois'],period),over24:periodValue(l,['mortalite','24 mois'],period),total:periodValue(l,['mortalite totale'],period),youngRate:periodValue(l,['taux','mortalite','jeunes','12 mois'],period)},
      reproduction:{firstCalvingAge:periodValue(l,['age','premier velage'],period),ivv:periodValue(l,['intervalle','velage','velage','moyen'],period),ivv390:periodValue(l,['nombre','vaches','ivv','390'],period),ivv420:periodValue(l,['nombre','vaches','ivv','420'],period),abortions:periodValue(l,['nombre','avortements'],period),productivity:periodValue(l,['productivite','numerique','nette'],period)}
    };
  });
  result.current={
    unproductiveFemales:parseFrenchNumber(l.includes(['femelles','improductives'])),
    structure:{
      males0_6:parseFrenchNumber(l.exact('Fin de période - Nombre de mâles présents de 0 à 6 mois')),
      males6_12:parseFrenchNumber(l.exact('Fin de période - Nombre de mâles présents de 6 à 12 mois')),
      males12_24:parseFrenchNumber(l.exact('Fin de période - Nombre de mâles présents de 12 à 24 mois')),
      males24_36:parseFrenchNumber(l.exact('Fin de période - Nombre de mâles présents de 24 à 36 mois')),
      malesOver36:parseFrenchNumber(l.exact('Fin de période - Nombre de mâles présents de plus de 36 mois')),
      females0_6:parseFrenchNumber(l.exact('Fin de période - Nombre de femelles présentes de 0 à 6 mois')),
      females6_12:parseFrenchNumber(l.exact('Fin de période - Nombre de femelles présentes de 6 à 12 mois')),
      females12_24:parseFrenchNumber(l.exact('Fin de période - Nombre de femelles présentes de 12 à 24 mois')),
      females24_36:parseFrenchNumber(l.exact('Fin de période - Nombre de femelles présentes de 24 à 36 mois')),
      femalesOver36:parseFrenchNumber(l.exact('Fin de période - Nombre de femelles présentes de plus de 36 mois')),
      total0_6:parseFrenchNumber(l.exact('Fin de période - Nombre total de bovins présents de 0 à 6 mois')),
      total6_12:parseFrenchNumber(l.exact('Fin de période - Nombre total de bovins présents de 6 à 12 mois')),
      total12_24:parseFrenchNumber(l.exact('Fin de période - Nombre total de bovins présents de 12 à 24 mois')),
      total24_36:parseFrenchNumber(l.exact('Fin de période - Nombre total de bovins présents de 24 à 36 mois')),
      totalOver36:parseFrenchNumber(l.exact('Fin de période - Nombre total de bovins présents de plus de 36 mois')),
      total:parseFrenchNumber(l.exact('Fin de période - Nombre total de bovins présents'))
    },
    movements:{
      births:parseFrenchNumber(l.exact("Nombre de mouvements d'entrée Naissance période N")),
      purchases:parseFrenchNumber(l.exact("Nombre de mouvements d'entrée Achat période N")),
      salesBreeding:parseFrenchNumber(l.exact('Nombre de mouvements de sortie Elevage période N')),
      salesSlaughter:parseFrenchNumber(l.exact('Nombre de mouvements de sortie Boucherie période N')),
      deaths:parseFrenchNumber(l.exact('Nombre de mouvements de sortie Mort période N')),
      otherOutputs:parseFrenchNumber(l.exact('Nombre de mouvements de sortie Autre période N')),
      totalOutputs:parseFrenchNumber(l.exact('Nombre total de mouvements de sortie période N'))
    }
  };
  // Effectifs : conserver tous les champs contenant « effectif » afin de rester compatible avec d'autres exports.
  result.effectives=l.entries.filter(([k,v])=>normalizeCsvHeader(k).includes('effectif')&&v!=='').map(([label,value])=>({label,value:parseFrenchNumber(value)??value}));
  return result;
}
function repairHerdImport(item){
  if(!item||!item.raw||typeof item.raw!=='object')return item;
  const rebuilt=extractHerdRow(item.raw,item.sourceFile||'');
  return {...rebuilt,...item,id:item.id||rebuilt.id,farmId:item.farmId||'',importedAt:item.importedAt||rebuilt.importedAt,raw:JSON.parse(JSON.stringify(item.raw))};
}
function herdImportLabel(item){return `${item.identity.holder||item.identity.farmNumber||'Élevage'} — ${item.period.start||'?'} au ${item.period.end||'?'}`;}
function normalizeHerdNumber(value=''){const digits=String(value||'').replace(/\D/g,'');return digits.length>=6?digits:'';}
function farmHerdNumbers(f){return [f.farmNumber,f.herdNumber,f.edeNumber,f.exploitationNumber,f.farmer,f.name].map(normalizeHerdNumber).filter(Boolean);}
function findFarmForImport(item){const num=normalizeHerdNumber(item.identity.farmNumber||item.identity.holderNumber);const holder=normalizeCsvHeader(item.identity.holder||'');return db.farms.find(f=>(num&&farmHerdNumbers(f).includes(num))||(holder&&[f.farmer,f.name].some(v=>normalizeCsvHeader(v||'')===holder)));}
function repairLegacyFarmNumbers(){let changed=false;db.farms.forEach(f=>{if(!f.farmNumber){const legacy=[f.herdNumber,f.edeNumber,f.exploitationNumber,f.farmer].map(normalizeHerdNumber).find(Boolean);if(legacy){f.farmNumber=legacy;changed=true;}}});if(changed)saveDatabase(db);return changed;}
function repairHerdImportFarmLinks(){repairLegacyFarmNumbers();let linked=0;(db.herdImports||[]).forEach(item=>{if(item.farmId)return;const matched=findFarmForImport(item);if(matched){item.farmId=matched.id;linked++;}});if(linked)saveDatabase(db);return{linked,applied:0};}
function metricCell(value,suffix=''){return value===null||value===undefined?'<span class="muted">—</span>':`<strong>${escapeHtml(String(value).replace('.',','))}${suffix}</strong>`;}
function miniBars(values){const nums=values.map(v=>Number(v)||0),max=Math.max(1,...nums);return `<div class="herd-mini-bars">${nums.map((v,i)=>`<i title="Mois ${i+1} : ${v}" style="height:${Math.max(3,Math.round(v/max*44))}px"></i>`).join('')}</div>`;}

function parseFrenchDate(value=''){const m=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?new Date(Number(m[3]),Number(m[2])-1,Number(m[1])):null;}
function herdPeriodDisplay(item){const end=parseFrenchDate(item?.period?.end||'');if(!end)return {'N-2':'N-2','N-1':'N-1','N':'N'};const y=end.getFullYear();return {'N-2':String(y-2),'N-1':String(y-1),'N':String(y)};}
function chartValue(v){return v===null||v===undefined||v===''||Number.isNaN(Number(v))?null:Number(v);}
function herdChartEmpty(label='Aucune donnée graphique disponible.'){return `<div class="empty compact">${escapeHtml(label)}</div>`;}
function herdChartLegend(series){return `<div class="herd-chart-legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${escapeHtml(s.label)}</span>`).join('')}</div>`;}
function herdLineChartSvg(labels,values,{color='#2F6F73',height=300}={}){
  const vals=values.map(chartValue);if(!vals.some(v=>v!==null))return herdChartEmpty();
  const width=760,pad={top:28,right:24,bottom:50,left:52};
  const real=vals.filter(v=>v!==null);let min=Math.min(...real),max=Math.max(...real);if(min===max){min-=1;max+=1;}
  const range=max-min||1;const plotW=width-pad.left-pad.right,plotH=height-pad.top-pad.bottom;
  const x=i=>pad.left+(labels.length===1?plotW/2:(i*plotW/Math.max(1,labels.length-1)));const y=v=>pad.top+(max-v)/range*plotH;
  let path='';let started=false;vals.forEach((v,i)=>{if(v===null){started=false;return;}path+=`${started?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;started=true;});
  const grid=Array.from({length:4},(_,i)=>{const gv=min+range*(i/3);const gy=y(gv);return `<line x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${width-pad.right}" y2="${gy.toFixed(1)}" stroke="#d9e4dd" stroke-width="1"/><text x="${pad.left-6}" y="${(gy+4).toFixed(1)}" text-anchor="end" font-size="13" fill="#66756c">${Math.round(gv)}</text>`;}).join('');
  const points=vals.map((v,i)=>v===null?'':`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5.2" fill="${color}"/><text x="${x(i).toFixed(1)}" y="${(y(v)-10).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="#22312a">${String(v).replace('.',',')}</text>`).join('');
  const xLabels=labels.map((lbl,i)=>`<text x="${x(i).toFixed(1)}" y="${height-14}" text-anchor="middle" font-size="14" fill="#4a5750">${escapeHtml(lbl)}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="herd-svg-chart" aria-hidden="true"><rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#fffafd"/><g>${grid}<line x1="${pad.left}" y1="${height-pad.bottom}" x2="${width-pad.right}" y2="${height-pad.bottom}" stroke="#b9c9bf" stroke-width="1.2"/><path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${points}${xLabels}</g></svg>`;
}
function herdGroupedBarChartSvg(labels,series,{height=300}={}){
  if(!series.length)return herdChartEmpty();
  const width=760,pad={top:32,right:24,bottom:52,left:52};
  const numeric=series.flatMap(s=>s.values.map(chartValue).filter(v=>v!==null));if(!numeric.length)return herdChartEmpty();
  const max=Math.max(...numeric,1),plotW=width-pad.left-pad.right,plotH=height-pad.top-pad.bottom,groupW=plotW/Math.max(1,labels.length),barW=Math.min(26,(groupW-16)/Math.max(1,series.length));
  const y=v=>pad.top+(1-v/max)*plotH;
  const grid=Array.from({length:4},(_,i)=>{const gv=max*(i/3),gy=y(gv);return `<line x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${width-pad.right}" y2="${gy.toFixed(1)}" stroke="#d9e4dd" stroke-width="1"/><text x="${pad.left-6}" y="${(gy+4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b746e">${Math.round(gv)}</text>`;}).join('');
  let bars='';
  labels.forEach((lbl,i)=>{const baseX=pad.left+i*groupW+8;series.forEach((s,j)=>{const v=chartValue(s.values[i]);if(v===null)return;const bh=Math.max(0,(v/max)*plotH);const bx=baseX+j*barW,by=pad.top+plotH-bh;bars+=`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(barW-4).toFixed(1)}" height="${bh.toFixed(1)}" rx="5" fill="${s.color}"/><text x="${(bx+(barW-4)/2).toFixed(1)}" y="${(by-6).toFixed(1)}" text-anchor="middle" font-size="11" fill="#22312a">${String(v).replace('.',',')}</text>`;});bars+=`<text x="${(pad.left+i*groupW+groupW/2).toFixed(1)}" y="${height-14}" text-anchor="middle" font-size="12" fill="#4a5750">${escapeHtml(lbl)}</text>`;});
  return `${herdChartLegend(series)}<svg viewBox="0 0 ${width} ${height}" class="herd-svg-chart" aria-hidden="true"><rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#fffafd"/><g>${grid}<line x1="${pad.left}" y1="${height-pad.bottom}" x2="${width-pad.right}" y2="${height-pad.bottom}" stroke="#b9c9bf" stroke-width="1.2"/>${bars}</g></svg>`;
}
function herdStackedBarChartSvg(labels,series,{height=300}={}){
  if(!series.length)return herdChartEmpty();
  const width=760,pad={top:32,right:24,bottom:52,left:52};
  const totals=labels.map((_,i)=>series.reduce((sum,s)=>sum+(chartValue(s.values[i])||0),0));if(!totals.some(v=>v>0))return herdChartEmpty();
  const max=Math.max(...totals,1),plotW=width-pad.left-pad.right,plotH=height-pad.top-pad.bottom,barW=Math.min(72,plotW/Math.max(1,labels.length)-18);
  const y=v=>pad.top+(1-v/max)*plotH;
  const grid=Array.from({length:4},(_,i)=>{const gv=max*(i/3),gy=y(gv);return `<line x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${width-pad.right}" y2="${gy.toFixed(1)}" stroke="#d9e4dd" stroke-width="1"/><text x="${pad.left-6}" y="${(gy+4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b746e">${Math.round(gv)}</text>`;}).join('');
  let bars='';
  labels.forEach((lbl,i)=>{const x=pad.left+i*(plotW/Math.max(1,labels.length))+(plotW/Math.max(1,labels.length)-barW)/2;let cumulative=0;series.forEach(s=>{const v=chartValue(s.values[i])||0;if(v<=0)return;const y0=y(cumulative+v),y1=y(cumulative),h=y1-y0;bars+=`<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"/>`;cumulative+=v;});bars+=`<text x="${(x+barW/2).toFixed(1)}" y="${(y(cumulative)-8).toFixed(1)}" text-anchor="middle" font-size="11" fill="#22312a">${cumulative||''}</text><text x="${(x+barW/2).toFixed(1)}" y="${height-14}" text-anchor="middle" font-size="12" fill="#4a5750">${escapeHtml(lbl)}</text>`;});
  return `${herdChartLegend(series)}<svg viewBox="0 0 ${width} ${height}" class="herd-svg-chart" aria-hidden="true"><rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#fffafd"/><g>${grid}<line x1="${pad.left}" y1="${height-pad.bottom}" x2="${width-pad.right}" y2="${height-pad.bottom}" stroke="#b9c9bf" stroke-width="1.2"/>${bars}</g></svg>`;
}
function herdSummaryCards(item){
  const current=item.current||{},st=current.structure||{},mv=current.movements||{},rep=item.years?.N?.reproduction||{},mort=item.years?.N?.mortality||{};
  return [
    ['Effectif total',st.total],['Naissances (N)',mv.births],['Achats (N)',mv.purchases],['Sorties totales (N)',mv.totalOutputs],['IVV moyen (N)',rep.ivv!==null&&rep.ivv!==undefined?`${String(rep.ivv).replace('.',',')} j`:null],['Mortalité totale (N)',mort.total]
  ].filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([l,v])=>`<div class="calculated-box"><span>${escapeHtml(l)}</span><strong>${escapeHtml(String(v).replace('.',','))}</strong></div>`).join('');
}
function herdChartsHtml(item,{forReport=false}={}){
  const labelsMap=herdPeriodDisplay(item),periods=['N-2','N-1','N'];const labels=periods.map(p=>labelsMap[p]||p);
  const ivv=periods.map(p=>item.years?.[p]?.reproduction?.ivv);
  const movements=[
    {label:'Naissances',color:'#3F7C85',values:periods.map(p=>item.years?.[p]?.births)},
    {label:'Achats',color:'#7AA37A',values:periods.map(p=>item.years?.[p]?.purchases)},
    {label:'Mortalités',color:'#C9795A',values:periods.map(p=>item.years?.[p]?.deaths)}
  ];
  const mortalitySeries=[
    {label:'0–2 j',color:'#3F6F8F',values:periods.map(p=>item.years?.[p]?.mortality?.h0_48)},
    {label:'2 j – 1 mois',color:'#C9795A',values:periods.map(p=>(chartValue(item.years?.[p]?.mortality?.d2_7)||0)+(chartValue(item.years?.[p]?.mortality?.d8_30)||0))},
    {label:'1–6 mois',color:'#8A9A91',values:periods.map(p=>item.years?.[p]?.mortality?.m1_6)},
    {label:'6–12 mois',color:'#D6A84B',values:periods.map(p=>item.years?.[p]?.mortality?.m6_12)},
    {label:'12–24 mois',color:'#6C8FB5',values:periods.map(p=>item.years?.[p]?.mortality?.m12_24)},
    {label:'> 24 mois',color:'#5F8A6B',values:periods.map(p=>item.years?.[p]?.mortality?.over24)}
  ];
  return `<div class="herd-chart-grid${forReport?' report-mode':''}">
    <article class="card herd-chart-card"><h4>Évolution IVV</h4><p class="muted">Intervalle vêlage-vêlage moyen par année.</p>${herdLineChartSvg(labels,ivv,{color:'#2F6F73'})}</article>
    <article class="card herd-chart-card"><h4>Répartition des mortalités par classe d’âge</h4><p class="muted">Empilé par période importée.</p>${herdStackedBarChartSvg(labels,mortalitySeries)}</article>
    <article class="card herd-chart-card"><h4>Mouvements du troupeau</h4><p class="muted">Naissances, achats et mortalités enregistrées.</p>${herdGroupedBarChartSvg(labels,movements)}</article>
  </div>`;
}
function linkedHerdImportForVisit(visit){const linked=ensureAuditGlobal(visit).importedHerdData;if(linked?.snapshot)return repairHerdImport(linked.snapshot);const sourceId=linked?.sourceId;const item=sourceId?(db.herdImports?.find(x=>x.id===sourceId)||null):null;if(item&&linked&&!linked.snapshot){linked.snapshot=JSON.parse(JSON.stringify(item));saveDatabase(db);}return item;}
function reportHerdDataHtml(visit){const item=linkedHerdImportForVisit(visit);if(!item)return '<p class="report-empty">Aucune donnée élevage importée pour cette exploitation.</p>';return `<div class="report-kpis">${herdSummaryCards(item)}</div><article class="report-subsection"><h3>Origine des données élevage</h3><p><strong>Fichier :</strong> ${escapeHtml(item.sourceFile||'CSV')}<br><strong>Période :</strong> ${escapeHtml(item.period?.start||'—')} au ${escapeHtml(item.period?.end||'—')}<br><strong>Importé le :</strong> ${escapeHtml(formatDateTime(item.importedAt))}</p></article>${herdChartsHtml(item,{forReport:true})}`;}

function latestVisitForFarm(farmId){return db.visits.filter(v=>v.farmId===farmId).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0]||null;}
function importedValue(value){return value===null||value===undefined||value===''?'':String(value);}
function setIfBlank(obj,key,value,changes,label,overwrite=false){if(value===null||value===undefined||value==='')return;if(overwrite||obj[key]===undefined||obj[key]===null||obj[key]===''){obj[key]=importedValue(value);changes.push(label);}}
function appendImportedEconomic(arr,row,sourceId){if(!row.quantity)return;const existing=arr.find(x=>x.importSourceId===sourceId&&x.importKey===row.importKey);if(existing)Object.assign(existing,row);else arr.push({...row,id:uid('econ'),importSourceId:sourceId});}
function cloneImportValue(value){return value===undefined?null:JSON.parse(JSON.stringify(value));}
function getPathValue(root,path){return path.reduce((cur,key)=>cur==null?undefined:cur[key],root);}
function setPathValue(root,path,value){let cur=root;for(let i=0;i<path.length-1;i++){const key=path[i];if(!cur[key]||typeof cur[key]!=='object')cur[key]={};cur=cur[key];}cur[path[path.length-1]]=cloneImportValue(value);}
function rememberImportedField(a,path,newValue,sourceId){
  a.importedHerdFieldState=Array.isArray(a.importedHerdFieldState)?a.importedHerdFieldState:[];
  const key=path.join('.');
  let state=a.importedHerdFieldState.find(x=>x.key===key&&x.sourceId===sourceId);
  if(!state){state={key,path:[...path],sourceId,previousValue:cloneImportValue(getPathValue(a,path))};a.importedHerdFieldState.push(state);}
  state.importedValue=cloneImportValue(newValue);
}
function setImportedField(a,path,value,sourceId,changes,label,overwrite=false){
  if(value===null||value===undefined||value==='')return;
  const current=getPathValue(a,path);
  if(overwrite||current===undefined||current===null||current===''){
    rememberImportedField(a,path,importedValue(value),sourceId);
    setPathValue(a,path,importedValue(value));
    changes.push(label);
  }
}
function removeHerdImportFromVisit(visit,sourceId=''){
  const a=ensureAuditGlobal(visit),oldId=sourceId||a.importedHerdData?.sourceId||'';
  if(!oldId)return 0;let removed=0;
  const states=(a.importedHerdFieldState||[]).filter(x=>x.sourceId===oldId);
  states.slice().reverse().forEach(state=>{
    const current=getPathValue(a,state.path||String(state.key||'').split('.'));
    if(JSON.stringify(current)===JSON.stringify(state.importedValue)){
      setPathValue(a,state.path||String(state.key||'').split('.'),state.previousValue??'');removed++;
    }
  });
  a.importedHerdFieldState=(a.importedHerdFieldState||[]).filter(x=>x.sourceId!==oldId);
  ['purchases','sales'].forEach(k=>{const before=(a[k]||[]).length;a[k]=(a[k]||[]).filter(x=>x.importSourceId!==oldId);removed+=before-a[k].length;});
  a.importedHerdData=null;visit.updatedAt=new Date().toISOString();return removed;
}
function applyHerdImportToVisit(item,visit,overwrite=false){
  item=repairHerdImport(JSON.parse(JSON.stringify(item)));
  const a=ensureAuditGlobal(visit),changes=[],st=item.current?.structure||{},mv=item.current?.movements||{},yr=item.years?.N||{},mort=yr.mortality||{},rep=yr.reproduction||{};
  if(a.importedHerdData?.sourceId&&a.importedHerdData.sourceId!==item.id)removeHerdImportFromVisit(visit,a.importedHerdData.sourceId);
  setImportedField(a,['renewal','cowsTotal'],st.femalesOver36,item.id,changes,'Vaches / femelles de plus de 36 mois',overwrite);
  setImportedField(a,['renewal','calvesUnder6'],st.total0_6,item.id,changes,'Veaux de moins de 6 mois',overwrite);
  setImportedField(a,['renewal','heifers6_12'],st.females6_12,item.id,changes,'Génisses de 6 à 12 mois',overwrite);
  setImportedField(a,['renewal','heifers12_24'],st.females12_24,item.id,changes,'Génisses de 12 à 24 mois',overwrite);
  setImportedField(a,['renewal','replacementHeifers'],((st.females6_12??0)+(st.females12_24??0))||null,item.id,changes,'Potentiel de génisses de renouvellement 6–24 mois',overwrite);
  setImportedField(a,['renewal','annualReforms'],mv.salesSlaughter,item.id,changes,'Réformes / sorties boucherie',overwrite);
  const mortalityMap={'0–2 jours':mort.h0_48,'2 jours–1 mois':((mort.d2_7??0)+(mort.d8_30??0))||null,'1–6 mois':mort.m1_6,'6–12 mois':mort.m6_12,'12–24 mois':mort.m12_24,'> 24 mois':mort.over24};
  Object.entries(mortalityMap).forEach(([cl,v])=>{
    if(v===null||v===undefined)return;const r=a.mortality[cl];
    if(overwrite||!r.count){
      rememberImportedField(a,['mortality',cl,'count'],importedValue(v),item.id);setPathValue(a,['mortality',cl,'count'],importedValue(v));
      const comment=`Donnée importée (${item.sourceFile||'CSV'}, période N).`;
      rememberImportedField(a,['mortality',cl,'comment'],comment,item.id);setPathValue(a,['mortality',cl,'comment'],comment);changes.push(`Mortalité ${cl}`);
    }
  });
  a.answers['Âge moyen au premier vêlage']=a.answers['Âge moyen au premier vêlage']||{};
  if(rep.firstCalvingAge!==null&&rep.firstCalvingAge!==undefined&&(overwrite||!a.answers['Âge moyen au premier vêlage'].answer)){
    setImportedField(a,['answers','Âge moyen au premier vêlage','answer'],rep.firstCalvingAge,item.id,changes,'Âge au premier vêlage',true);
    const c=`Valeur importée depuis ${item.sourceFile||'CSV'} (période N), unité : mois.`;rememberImportedField(a,['answers','Âge moyen au premier vêlage','comment'],c,item.id);setPathValue(a,['answers','Âge moyen au premier vêlage','comment'],c);
  }
  a.answers['Intervalle vêlage-vêlage']=a.answers['Intervalle vêlage-vêlage']||{};
  if(rep.ivv!==null&&rep.ivv!==undefined&&(overwrite||!a.answers['Intervalle vêlage-vêlage'].answer)){
    setImportedField(a,['answers','Intervalle vêlage-vêlage','answer'],rep.ivv,item.id,changes,'IVV',true);
    const c=`IVV > 390 j : ${rep.ivv390??'—'} ; IVV > 420 j : ${rep.ivv420??'—'}. Valeur importée, unité : jours.`;rememberImportedField(a,['answers','Intervalle vêlage-vêlage','comment'],c,item.id);setPathValue(a,['answers','Intervalle vêlage-vêlage','comment'],c);
  }
  appendImportedEconomic(a.purchases,{importKey:'animals',product:'Autre',detail:'Achats de bovins',quantity:mv.purchases,unit:'animaux',unitPrice:'',partner:'',comment:'Quantité importée – période N'},item.id);
  appendImportedEconomic(a.sales,{importKey:'breeding',product:'Reproducteurs',detail:'Vente pour élevage / reproduction',quantity:mv.salesBreeding,unit:'animaux',unitPrice:'',partner:'Débouché élevage',comment:'Quantité importée – période N'},item.id);
  appendImportedEconomic(a.sales,{importKey:'slaughter',product:'Vaches de réforme',detail:'Vente / réforme boucherie',quantity:mv.salesSlaughter,unit:'animaux',unitPrice:'',partner:'Débouché boucherie',comment:'Quantité importée – période N'},item.id);
  appendImportedEconomic(a.sales,{importKey:'other',product:'Autre',detail:'Autres sorties',quantity:mv.otherOutputs,unit:'animaux',unitPrice:'',partner:'Autre débouché',comment:'Nature du débouché à préciser pendant la visite'},item.id);
  const frozen=JSON.parse(JSON.stringify(item));
  a.importedHerdData={sourceId:item.id,importInstanceId:item.importInstanceId||item.id,sourceFile:item.sourceFile||'',period:cloneImportValue(item.period||{}),snapshot:frozen,appliedAt:new Date().toISOString(),changes:[...changes],summary:{totalHerd:st.total,births:mv.births,purchases:mv.purchases,totalOutputs:mv.totalOutputs,mortalityTotal:mort.total,mortalityYoungRate:mort.youngRate,abortions:rep.abortions,productivity:rep.productivity,unproductiveFemales:item.current?.unproductiveFemales}};
  visit.updatedAt=new Date().toISOString();saveDatabase(db);return changes;
}
function herdAuditLinkHtml(item){const visits=db.visits.filter(v=>v.farmId===item.farmId).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));const farm=db.farms.find(f=>f.id===item.farmId);const relink=`<div class="herd-relink"><div class="field"><label>Exploitation liée à cet import</label><select data-relink-herd-import="${item.id}"><option value="">Choisir…</option>${db.farms.map(f=>`<option value="${f.id}" ${f.id===item.farmId?'selected':''}>${escapeHtml(f.name)}${f.farmNumber?` — EDE ${escapeHtml(f.farmNumber)}`:''}</option>`).join('')}</select></div><button class="btn secondary" data-confirm-relink-herd="${item.id}">Relier à cette exploitation</button></div>`;if(!visits.length)return `${relink}<div class="notice warning"><strong>Aucune visite liée.</strong> L’import est actuellement associé à <strong>${escapeHtml(farm?.name||'une exploitation sans visite')}</strong>. Sélectionnez ci-dessus l’exploitation qui possède la visite.</div>`;const suggested=(activeVisit()?.farmId===item.farmId?activeVisit():latestVisitForFarm(item.farmId));return `${relink}<div class="herd-audit-link"><div class="field"><label>Visite à compléter</label><select data-herd-target-visit="${item.id}">${visits.map(v=>`<option value="${v.id}" ${v.id===suggested?.id?'selected':''}>${formatDate(v.date)} — ${escapeHtml(v.type||'Visite')}</option>`).join('')}</select></div><label class="checkbox-line"><input type="checkbox" data-herd-overwrite="${item.id}"> Remplacer aussi les valeurs déjà saisies</label><button class="btn primary" data-apply-herd-audit="${item.id}">Compléter l’audit avec ces données</button><div class="muted">Par défaut, seules les rubriques vides sont complétées. Les données importées restent identifiées.</div></div>`;}
function renderHerdImportDetail(item){
  const periods=['N-2','N-1','N'];
  return `<section class="card herd-detail"><div class="section-title"><div><h3>${escapeHtml(herdImportLabel(item))}</h3><span class="muted">Importé le ${formatDateTime(item.importedAt)} · ${item.rawHeaderCount} colonnes reconnues</span></div><button class="btn small danger" data-delete-herd-import="${item.id}">Supprimer</button></div>
  <div class="herd-identity"><span><b>N° exploitation</b>${escapeHtml(item.identity.farmNumber||'—')}</span><span><b>Détenteur</b>${escapeHtml(item.identity.holder||'—')}</span><span><b>Commune</b>${escapeHtml(item.identity.commune||'—')}</span><span><b>Fichier source</b>${escapeHtml(item.sourceFile||'—')}</span></div>
  ${herdAuditLinkHtml(item)}
  <div class="grid cols-3 herd-summary-strip">${herdSummaryCards(item)}</div>
  ${herdChartsHtml(item)}
  <h4>Activité et mouvements</h4><div class="table-wrap"><table class="herd-table"><thead><tr><th>Indicateur</th>${periods.map(p=>`<th>${p}</th>`).join('')}</tr></thead><tbody>
  <tr><td>Naissances</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.births)}${miniBars(item.years[p]?.monthly?.births||[])}</td>`).join('')}</tr>
  <tr><td>Achats</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.purchases)}${miniBars(item.years[p]?.monthly?.purchases||[])}</td>`).join('')}</tr>
  <tr><td>Mortalités</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.deaths)}${miniBars(item.years[p]?.monthly?.deaths||[])}</td>`).join('')}</tr></tbody></table></div>
  <h4>Mortalité</h4><div class="table-wrap"><table class="herd-table"><thead><tr><th>Indicateur</th>${periods.map(p=>`<th>${p}</th>`).join('')}</tr></thead><tbody>
  <tr><td>Mortalité totale</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.mortality?.total)}</td>`).join('')}</tr><tr><td>Taux jeunes &lt; 12 mois</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.mortality?.youngRate,' %')}</td>`).join('')}</tr><tr><td>0–48 h</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.mortality?.h0_48)}</td>`).join('')}</tr><tr><td>1–6 mois</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.mortality?.m1_6)}</td>`).join('')}</tr></tbody></table></div>
  <h4>Reproduction</h4><div class="table-wrap"><table class="herd-table"><thead><tr><th>Indicateur</th>${periods.map(p=>`<th>${p}</th>`).join('')}</tr></thead><tbody>
  <tr><td>Âge au premier vêlage</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.reproduction?.firstCalvingAge)}</td>`).join('')}</tr><tr><td>IVV moyen</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.reproduction?.ivv,' j')}</td>`).join('')}</tr><tr><td>Vaches avec IVV &gt; 390 j</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.reproduction?.ivv390)}</td>`).join('')}</tr><tr><td>Vaches avec IVV &gt; 420 j</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.reproduction?.ivv420)}</td>`).join('')}</tr><tr><td>Avortements déclarés</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.reproduction?.abortions)}</td>`).join('')}</tr><tr><td>Productivité numérique nette</td>${periods.map(p=>`<td>${metricCell(item.years[p]?.reproduction?.productivity)}</td>`).join('')}</tr></tbody></table></div>
  ${item.current.unproductiveFemales!==null?`<div class="notice warning"><strong>Femelles improductives :</strong> ${item.current.unproductiveFemales}</div>`:''}
  ${item.effectives.length?`<details><summary><strong>Effectifs importés (${item.effectives.length} indicateurs)</strong></summary><div class="table-wrap"><table><tbody>${item.effectives.map(e=>`<tr><td>${escapeHtml(e.label)}</td><td>${metricCell(e.value)}</td></tr>`).join('')}</tbody></table></div></details>`:''}</section>`;
}
function renderHerdData(){
  db.herdImports=Array.isArray(db.herdImports)?db.herdImports:[];
  db.herdImports=db.herdImports.map(repairHerdImport);saveDatabase(db);
  repairHerdImportFarmLinks();
  const visit=activeVisit();
  if(!visit){
    app.innerHTML=`<div class="section-title"><div><h2>Données technico-économiques</h2><span class="muted">Sélectionnez d’abord une visite.</span></div><span class="badge autosave">v14.5.2</span></div><section class="notice warning"><strong>Aucune visite sélectionnée.</strong> Ouvrez une visite avant d’importer ou d’afficher ses données CSV.</section>`;
    return;
  }
  const farm=db.farms.find(f=>f.id===visit.farmId);
  const audit=ensureAuditGlobal(visit);
  const currentSourceId=audit.importedHerdData?.sourceId||'';
  const currentImport=audit.importedHerdData?.snapshot||db.herdImports.find(x=>x.id===currentSourceId)||null;
  const hasCurrentCsv=!!currentImport;
  const compatible=db.herdImports.filter(x=>x.farmId===visit.farmId&&x.id!==currentSourceId).slice().sort((a,b)=>(b.importedAt||'').localeCompare(a.importedAt||''));
  const currentHtml=currentImport?`<section class="card"><div class="section-title"><div><h3>CSV associé à cette visite</h3><span class="muted">Un seul fichier est utilisé pour cette visite.</span></div><button class="btn small danger" id="detach-herd-visit">Retirer de la visite</button></div><div class="herd-identity"><span><b>Exploitation</b>${escapeHtml(farm?.name||currentImport.identity?.holder||'—')}</span><span><b>Visite</b>${formatDate(visit.date)} — ${escapeHtml(visit.type||'Visite')}</span><span><b>Fichier source</b>${escapeHtml(currentImport.sourceFile||audit.importedHerdData?.sourceFile||'—')}</span><span><b>Période</b>${escapeHtml(herdImportLabel(currentImport))}</span></div><div class="grid cols-3 herd-summary-strip">${herdSummaryCards(currentImport)}</div><details><summary><strong>Voir le détail du CSV associé</strong></summary>${herdChartsHtml(currentImport)}</details></section>`:`<section class="notice warning"><strong>Aucun CSV associé à cette visite.</strong> Importez un fichier ou choisissez-en un parmi les fichiers de cette exploitation.</section>`;
  const importHtml=`<section class="card"><h3>Importer un CSV pour cette visite</h3><p class="muted">Le fichier sera enregistré uniquement pour <strong>${escapeHtml(farm?.name||'cette exploitation')}</strong>. Il ne sera jamais affiché dans les visites des autres exploitations.</p><div class="row"><div class="field"><label>Exploitation de destination</label><input value="${escapeHtml(farm?.name||'')}" disabled></div><div class="field"><label>Fichier CSV</label><input id="herd-csv-input" type="file" accept=".csv,text/csv"></div></div><div id="herd-preview">${herdImportPreview?`<div class="notice"><strong>Fichier sélectionné : ${escapeHtml(herdImportPreview.fileName)}</strong><br>${herdImportPreview.items.length} ligne(s) détectée(s).<div class="actions" style="margin-top:10px"><button class="btn primary" id="confirm-herd-import">Enregistrer et utiliser pour cette visite</button><button class="btn secondary" id="cancel-herd-import">Annuler</button></div></div>`:'<div class="empty">Sélectionnez un CSV pour afficher son aperçu avant validation.</div>'}</div></section>`;
  const libraryHtml=herdLibraryOpen?`<section class="card"><div class="section-title"><div><h3>Autres CSV de cette exploitation</h3><span class="muted">Aucun fichier d’une autre exploitation n’est affiché ici.</span></div><button class="btn secondary small" id="close-herd-library">Fermer</button></div>${compatible.length?compatible.map(item=>`<article class="card" style="margin-top:10px"><div class="section-title"><div><h4>${escapeHtml(herdImportLabel(item))}</h4><span class="muted">${escapeHtml(item.sourceFile||'CSV')} · importé le ${formatDateTime(item.importedAt)}</span></div><button class="btn primary small" data-use-herd-import="${item.id}">Utiliser pour cette visite</button></div><div class="herd-identity"><span><b>N° exploitation</b>${escapeHtml(item.identity?.farmNumber||'—')}</span><span><b>Détenteur</b>${escapeHtml(item.identity?.holder||'—')}</span><span><b>Commune</b>${escapeHtml(item.identity?.commune||'—')}</span></div></article>`).join(''):'<div class="empty">Aucun autre CSV enregistré pour cette exploitation.</div>'}</section>`:'';
  app.innerHTML=`<div class="section-title"><div><h2>Données technico-économiques</h2><span class="muted">Visite du ${formatDate(visit.date)} — ${escapeHtml(farm?.name||'Exploitation')}</span></div><span class="badge autosave">v14.5.2</span></div>${currentHtml}<div class="actions"><button class="btn secondary" id="toggle-herd-library">${hasCurrentCsv?'Changer de CSV':'Choisir un CSV déjà importé'}</button></div>${libraryHtml}${importHtml}`;
  document.getElementById('toggle-herd-library')?.addEventListener('click',()=>{herdLibraryOpen=!herdLibraryOpen;renderHerdData();});
  document.getElementById('close-herd-library')?.addEventListener('click',()=>{herdLibraryOpen=false;renderHerdData();});
  document.getElementById('detach-herd-visit')?.addEventListener('click',()=>{if(!confirm('Retirer les données de ce CSV de cette visite ? Le fichier restera enregistré dans la bibliothèque de cette exploitation.'))return;removeHerdImportFromVisit(visit,currentSourceId);saveDatabase(db);showToast('CSV retiré uniquement de cette visite.');renderHerdData();});
  app.querySelectorAll('[data-use-herd-import]').forEach(b=>b.onclick=()=>{const item=db.herdImports.find(x=>x.id===b.dataset.useHerdImport);if(!item)return;if(hasCurrentCsv&&currentSourceId!==item.id&&!confirm('Remplacer le CSV actuellement associé à cette visite ?'))return;const changes=applyHerdImportToVisit(item,visit,false);herdLibraryOpen=false;showToast(changes.length?`${changes.length} rubrique(s) mises à jour dans cette visite.`:'CSV associé à cette visite.');renderHerdData();});
  document.getElementById('herd-csv-input')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const token=++herdImportReadToken;try{const text=await file.text();if(token!==herdImportReadToken)return;const rows=parseCsvText(text);if(!rows.length)throw new Error('Aucune ligne');herdImportPreview={fileName:file.name,fileSize:file.size,lastModified:file.lastModified,targetFarmId:visit.farmId,items:rows.map(r=>extractHerdRow(r,file.name))};renderHerdData();}catch(err){console.error(err);herdImportPreview=null;alert('Impossible de lire ce CSV. Vérifiez son format.');renderHerdData();}});
  document.getElementById('cancel-herd-import')?.addEventListener('click',()=>{herdImportReadToken++;herdImportPreview=null;renderHerdData();});
  document.getElementById('confirm-herd-import')?.addEventListener('click',()=>{if(!herdImportPreview?.items?.length)return showToast('Aucun fichier prêt à importer.');if(herdImportPreview.targetFarmId!==visit.farmId){herdImportPreview=null;return alert('La visite active a changé pendant la lecture du CSV. Sélectionnez de nouveau le fichier pour éviter toute association à la mauvaise exploitation.');}const importedFile=herdImportPreview.fileName;const farmNumber=normalizeHerdNumber(farm?.farmNumber||farm?.herdNumber||farm?.ede||'');const explicitNumbers=[...new Set(herdImportPreview.items.map(x=>normalizeHerdNumber(x.identity?.farmNumber||'')).filter(Boolean))];let rawItem=farmNumber?herdImportPreview.items.find(x=>normalizeHerdNumber(x.identity?.farmNumber||'')===farmNumber):null;if(farmNumber&&!rawItem&&explicitNumbers.length){return alert(`Import bloqué : le CSV indique l’exploitation ${explicitNumbers.join(', ')} alors que la visite ouverte est liée à ${farmNumber}. Ouvrez la bonne exploitation avant d’importer ce fichier.`);}if(!rawItem&&herdImportPreview.items.length>1){return alert('Import bloqué : plusieurs exploitations sont présentes dans ce CSV et aucune correspondance certaine avec la visite active n’a été trouvée. Renseignez le n° EDE de l’exploitation puis recommencez.');}rawItem=rawItem||herdImportPreview.items[0];let item=repairHerdImport(JSON.parse(JSON.stringify(rawItem)));item.farmId=visit.farmId;item.id=uid('herdimport');item.importInstanceId=uid('csv');item.importedAt=new Date().toISOString();db.herdImports.push(item);saveDatabase(db);herdImportPreview=null;if(hasCurrentCsv&&currentSourceId!==item.id&&!confirm('Cette visite possède déjà un CSV. Le remplacer par le nouveau fichier ?')){showToast(`Fichier « ${importedFile} » enregistré pour cette exploitation, sans modifier la visite.`);return renderHerdData();}const changes=applyHerdImportToVisit(item,visit,false);showToast(`Fichier « ${importedFile} » associé uniquement à cette visite${changes.length?` · ${changes.length} rubrique(s) complétée(s)`:''}.`);renderHerdData();});
}

function renderBackup() {
  app.innerHTML = `
    <div class="section-title"><h2>Sauvegarde et administration locale</h2></div>
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

window.addEventListener('unhandledrejection', event => {
  console.error(event.reason);
  const message = event.reason?.message || String(event.reason || 'Erreur asynchrone inconnue');
  const errorBox = document.createElement('div');
  errorBox.className = 'card notice warning';
  errorBox.innerHTML = `<strong>Une erreur a été détectée.</strong><br><span class="muted">${escapeHtml(message)}</span>`;
  app.prepend(errorBox);
});



function normalizedSearchText(value=''){
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function collectSearchStrings(value, depth=0){
  if(depth>3||value===null||value===undefined)return [];
  if(['string','number','boolean'].includes(typeof value))return [String(value)];
  if(Array.isArray(value))return value.flatMap(v=>collectSearchStrings(v,depth+1));
  if(typeof value==='object')return Object.values(value).flatMap(v=>collectSearchStrings(v,depth+1));
  return [];
}
function universalSearchResults(query){
  const q=normalizedSearchText(query).trim();if(!q)return [];
  const words=q.split(/\s+/).filter(Boolean),matches=text=>{const n=normalizedSearchText(text);return words.every(w=>n.includes(w));};
  const results=[];
  db.farms.forEach(f=>{
    const hay=collectSearchStrings({name:f.name,farmer:f.farmer,commune:f.commune,farmNumber:f.farmNumber,holderNumber:f.holderNumber,notes:f.notes}).join(' ');
    if(matches(hay))results.push({kind:'Exploitation',icon:'👨‍🌾',title:f.name||'Exploitation',subtitle:[f.farmNumber,f.commune,f.farmer].filter(Boolean).join(' · '),view:'farms',farmId:f.id});
  });
  db.visits.forEach(v=>{
    const farm=farmName(v.farmId),hay=collectSearchStrings({farm,date:v.date,type:v.type,technician:v.technician,objective:v.objective,notes:v.notes,conclusion:v.visitConclusion}).join(' ');
    if(matches(hay))results.push({kind:'Visite',icon:'📅',title:`${farm} — ${formatDate(v.date)}`,subtitle:[v.type,v.technician].filter(Boolean).join(' · '),view:'visits',visitId:v.id});
    (v.subjects||[]).forEach(s=>{
      const shay=collectSearchStrings(s).join(' ');
      if(matches(shay))results.push({kind:'Animal / sujet',icon:'🐄',title:s.identifier||s.tag||s.name||s.category||'Sujet',subtitle:`${farm} · ${formatDate(v.date)} · ${s.category||''}`,view:'animals',visitId:v.id,subjectId:s.id});
    });
    (v.photos||[]).forEach((ph,i)=>{
      if(matches(collectSearchStrings({comment:ph.comment,subjectId:ph.subjectId}).join(' ')))results.push({kind:'Photo',icon:'📷',title:ph.comment||`Photo ${i+1}`,subtitle:`${farm} · ${formatDate(v.date)}`,view:'photos',visitId:v.id});
    });
  });
  const themes=[...plancheGroups,...measurementFamilies.map(x=>({id:x[0],title:x[1],subtitle:'Mesures et repères'}))];
  themes.forEach(t=>{if(matches(`${t.title} ${t.subtitle||''}`))results.push({kind:'Bibliothèque',icon:'📚',title:t.title,subtitle:t.subtitle||'',view:t.id&&plancheGroups.some(g=>g.id===t.id)?'planches':'analysis',plancheId:t.id});});
  return results.slice(0,40);
}
function openUniversalSearch(){
  document.querySelector('.global-search-overlay')?.remove();
  const overlay=document.createElement('div');overlay.className='global-search-overlay';
  overlay.innerHTML=`<section class="global-search-panel"><div class="global-search-head"><div><strong>🔎 Recherche dans l’application</strong><small>Exploitation, EDE, commune, visite, animal, commentaire, photo ou fiche technique.</small></div><button type="button" aria-label="Fermer">×</button></div><input id="global-search-input" type="search" autocomplete="off" placeholder="Ex. 65000001, BOH, Dupont, Tarbes…"><div id="global-search-results" class="global-search-results"><div class="empty compact">Saisissez au moins un mot.</div></div></section>`;
  document.body.appendChild(overlay);
  const input=overlay.querySelector('#global-search-input'),box=overlay.querySelector('#global-search-results');
  const close=()=>overlay.remove();overlay.querySelector('.global-search-head button').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close();};
  const renderResults=()=>{const results=universalSearchResults(input.value);box.innerHTML=input.value.trim()?results.length?results.map((r,i)=>`<button class="global-search-result" data-search-index="${i}"><span>${r.icon}</span><span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.kind)}${r.subtitle?` · ${escapeHtml(r.subtitle)}`:''}</small></span><b>›</b></button>`).join(''):'<div class="empty compact">Aucun résultat.</div>':'<div class="empty compact">Saisissez au moins un mot.</div>';box.querySelectorAll('[data-search-index]').forEach(b=>b.onclick=()=>{const r=results[Number(b.dataset.searchIndex)];if(r.visitId)setActiveVisit(r.visitId);if(r.subjectId){openSubjectId=r.subjectId;focusedAnalysisSubjectId=r.subjectId;localStorage.setItem('audit-bovin-focused-analysis-subject',r.subjectId);}if(r.plancheId&&r.view==='planches'){activePlanche=r.plancheId;localStorage.setItem('audit-bovin-active-planche',r.plancheId);}close();setView(r.view);});};
  input.oninput=renderResults;setTimeout(()=>input.focus(),50);
}
function initGlobalSearch(){
  const header=document.querySelector('.app-header');if(!header||document.getElementById('global-search-button'))return;
  let tools=header.querySelector('.header-tools');if(!tools){tools=document.createElement('div');tools.className='header-tools';const version=header.querySelector('.version');if(version)header.insertBefore(tools,version);else header.appendChild(tools);}
  const btn=document.createElement('button');btn.id='global-search-button';btn.className='global-search-button';btn.type='button';btn.textContent='🔎 Rechercher';btn.onclick=openUniversalSearch;tools.prepend(btn);
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openUniversalSearch();}});
}


// V14.4 — Registre bovins et module Reproduction
function cleanCsvCell(value='') {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().replace(/^="(.*)"$/s, '$1').replace(/^"(.*)"$/s, '$1').trim();
}
function parseRegistryFrenchDate(value='') {
  const v=cleanCsvCell(value); if(!v)return '';
  const m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';
}
function parseSemicolonCsv(text='') {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c==='"' && quoted && n==='"'){cell+='"';i++;continue;}
    if(c==='"'){quoted=!quoted;cell+=c;continue;}
    if(c===';'&&!quoted){row.push(cleanCsvCell(cell));cell='';continue;}
    if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cleanCsvCell(cell));cell='';if(row.some(x=>x!==''))rows.push(row);row=[];continue;}
    cell+=c;
  }
  if(cell||row.length){row.push(cleanCsvCell(cell));if(row.some(x=>x!==''))rows.push(row);}
  return rows;
}
function normalizeAnimalId(value=''){return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^FR/,'FR');}
function animalDigits(value=''){return normalizeAnimalId(value).replace(/^[A-Z]+/,'');}
function monthsBetweenDates(a,b){if(!a||!b)return null;const d1=new Date(a+'T12:00:00'),d2=new Date(b+'T12:00:00');if(isNaN(d1)||isNaN(d2))return null;return Math.round(((d2-d1)/86400000)/30.4375*10)/10;}
function daysBetweenDates(a,b){if(!a||!b)return null;const d1=new Date(a+'T12:00:00'),d2=new Date(b+'T12:00:00');if(isNaN(d1)||isNaN(d2))return null;return Math.round((d2-d1)/86400000);}
function ageLabelAt(birthDate,atDate){const m=monthsBetweenDates(birthDate,atDate||new Date().toISOString().slice(0,10));if(m===null)return '';if(m<24)return `${Math.floor(m)} mois`;const y=Math.floor(m/12),rm=Math.round(m-y*12);return `${y} an${y>1?'s':''}${rm?` ${rm} mois`:''}`;}
function resolveRegistryAnimal(farm,query){
  const list=farm?.herdRegistry||[],raw=String(query||'').trim(),q=normalizeAnimalId(raw),digits=String(raw).replace(/\D/g,'');if(!q&&!digits)return null;
  // 1) Priorité au numéro complet puis au numéro de travail exact.
  let items=list.filter(a=>normalizeAnimalId(a.id)===q);
  if(items.length===1)return {animal:items[0],matchType:'id'};
  if(items.length>1)return {ambiguous:true,items,matchType:'id'};
  items=list.filter(a=>normalizeAnimalId(a.workNumber)===q||(digits&&String(a.workNumber||'').replace(/\D/g,'')===digits));
  if(items.length===1)return {animal:items[0],matchType:'work'};
  if(items.length>1)return {ambiguous:true,items,matchType:'work'};
  // 2) En dernier recours, accepte la fin du numéro national si elle est assez discriminante.
  if(digits&&digits.length>=3){items=list.filter(a=>animalDigits(a.id).endsWith(digits));}
  if(items.length===1)return {animal:items[0],matchType:'suffix'};
  if(items.length>1)return {ambiguous:true,items,matchType:'suffix'};
  return null;
}
function reproductionForCow(farm,cowId){
  const list=farm?.herdRegistry||[],key=normalizeAnimalId(cowId),cow=list.find(a=>normalizeAnimalId(a.id)===key);
  const calves=list.filter(a=>normalizeAnimalId(a.motherId)===key&&a.birthDate).sort((a,b)=>a.birthDate.localeCompare(b.birthDate));
  const dates=[...new Set(calves.map(a=>a.birthDate))].sort(); const intervals=[];for(let i=1;i<dates.length;i++){const d=daysBetweenDates(dates[i-1],dates[i]);if(d!==null)intervals.push(d);}
  const deadBefore6=calves.filter(c=>c.exitCause==='M'&&c.exitDate&&daysBetweenDates(c.birthDate,c.exitDate)!==null&&daysBetweenDates(c.birthDate,c.exitDate)<183);
  const first=calves[0]||null,last=calves.at(-1)||null; const firstAge=cow&&first?monthsBetweenDates(cow.birthDate,first.birthDate):null;
  const mean=intervals.length?Math.round(intervals.reduce((a,b)=>a+b,0)/intervals.length):null;
  return {cow,calves,calvingDates:dates,intervals,firstCalvingDate:first?.birthDate||'',lastCalvingDate:last?.birthDate||'',firstCalvingAgeMonths:firstAge,lastCalf:last,lastIVV:intervals.at(-1)??null,meanIVV:mean,minIVV:intervals.length?Math.min(...intervals):null,maxIVV:intervals.length?Math.max(...intervals):null,deadBefore6,daysSinceLast:last?daysBetweenDates(last.birthDate,new Date().toISOString().slice(0,10)):null};
}
function reproductionScoreDetails(r){const lines=[];let score=100;lines.push({label:'Base',delta:0,value:'100 points'});if(r.firstCalvingAgeMonths!=null){if(r.firstCalvingAgeMonths>36){score-=20;lines.push({label:'1er vêlage après 36 mois',delta:-20,value:`${r.firstCalvingAgeMonths} mois`});}else if(r.firstCalvingAgeMonths>28){score-=8;lines.push({label:'1er vêlage entre 28 et 36 mois',delta:-8,value:`${r.firstCalvingAgeMonths} mois`});}else lines.push({label:'Âge au 1er vêlage',delta:0,value:`${r.firstCalvingAgeMonths} mois`});}else lines.push({label:'Âge au 1er vêlage non calculable',delta:0,value:'—'});if(r.meanIVV!=null){if(r.meanIVV>500){score-=30;lines.push({label:'IVV moyen > 500 j',delta:-30,value:`${r.meanIVV} j`});}else if(r.meanIVV>450){score-=20;lines.push({label:'IVV moyen 451–500 j',delta:-20,value:`${r.meanIVV} j`});}else if(r.meanIVV>400){score-=10;lines.push({label:'IVV moyen 401–450 j',delta:-10,value:`${r.meanIVV} j`});}else lines.push({label:'IVV moyen ≤ 400 j',delta:0,value:`${r.meanIVV} j`});}else lines.push({label:'IVV non calculable (un seul vêlage)',delta:0,value:'—'});if(r.maxIVV>730){score-=15;lines.push({label:'IVV maximum > 730 j',delta:-15,value:`${r.maxIVV} j`});}else if(r.maxIVV>500){score-=8;lines.push({label:'IVV maximum 501–730 j',delta:-8,value:`${r.maxIVV} j`});}const mortalityPenalty=Math.min(30,r.deadBefore6.length*12);if(mortalityPenalty){score-=mortalityPenalty;lines.push({label:'Veaux morts avant 6 mois',delta:-mortalityPenalty,value:`${r.deadBefore6.length} veau(x)`});}return {score:Math.max(0,Math.round(score)),lines};}
function reproductionScore(r){return reproductionScoreDetails(r).score;}
function isRegistryAnimalPresent(animal,atDate=new Date().toISOString().slice(0,10)){
  if(!animal)return false;
  return !animal.exitDate || animal.exitDate>atDate;
}
function currentReproductionCows(farm,atDate=new Date().toISOString().slice(0,10)){
  return (farm?.herdRegistry||[])
    .filter(a=>a.sex==='F'&&isRegistryAnimalPresent(a,atDate))
    .map(c=>reproductionForCow(farm,c.id))
    .filter(r=>r.calves.length>=1);
}
function importHerdRegistryRows(rows){
  if(rows.length<2)throw new Error('Fichier vide ou illisible.');
  const headers=rows[0].map(x=>normalizeSearchText(x)); const col=(...names)=>{for(const n of names){const i=headers.indexOf(normalizeSearchText(n));if(i>=0)return i;}return -1;};
  const ix={id:col('Identifiant bovin'),work:col('Numéro travail','Numero travail'),birth:col('Date naissance'),sex:col('Sexe'),breed:col('Type racial'),name:col('Nom'),mother:col('Numéro mère','Numero mere'),motherBreed:col('Type racial mère','Type racial mere'),farm:col('Exploitation'),entry:col('Date entrée','Date entree'),entryCause:col("Cause d'entrée"),exit:col('Date sortie'),exitCause:col('Cause de sortie'),father:col('Numéro père','Numero pere','Père','Pere')};
  if(ix.id<0||ix.birth<0||ix.mother<0)throw new Error('Colonnes Identifiant bovin, Date naissance ou Numéro mère introuvables.');
  return rows.slice(1).map(r=>({id:cleanCsvCell(r[ix.id]),workNumber:ix.work>=0?cleanCsvCell(r[ix.work]):'',birthDate:parseRegistryFrenchDate(r[ix.birth]),sex:ix.sex>=0?cleanCsvCell(r[ix.sex]):'',breed:ix.breed>=0?cleanCsvCell(r[ix.breed]):'',name:ix.name>=0?cleanCsvCell(r[ix.name]):'',motherId:ix.mother>=0?cleanCsvCell(r[ix.mother]):'',fatherId:ix.father>=0?cleanCsvCell(r[ix.father]):'',motherBreed:ix.motherBreed>=0?cleanCsvCell(r[ix.motherBreed]):'',farmNumber:ix.farm>=0?cleanCsvCell(r[ix.farm]):'',entryDate:ix.entry>=0?parseRegistryFrenchDate(r[ix.entry]):'',entryCause:ix.entryCause>=0?cleanCsvCell(r[ix.entryCause]):'',exitDate:ix.exit>=0?parseRegistryFrenchDate(r[ix.exit]):'',exitCause:ix.exitCause>=0?cleanCsvCell(r[ix.exitCause]):''})).filter(a=>a.id);
}
let reproductionSort=localStorage.getItem('audit-bovin-repro-sort')||'lastCalvingOld';
let reproductionFilter=localStorage.getItem('audit-bovin-repro-filter')||'all';
function reproductionRegistryPeriod(registry=[]){
  const dates=registry.flatMap(a=>[a.birthDate,a.entryDate,a.exitDate]).filter(Boolean).sort();
  return dates.length?{from:dates[0],to:dates.at(-1)}:{from:'',to:''};
}
function reproductionDefaultYearStart(periodMin='',periodMax=''){
  if(!periodMax)return periodMin||'';
  const d=new Date(periodMax+'T12:00:00');if(isNaN(d))return periodMin||'';d.setFullYear(d.getFullYear()-1);
  const iso=d.toISOString().slice(0,10);return periodMin&&iso<periodMin?periodMin:iso;
}
function reproductionSourceForVisit(visit,farm){
  if(visit&&visit.farmId===farm?.id&&Array.isArray(visit.reproductionRegistry)){
    return {registry:visit.reproductionRegistry,meta:visit.reproductionRegistrySource||null,scope:'visit'};
  }
  return {registry:farm?.herdRegistry||[],meta:farm?.herdRegistrySource||null,scope:'legacy'};
}
function renderReproduction(){
  const visit=activeVisit(),selectedFarmId=visit?.farmId||localStorage.getItem('audit-bovin-repro-farm')||db.farms[0]?.id||'',farm=db.farms.find(f=>f.id===selectedFarmId),source=reproductionSourceForVisit(visit,farm),registry=source.registry||[],meta=source.meta;
  if(!farm){app.innerHTML='<section class="card empty">Créez une exploitation avant d’utiliser la reproduction.</section>';return;}
  const reproFarm={...farm,herdRegistry:registry};
  const fullPeriod=reproductionRegistryPeriod(registry),periodMin=meta?.period?.from||fullPeriod.from||'',periodMax=meta?.period?.to||fullPeriod.to||new Date().toISOString().slice(0,10);
  const periodKey=`audit-bovin-repro-period-${visit?.id||selectedFarmId||'default'}`;
  let saved={};try{saved=JSON.parse(localStorage.getItem(periodKey)||'{}')||{}}catch(_){saved={};}
  const defaultYearStart=reproductionDefaultYearStart(periodMin,periodMax);let periodStart=saved.start||defaultYearStart,periodEnd=saved.end||periodMax;
  if(periodMin&&periodStart<periodMin)periodStart=periodMin;if(periodMax&&periodEnd>periodMax)periodEnd=periodMax;if(periodStart&&periodEnd&&periodStart>periodEnd){periodStart=periodMin;periodEnd=periodMax;}
  const analysisDate=periodEnd||new Date().toISOString().slice(0,10);
  const presentFemales=registry.filter(a=>a.sex==='F'&&isRegistryAnimalPresent(a,analysisDate)),currentCows=currentReproductionCows(reproFarm,analysisDate),cowIds=new Set(currentCows.map(r=>normalizeAnimalId(r.cow.id))),breeding24=presentFemales.filter(a=>monthsBetweenDates(a.birthDate,analysisDate)>24),breeding36=presentFemales.filter(a=>monthsBetweenDates(a.birthDate,analysisDate)>36),presentHeifers=breeding24.filter(a=>!cowIds.has(normalizeAnimalId(a.id)));
  const intervalEvents=currentCows.flatMap(r=>r.intervals.map((v,i)=>({v,date:r.calvingDates[i+1]||''}))).filter(e=>e.date&&(!periodStart||e.date>=periodStart)&&(!periodEnd||e.date<=periodEnd)),allIvvs=intervalEvents.map(e=>e.v);
  const firstIvvs=currentCows.map(r=>({v:r.intervals[0],date:r.calvingDates[1]||''})).filter(e=>e.v!=null&&e.date&&(!periodStart||e.date>=periodStart)&&(!periodEnd||e.date<=periodEnd)).map(e=>e.v);
  const allCalves=currentCows.flatMap(r=>r.calves).filter(c=>c.birthDate&&(!periodStart||c.birthDate>=periodStart)&&(!periodEnd||c.birthDate<=periodEnd)),deadCalves=allCalves.filter(c=>c.exitCause==='M'&&c.exitDate&&daysBetweenDates(c.birthDate,c.exitDate)<183),maleIds=new Set(registry.filter(a=>a.sex==='M').map(a=>normalizeAnimalId(a.id))),knownFather=allCalves.filter(c=>c.fatherId),probableIA=knownFather.filter(c=>!maleIds.has(normalizeAnimalId(c.fatherId)));
  const mothers=new Set(allCalves.map(c=>normalizeAnimalId(c.motherId))),ids24=new Set(breeding24.map(a=>normalizeAnimalId(a.id))),ids36=new Set(breeding36.map(a=>normalizeAnimalId(a.id))),calved24=[...mothers].filter(id=>ids24.has(id)).length,calved36=[...mothers].filter(id=>ids36.has(id)).length;
  const primipares=currentCows.filter(r=>r.calves.length===1);
  const stats={ivvMean:allIvvs.length?Math.round(allIvvs.reduce((a,b)=>a+b,0)/allIvvs.length):null,ivv12:firstIvvs.length?Math.round(firstIvvs.reduce((a,b)=>a+b,0)/firstIvvs.length):null,ivvMin:allIvvs.length?Math.min(...allIvvs):null,ivvMax:allIvvs.length?Math.max(...allIvvs):null,firstMean:(()=>{const v=currentCows.map(r=>r.firstCalvingAgeMonths).filter(x=>x!=null);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10:null})(),calvingRate24:breeding24.length?Math.round(calved24/breeding24.length*1000)/10:null,calvingRate36:breeding36.length?Math.round(calved36/breeding36.length*1000)/10:null,primipRate:currentCows.length?Math.round(primipares.length/currentCows.length*1000)/10:null};
  let rows=currentCows.slice();if(reproductionFilter==='400')rows=rows.filter(r=>r.daysSinceLast>400);if(reproductionFilter==='ivvLe400')rows=rows.filter(r=>r.meanIVV!=null&&r.meanIVV<=400);if(reproductionFilter==='ivv401to450')rows=rows.filter(r=>r.meanIVV>400&&r.meanIVV<=450);if(reproductionFilter==='ivv451to500')rows=rows.filter(r=>r.meanIVV>450&&r.meanIVV<=500);if(reproductionFilter==='ivvOver500')rows=rows.filter(r=>r.meanIVV>500);if(reproductionFilter==='dead')rows=rows.filter(r=>r.deadBefore6.length>=2);if(reproductionFilter==='under28')rows=rows.filter(r=>r.firstCalvingAgeMonths!=null&&r.firstCalvingAgeMonths<28);if(reproductionFilter==='28to36')rows=rows.filter(r=>r.firstCalvingAgeMonths>=28&&r.firstCalvingAgeMonths<=36);if(reproductionFilter==='over36')rows=rows.filter(r=>r.firstCalvingAgeMonths>36);
  const sorts={lastCalvingOld:(a,b)=>(a.lastCalvingDate||'').localeCompare(b.lastCalvingDate||''),ivvHigh:(a,b)=>(b.meanIVV||0)-(a.meanIVV||0),firstAgeHigh:(a,b)=>(b.firstCalvingAgeMonths||0)-(a.firstCalvingAgeMonths||0),deadHigh:(a,b)=>b.deadBefore6.length-a.deadBefore6.length,scoreLow:(a,b)=>reproductionScore(a)-reproductionScore(b)};rows.sort(sorts[reproductionSort]||sorts.lastCalvingOld);
  const ivvBands=[['≤ 400 j',allIvvs.filter(x=>x<=400).length],['401–450 j',allIvvs.filter(x=>x>400&&x<=450).length],['451–500 j',allIvvs.filter(x=>x>450&&x<=500).length],['> 500 j',allIvvs.filter(x=>x>500).length]];
  const sourceInfo=meta?`<div class="repro-source-card"><div class="repro-source-head"><strong>📄 CSV utilisé pour cette visite</strong><span class="repro-file">${escapeHtml(meta.fileName||'Nom non disponible')}</span></div><div class="repro-source-meta"><span class="repro-meta-pill">${meta.rowCount||registry.length} ligne(s)</span>${meta.importedAt?`<span class="repro-meta-pill">Importé le ${formatDateTime(meta.importedAt)}</span>`:''}${meta.period?.from||meta.period?.to?`<span class="repro-meta-pill">Données CSV ${meta.period?.from?formatDate(meta.period.from):'—'} → ${meta.period?.to?formatDate(meta.period.to):'—'}</span>`:''}</div><div class="repro-period-bar"><div class="field"><label>Période d’analyse</label><div class="repro-period-inputs"><input id="repro-period-start" type="date" min="${periodMin}" max="${periodMax}" value="${periodStart}"><span>→</span><input id="repro-period-end" type="date" min="${periodMin}" max="${periodMax}" value="${periodEnd}"></div></div><button class="btn secondary btn small" id="repro-period-reset" type="button">Toute la période importée</button></div></div>`:`<div class="notice warning"><strong>CSV source non identifié.</strong> Réimportez le registre une fois pour enregistrer son nom avec cette visite.</div>`;
  app.innerHTML=`<div class="section-title"><div><h2>Reproduction</h2><div class="muted">IVV, vêlages, primipares, femelles sans vêlage, mortalité des veaux et origine probable IA.</div></div><span class="badge autosave">v14.6.15</span></div>${activeVisitBanner(visit)}<section class="card repro-import-card"><div class="row"><div class="field"><label>Exploitation</label><select id="repro-farm" ${visit?'disabled':''}>${db.farms.map(f=>`<option value="${f.id}" ${f.id===selectedFarmId?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}</select></div><div class="field"><label>${meta?'Remplacer le registre bovins CSV':'Importer le registre bovins CSV'}</label><input id="repro-file" type="file" accept=".csv,text/csv"></div></div>${sourceInfo}${registry.length?`<div class="repro-summary-chips"><span>${registry.length} bovin(s) historiques</span><span>${presentFemales.length} femelle(s) présente(s)</span><span>${currentCows.length} vache(s) avec vêlage</span></div>`:'<div class="muted">Aucun registre importé pour cette visite.</div>'}</section>${!registry.length?'<section class="empty" style="margin-top:16px">Importez le fichier CSV Reproduction.</section>':`<section class="repro-kpi-grid compact"><article class="card metric"><strong>${stats.calvingRate24??'—'}%</strong><span>Taux de vêlage &gt; 24 mois</span><small>Sur la période sélectionnée</small></article><article class="card metric"><strong>${stats.calvingRate36??'—'}%</strong><span>Taux de vêlage &gt; 36 mois</span><small>Sur la période sélectionnée</small></article><article class="card metric"><strong>${primipares.length}</strong><span>Primipares</span><small>${stats.primipRate??'—'}% des vaches avec vêlage</small></article><article class="card metric"><strong>${stats.ivvMean??'—'}</strong><span>IVV moyen</span><small>En jours</small></article><article class="card metric"><strong>${stats.ivvMin??'—'}</strong><span>IVV mini</span><small>En jours</small></article><article class="card metric"><strong>${stats.ivvMax??'—'}</strong><span>IVV maxi</span><small>En jours</small></article><article class="card metric"><strong>${stats.ivv12??'—'}</strong><span>IVV1–IVV2 moyen</span><small>En jours</small></article><article class="card metric"><strong>${stats.firstMean??'—'}</strong><span>Âge moyen au 1er vêlage</span><small>En mois</small></article><article class="card metric"><strong>${presentHeifers.length}</strong><span>Femelles &gt; 24 mois sans vêlage</span><small>À la fin de la période</small></article><article class="card metric"><strong>${allCalves.length?Math.round(deadCalves.length/allCalves.length*1000)/10:'—'}%</strong><span>Mortalité veaux &lt; 6 mois</span><small>${deadCalves.length}/${allCalves.length} veaux</small></article><article class="card metric"><strong>${knownFather.length?probableIA.length:'—'}</strong><span>Veaux probablement issus d’IA</span><small>${knownFather.length?`${Math.round(probableIA.length/knownFather.length*1000)/10}% des pères renseignés`:'Colonne père absente ou vide'}</small></article></section><section class="card repro-ivv-card"><h3>Répartition des IVV sur la période sélectionnée</h3><div class="ivv-band-grid">${ivvBands.map(([l,n])=>`<div><strong>${n}</strong><span>${l}</span></div>`).join('')}</div></section><section class="card"><div class="row"><div class="field"><label>Filtre <span class="badge">${rows.length}</span></label><select id="repro-filter"><option value="all">Toutes les vaches présentes</option><option value="400">Sans vêlage depuis plus de 400 j</option><option value="ivvLe400">IVV moyen ≤ 400 j</option><option value="ivv401to450">IVV moyen 401–450 j</option><option value="ivv451to500">IVV moyen 451–500 j</option><option value="ivvOver500">IVV moyen &gt; 500 j</option><option value="dead">Au moins 2 veaux morts avant 6 mois</option><option value="under28">1er vêlage avant 28 mois</option><option value="28to36">1er vêlage 28–36 mois</option><option value="over36">1er vêlage après 36 mois</option></select></div><div class="field"><label>Classement</label><select id="repro-sort"><option value="lastCalvingOld">Dernier vêlage le plus ancien</option><option value="ivvHigh">IVV moyen le plus élevé</option><option value="firstAgeHigh">1er vêlage le plus tardif</option><option value="deadHigh">Mortalité veaux la plus élevée</option><option value="scoreLow">Score le plus faible</option></select></div></div><div class="muted repro-filter-count"><strong>${rows.length}</strong> vache(s) correspondent au filtre sur ${currentCows.length}.</div><div class="table-wrap"><table><thead><tr><th>Vache</th><th>Âge / race</th><th>1er vêlage</th><th>Dernier vêlage</th><th>IVV complet</th><th>Veaux</th><th>Score</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.cow.workNumber||r.cow.id)}</strong>${r.cow.name?`<br><span class="repro-cow-name">${escapeHtml(r.cow.name)}</span>`:''}<br><small>${escapeHtml(r.cow.id)}</small></td><td>${ageLabelAt(r.cow.birthDate,analysisDate)||'—'}<br><small>Race ${escapeHtml(r.cow.breed||'—')}</small></td><td>${r.firstCalvingDate?formatDate(r.firstCalvingDate):'—'}<br><small>${r.firstCalvingAgeMonths!=null?`${r.firstCalvingAgeMonths} mois`:'—'}</small></td><td>${r.lastCalvingDate?formatDate(r.lastCalvingDate):'—'}<br><small>${r.daysSinceLast??'—'} j</small></td><td>Moy. ${r.meanIVV??'—'} · mini ${r.minIVV??'—'} · maxi ${r.maxIVV??'—'}<br><small>${r.intervals.length?r.intervals.join(' / ')+' j':'Un seul vêlage'}</small></td><td>${r.calves.length}<br><small>${r.deadBefore6.length} mort(s) &lt;6 mois</small></td><td><button class="badge ${reproductionScore(r)>=75?'complete':reproductionScore(r)>=60?'in-progress':'danger'}" data-repro-score="${escapeHtml(r.cow.id)}">${reproductionScore(r)}/100</button></td><td><button class="btn small" data-repro-detail="${escapeHtml(r.cow.id)}">Voir</button></td></tr>`).join('')||'<tr><td colspan="8">Aucun animal correspondant.</td></tr>'}</tbody></table></div></section><section class="card"><div class="section-title"><div><h3>Femelles de plus de 24 mois présentes sans vêlage</h3><div class="muted">Les génisses plus jeunes ne sont pas comptées dans cette alerte.</div></div><span class="badge">${presentHeifers.length}</span></div>${presentHeifers.length?`<div class="table-wrap"><table><thead><tr><th>Femelle</th><th>Date de naissance</th><th>Âge</th><th>Race</th><th>Alerte</th></tr></thead><tbody>${presentHeifers.map(g=>{const age=monthsBetweenDates(g.birthDate,analysisDate);return `<tr><td><strong>${escapeHtml(g.workNumber||g.id)}</strong>${g.name?`<br><span class="repro-cow-name">${escapeHtml(g.name)}</span>`:''}<br><small>${escapeHtml(g.id)}</small></td><td>${g.birthDate?formatDate(g.birthDate):'—'}</td><td>${ageLabelAt(g.birthDate,analysisDate)||'—'}</td><td>${escapeHtml(g.breed||'—')}</td><td>${age!=null&&age>36?'<span class="badge danger">Plus de 36 mois</span>':age!=null&&age>28?'<span class="badge in-progress">À surveiller</span>':'<span class="badge">24–28 mois</span>'}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">Aucune femelle de plus de 24 mois présente sans vêlage.</div>'}</section><section id="repro-detail"></section>`}`;
  const fs=document.getElementById('repro-farm');if(fs&&!visit)fs.onchange=()=>{localStorage.setItem('audit-bovin-repro-farm',fs.value);renderReproduction()};
  const fi=document.getElementById('repro-file');if(fi)fi.onchange=async()=>{const file=fi.files?.[0];if(!file)return;try{const animals=importHerdRegistryRows(parseSemicolonCsv(await file.text())),importedAt=new Date().toISOString(),period=reproductionRegistryPeriod(animals);const targetNumber=normalizeHerdNumber(farm?.farmNumber||farm?.herdNumber||farm?.ede||'');const fileNumbers=[...new Set(animals.map(a=>normalizeHerdNumber(a.farmNumber||'')).filter(Boolean))];if(targetNumber&&fileNumbers.length&&!fileNumbers.includes(targetNumber))throw new Error(`ce registre appartient à l’exploitation ${fileNumbers.join(', ')} et non à ${targetNumber}`);if(visit){visit.reproductionRegistry=JSON.parse(JSON.stringify(animals));visit.reproductionRegistrySource={fileName:file.name,importedAt,rowCount:animals.length,period,farmId:visit.farmId,farmNumber:targetNumber};visit.updatedAt=importedAt;}else{farm.herdRegistry=JSON.parse(JSON.stringify(animals));farm.herdRegistryImportedAt=importedAt;farm.herdRegistrySource={fileName:file.name,importedAt,rowCount:animals.length,period,farmNumber:targetNumber};}saveDatabase(db);localStorage.removeItem(periodKey);showToast(`${animals.length} bovin(s) importé(s) uniquement pour ${visit?'cette visite':'cette exploitation'}.`);renderReproduction()}catch(e){showToast(`Import impossible : ${e.message}`)}};
  const ps=document.getElementById('repro-period-start'),pe=document.getElementById('repro-period-end'),pr=document.getElementById('repro-period-reset');
  const updatePeriod=()=>{const start=ps?.value||periodMin,end=pe?.value||periodMax;if(start&&end&&start>end){showToast('La date de début doit être antérieure à la date de fin.');return;}localStorage.setItem(periodKey,JSON.stringify({start,end}));renderReproduction();};if(ps)ps.onchange=updatePeriod;if(pe)pe.onchange=updatePeriod;if(pr)pr.onclick=()=>{localStorage.setItem(periodKey,JSON.stringify({start:periodMin,end:periodMax}));renderReproduction();};
  const filter=document.getElementById('repro-filter');if(filter){filter.value=reproductionFilter;filter.onchange=()=>{reproductionFilter=filter.value;localStorage.setItem('audit-bovin-repro-filter',reproductionFilter);renderReproduction()}};const sort=document.getElementById('repro-sort');if(sort){sort.value=reproductionSort;sort.onchange=()=>{reproductionSort=sort.value;localStorage.setItem('audit-bovin-repro-sort',reproductionSort);renderReproduction()}};
  app.querySelectorAll('[data-repro-score]').forEach(b=>b.onclick=()=>{const r=reproductionForCow(reproFarm,b.dataset.reproScore),d=reproductionScoreDetails(r),box=document.getElementById('repro-detail');box.innerHTML=`<section class="card"><h3>Détail du score · ${escapeHtml(r.cow.workNumber||r.cow.id)}${r.cow.name?` · ${escapeHtml(r.cow.name)}`:''}</h3><div class="table-wrap"><table><tbody>${d.lines.map(x=>`<tr><td>${escapeHtml(x.label)}</td><td>${escapeHtml(x.value)}</td><td>${x.delta}</td></tr>`).join('')}</tbody></table></div></section>`;box.scrollIntoView({behavior:'smooth'})});
  app.querySelectorAll('[data-repro-detail]').forEach(b=>b.onclick=()=>{const r=reproductionForCow(reproFarm,b.dataset.reproDetail),box=document.getElementById('repro-detail');box.innerHTML=`<section class="card"><h3>${escapeHtml(r.cow.workNumber||r.cow.id)}${r.cow.name?` · ${escapeHtml(r.cow.name)}`:''} — historique complet</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Veau</th><th>Père</th><th>Sortie</th><th>IVV précédent</th></tr></thead><tbody>${r.calves.map((c,i)=>`<tr><td>${formatDate(c.birthDate)}</td><td>${escapeHtml(c.workNumber||c.id)}</td><td>${escapeHtml(c.fatherId||'Non renseigné')}</td><td>${escapeHtml(c.exitCause||'Présent')}</td><td>${i?r.intervals[i-1]+' j':'—'}</td></tr>`).join('')}</tbody></table></div></section>`;box.scrollIntoView({behavior:'smooth'})});
}
window.addEventListener('pagehide',()=>{const v=activeVisit();if(v?.id){try{syncVisibleAnalysisInputs(v.id);flushAnalysisSave(v.id);}catch(_){}}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){const v=activeVisit();if(v?.id){try{syncVisibleAnalysisInputs(v.id);flushAnalysisSave(v.id);}catch(_){}}}});

function applyWorkMode(mode){
  const normalized=mode==='terrain'?'terrain':'bureau';
  document.body.classList.toggle('terrain-mode',normalized==='terrain');
  localStorage.setItem('audit-bovin-work-mode',normalized);
  const b=document.getElementById('work-mode-toggle');
  if(b){
    b.textContent=normalized==='terrain'?'🖥️ Passer en mode Bureau':'📱 Passer en mode Terrain';
    b.setAttribute('aria-pressed',normalized==='terrain'?'true':'false');
    b.title=normalized==='terrain'?'Afficher tous les modules et bilans':'Simplifier l’interface pour la saisie sur le terrain';
  }
}
function initWorkMode(){
  const header=document.querySelector('.app-header');
  if(!header)return;
  let tools=header.querySelector('.header-tools');
  if(!tools){
    tools=document.createElement('div');
    tools.className='header-tools';
    const version=header.querySelector('.version');
    if(version)header.insertBefore(tools,version);else header.appendChild(tools);
  }
  let button=document.getElementById('work-mode-toggle');
  if(!button){
    button=document.createElement('button');
    button.id='work-mode-toggle';
    button.className='work-mode-toggle';
    button.type='button';
    tools.appendChild(button);
  }
  button.onclick=()=>applyWorkMode(document.body.classList.contains('terrain-mode')?'bureau':'terrain');
  applyWorkMode(localStorage.getItem('audit-bovin-work-mode')||'bureau');
}
window.addEventListener('pagehide',()=>{if(analysisSaveTimer){try{flushAnalysisSave(activeVisit()?.id);}catch(_){}}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&analysisSaveTimer){try{flushAnalysisSave(activeVisit()?.id);}catch(_){}}});
initWorkMode();
initGlobalSearch();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=14.6.15',{updateViaCache:'none'}).then(r=>r.update()).catch(console.error);
render();
