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
    id:'energy-balance', axis:'metabolism', title:'Mobilisation énergétique / déficit d’apport à approfondir',
    summary:'L’association de BOH élevés, glycémies basses, NEC faibles ou remplissages ruminaux insuffisants peut être compatible avec une mobilisation accrue des réserves ou une ingestion ne couvrant pas les besoins. Le stade physiologique et la dynamique du lot restent déterminants.',
    mechanism:'Quand l’énergie ingérée ou utilisable ne couvre pas les besoins, l’animal mobilise ses réserves corporelles. Le BOH peut alors augmenter, tandis que la glycémie, la NEC, la musculature ou le remplissage ruminal peuvent évoluer de façon cohérente ou parfois discordante.',
    causes:['Ingestion insuffisante ou irrégulière','Transition alimentaire trop rapide','Densité énergétique inadaptée au stade physiologique','Compétition au cornadis ou accès limité à la ration','Qualité ou conservation du fourrage à vérifier','Autre facteur limitant : eau, confort, douleur ou maladie'],
    checks:['Confronter BOH, glycémie, NEC et stade physiologique','Vérifier l’ingestion réelle, le tri et le remplissage ruminal','Contrôler la transition et la densité énergétique de la ration','Rechercher une limitation d’accès à l’eau ou au cornadis','Compléter les mesures sur un nombre représentatif de sujets']
  },
  {
    id:'intestinal-imbalance', axis:'digestion', title:'Déséquilibre digestif / intestinal possible',
    summary:'Des bouses liquides, collantes, riches en grains ou en fibres longues, associées à des pH ou redox fécaux hors repère, peuvent traduire une digestion incomplète, un transit accéléré ou des fermentations déséquilibrées. Cette piste doit être rapprochée du tamis, de la ration et des transitions.',
    mechanism:'Une ration trop fermentescible, insuffisamment structurée, mal mélangée ou distribuée de façon irrégulière peut modifier les fermentations ruminales et intestinales. À l’inverse, des fibres peu digestibles ou un transit trop rapide peuvent laisser des particules visibles dans les bouses.',
    causes:['Fibres efficaces insuffisantes','Excès d’amidon ou de sucres rapidement fermentescibles','Tri de la ration ou mélange hétérogène','Transition alimentaire trop rapide','Fourrage mal conservé ou échauffé','Eau ou sel limitants pouvant modifier ingestion et transit','Parasites ou autre cause sanitaire à exclure selon le contexte'],
    checks:['Confronter les bouses au tamis et au remplissage ruminal','Vérifier la structure physique et l’homogénéité de la ration','Observer le tri, les refus et l’ordre de distribution','Contrôler la qualité de conservation des fourrages','Rechercher un changement récent de ration ou de silo','Si le contexte le justifie, compléter par copro ou avis vétérinaire']
  },
  {
    id:'water-access', axis:'water', title:'Eau possiblement limitante',
    summary:'Des urines concentrées ou foncées, associées à des débits faibles, une mauvaise accessibilité ou une forte concurrence, peuvent être compatibles avec une consommation d’eau insuffisante. Aucun de ces éléments ne permet, seul, d’attribuer la cause.',
    mechanism:'Une disponibilité insuffisante en eau peut réduire l’ingestion, concentrer les urines, modifier les bouses et accentuer les effets de la chaleur. L’impact dépend du nombre d’animaux, de la température, du stade physiologique et de la qualité de l’eau.',
    causes:['Débit insuffisant','Nombre de points d’eau insuffisant','Hauteur ou position inadaptée','Concurrence ou accès difficile','Eau sale, chaude ou peu appétente','Problème de réseau, pression ou gel','Courant parasite à proximité du point d’eau'],
    checks:['Mesurer plusieurs débits représentatifs','Vérifier propreté, hauteur, accessibilité et concurrence','Contrôler le nombre d’animaux desservis par point d’eau','Confronter aux conditions météorologiques et au lot','Vérifier qualité de l’eau et courants parasites si nécessaire']
  },
  {
    id:'salt-deficiency', axis:'feeding', title:'Apport ou accès au sel à vérifier',
    summary:'Un accès au sel absent, irrégulier ou mal réparti peut contribuer à une consommation d’eau ou d’aliment moins régulière et à des déséquilibres minéraux. Cette piste doit être interprétée avec la ration, la minéralisation et les observations du lot.',
    mechanism:'Le sodium participe à l’équilibre hydrique et à plusieurs fonctions physiologiques. Un apport insuffisant ou un accès inégal peut favoriser léchage, pica, irrégularité de consommation ou moindre appétence, mais ces signes restent peu spécifiques.',
    causes:['Absence de pierre ou de sel libre-service','Nombre de points de sel insuffisant','Sel inaccessible ou mal placé','Apport théorique non réellement consommé','Ration ou eau à forte teneur en certains minéraux','Transition ou changement récent de minéral'],
    checks:['Vérifier présence, accessibilité et consommation réelle du sel','Contrôler la composition du minéral et les quantités distribuées','Observer pica, léchage, appétence et comportement au point d’eau','Confronter avec sodium, potassium et qualité des fourrages si disponibles']
  },
  {
    id:'urine-balance', axis:'metabolism', title:'Équilibre acido-basique et minéral à remettre dans son contexte',
    summary:'Des pH ou redox urinaires hors repère peuvent être liés à la ration, à la minéralisation, aux fourrages et au stade physiologique. Ils doivent être interprétés avec le sang, les bouses, l’eau et les pratiques alimentaires.',
    mechanism:'Les urines reflètent en partie l’équilibre acido-basique, minéral et hydrique. Le pH et le redox peuvent varier avec la composition de la ration, le BACA, le potassium, le sodium, le chlore, le soufre, l’eau et le moment du prélèvement.',
    causes:['Ration riche en potassium ou déséquilibrée en minéraux','Minéralisation inadaptée au stade physiologique','Apport de sel insuffisant ou excessif','Fourrages à composition minérale atypique','Hydratation insuffisante','Moment ou conditions de prélèvement non comparables'],
    checks:['Vérifier la catégorie et le stade des sujets','Confronter pH et redox urinaires à la ration et aux minéraux','Contrôler potassium, sodium, chlore et soufre des fourrages si disponibles','Vérifier accès à l’eau et au sel','Contrôler la représentativité et les conditions de prélèvement']
  },
  {
    id:'nitrogen-balance', axis:'feeding', title:'Équilibre azote–énergie à vérifier',
    summary:'Une urémie basse ou élevée peut être compatible avec un apport azoté insuffisant, excessif ou mal synchronisé avec l’énergie fermentescible. L’hydratation et le stade physiologique peuvent aussi influencer l’interprétation.',
    mechanism:'La valorisation de l’azote dépend de sa disponibilité et de l’énergie fermentescible au même moment. Un décalage peut conduire à une mauvaise utilisation de l’azote, à des performances décevantes ou à des rejets accrus.',
    causes:['Apport protéique insuffisant ou excessif','Azote trop soluble ou mal synchronisé avec l’énergie','Fourrage pauvre ou très riche en protéines','Ingestion irrégulière','Hydratation insuffisante','Ration théorique différente de la ration réellement consommée'],
    checks:['Confronter urémie, ration et analyses des fourrages','Vérifier les quantités réellement distribuées et consommées','Rechercher un excès d’azote soluble ou un manque d’énergie fermentescible','Contrôler hydratation et stade physiologique']
  },
  {
    id:'fiber-structure', axis:'digestion', title:'Structure physique de la ration à réévaluer',
    summary:'Un tamis défavorable, des fibres longues dans les bouses, un remplissage ruminal faible ou des bouses molles/liquides peuvent être compatibles avec une ration trop peu structurée, trop triée ou mal mélangée.',
    mechanism:'La fibre efficace stimule la mastication, la rumination et la stabilité des fermentations. Sa présence dans la ration ne garantit pas qu’elle soit réellement consommée si les animaux trient ou si le mélange est hétérogène.',
    causes:['Longueur de coupe trop courte ou trop longue','Taux de matière sèche favorisant le tri','Temps ou ordre de mélange inadapté','Distribution irrégulière ou repousse insuffisante','Place au cornadis insuffisante','Refus importants ou sélection des particules'],
    checks:['Comparer ration distribuée, refus et tamis','Observer le tri au cornadis','Vérifier ordre de chargement et temps de mélange','Contrôler longueur de coupe et matière sèche','Mesurer la place disponible au cornadis']
  },
  {
    id:'feeding-practices', axis:'feeding', title:'Conduite alimentaire à préciser',
    summary:'Les informations de ration, transition, distribution, sel et minéralisation peuvent contribuer à expliquer les écarts observés. Le moteur distingue la ration déclarée de la ration réellement consommée.',
    mechanism:'Les écarts peuvent venir autant de la formulation que de la mise en œuvre : quantités, régularité, mélange, horaires, accès, tri, refus et transitions.',
    causes:['Quantités réellement distribuées différentes du prévu','Transition trop rapide','Ordre de chargement ou mélange inadapté','Accès au sel ou au minéral insuffisant','Place au cornadis ou fréquence de repousse insuffisante','Fourrage variable ou nouveau silo'],
    checks:['Vérifier les quantités réellement distribuées','Préciser les transitions et changements récents','Observer tri, refus, repousse et concurrence','Confronter la ration aux silos, plantes et observations animales','Vérifier accès au sel, au minéral et à l’eau']
  },
  {
    id:'building-conditions', axis:'building', title:'Conditions de bâtiment à approfondir',
    summary:'Des éléments liés à la litière, l’ambiance, l’électricité, la densité ou aux équipements peuvent contribuer aux observations animales. Ils doivent être localisés et hiérarchisés.',
    mechanism:'Le confort de couchage, l’air, les courants parasites, la densité et la circulation influencent l’ingestion, le repos, la locomotion et l’expression des performances.',
    causes:['Litière humide, chaude ou insuffisamment renouvelée','Ventilation insuffisante ou courants d’air localisés','Densité excessive','Courants parasites','Accès difficile aux équipements','Sols glissants ou agressifs'],
    checks:['Localiser les points concernés sur le plan','Recontrôler les mesures anormales ou incomplètes','Observer le comportement des animaux dans les zones concernées','Prioriser les actions faciles à vérifier lors de la prochaine visite']
  },
  {
    id:'reproduction-practices', axis:'reproduction', title:'Conduite de la reproduction à documenter',
    summary:'Les réponses de l’audit peuvent faire ressortir des points de conduite à préciser. La structure du troupeau, les vaches vides, les réformes et le renouvellement doivent être rapprochés des objectifs de l’éleveur.',
    mechanism:'Les résultats de reproduction dépendent de nombreux facteurs : état corporel, nutrition, santé, détection, organisation et choix de renouvellement. Le moteur ne peut pas attribuer une cause unique.',
    causes:['État corporel ou équilibre énergétique à revoir','Détection ou suivi de reproduction irrégulier','Problèmes de taureau ou de fertilité','Conduite des génisses et âge au premier vêlage','Réformes subies plutôt que choisies','Objectifs de renouvellement non définis'],
    checks:['Vérifier les indicateurs réellement disponibles','Distinguer les pratiques habituelles des événements ponctuels','Relier les constats aux objectifs de l’éleveur','Confronter reproduction, NEC, alimentation et santé']
  }
];
