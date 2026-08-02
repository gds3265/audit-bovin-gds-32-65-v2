export const KNOWLEDGE_AXES = [
  { id:'metabolism', label:'Métabolisme', icon:'🩸', families:['Sang','Urines','Physique'], description:'Énergie, état corporel et cohérence avec le stade physiologique.' },
  { id:'digestion', label:'Digestion', icon:'🟤', families:['Bouses','Physique','Tamis'], description:'Bouses, remplissage ruminal et structure de la ration.' },
  { id:'water', label:'Eau', icon:'💧', families:['Urines','Bâtiment'], description:'Hydratation, débit, accessibilité et qualité de l’eau.' },
  { id:'feeding', label:'Alimentation / fourrages', icon:'🌾', families:['Alimentation','Silos','Plantes'], description:'Ration, transitions, minéralisation et qualité des fourrages.' },
  { id:'building', label:'Bâtiment', icon:'🏚️', families:['Bâtiment'], description:'Litière, ambiance, courants et points de contrôle.' },
  { id:'reproduction', label:'Reproduction / conduite', icon:'🐄', families:['Audit'], description:'Conduite du renouvellement et cohérence des pratiques.' }
];

export const KNOWLEDGE_RULES = [
  {
    id:'energy-balance', axis:'metabolism', title:'Équilibre énergétique à approfondir',
    summary:'Plusieurs résultats peuvent être compatibles avec un équilibre énergétique à approfondir. Cette piste doit être confrontée au stade physiologique, à l’ingestion et à la ration.',
    checks:['Confronter BOH, glycémie, NEC et stade physiologique','Vérifier l’ingestion réelle et la transition alimentaire','Compléter les mesures sur un nombre représentatif de sujets']
  },
  {
    id:'urine-balance', axis:'metabolism', title:'Profil urinaire à remettre dans son contexte',
    summary:'Les écarts urinaires méritent d’être rapprochés de la catégorie, de la ration, de la minéralisation et des fourrages.',
    checks:['Vérifier la catégorie et le stade des sujets','Confronter pH et redox urinaires à la ration et aux minéraux','Contrôler la représentativité du prélèvement']
  },
  {
    id:'digestion-structure', axis:'digestion', title:'Digestion et structure de ration à approfondir',
    summary:'Les observations de bouses, le remplissage ruminal et les mesures fécales peuvent justifier une vérification de la structure physique de la ration.',
    checks:['Confronter avec le tamis à bouses','Vérifier fibrosité, tri et ordre de distribution','Examiner la conservation des fourrages']
  },
  {
    id:'water-access', axis:'water', title:'Accès à l’eau / hydratation à vérifier',
    summary:'La concentration des urines ou les données des abreuvoirs peuvent inviter à vérifier l’accès à l’eau. Elles ne suffisent pas, seules, à attribuer une cause.',
    checks:['Mesurer plusieurs débits représentatifs','Vérifier propreté, hauteur, accessibilité et concurrence','Confronter aux conditions météorologiques et au lot']
  },
  {
    id:'feeding-practices', axis:'feeding', title:'Conduite alimentaire à préciser',
    summary:'Les informations de ration, transition, distribution et minéralisation peuvent contribuer à expliquer certains écarts observés.',
    checks:['Vérifier les quantités réellement distribuées','Préciser les transitions et changements récents','Confronter la ration aux silos, plantes et observations animales']
  },
  {
    id:'building-conditions', axis:'building', title:'Conditions de bâtiment à approfondir',
    summary:'Des éléments liés à la litière, l’ambiance, l’électricité ou aux équipements méritent d’être rapprochés des observations animales.',
    checks:['Localiser les points concernés sur le plan','Recontrôler les mesures anormales ou incomplètes','Prioriser les actions faciles à vérifier lors de la prochaine visite']
  },
  {
    id:'reproduction-practices', axis:'reproduction', title:'Conduite de la reproduction à documenter',
    summary:'Les réponses de l’audit peuvent faire ressortir des points de conduite à préciser, sans préjuger de leurs conséquences.',
    checks:['Vérifier les indicateurs réellement disponibles','Distinguer les pratiques habituelles des événements ponctuels','Relier les constats aux objectifs de l’éleveur']
  }
];
