/**
 * Métiers d'un plan de récolement (sans DOM : testable seul).
 * Les calques de la charte graphique du marché de topographie s'appellent « TOPO_<Réseau>_<Thème> » : le réseau
 * donne le métier (assainissement, eau potable, éclairage public, voirie), le thème dit ce que porte le calque
 * (Symboles, Infrastructures, Tracés-souterrains…). Les blocs se nomment d'après la charte (E_U03, EAU04, ECL01, MOB02…).
 */

// Métiers proposés dans le panneau, dans l'ordre d'affichage. « Fond de plan » : thèmes du CCTP hors réseaux, décochés au départ.
export var TRADES = [
    { id: 'assainissement', label: 'Assainissement', color: '#993300' },
    { id: 'eau-potable',    label: 'Eau potable et arrosage', color: '#00a3c4' },
    { id: 'eclairage',      label: 'Éclairage public', color: '#d6006c' },
    { id: 'voirie',         label: 'Voirie et mobilier', color: '#5f6b73' },
    { id: 'reseaux-tiers',  label: 'Réseaux tiers',  color: '#7b3fa0' },
    { id: 'fond-de-plan',   label: 'Fond de plan',   color: '#8a8a8a' }
];

// Réseau de la charte -> métier, réseau et couleur. Le nom est comparé sans accents ni majuscules. Les couleurs sont celles
// de la charte, sauf le cyan, le vert et le jaune purs, assombris pour rester lisibles sur la carte.
var _NETWORKS = {
    'eaux-usees':        { trade: 'assainissement', network: 'Eaux usées',       color: '#993300' },
    'eaux-pluviales':    { trade: 'assainissement', network: 'Eaux pluviales',   color: '#0000ff' },
    'eau-unitaire':      { trade: 'assainissement', network: 'Eaux unitaires',   color: '#800080' },
    'eau-potable':       { trade: 'eau-potable',    network: 'Eau potable',      color: '#00a3c4' },
    'eau-arrosage':      { trade: 'eau-potable',    network: 'Eau d\'arrosage',  color: '#00a88f' },
    'eclairage':         { trade: 'eclairage',      network: 'Éclairage public', color: '#d6006c' },
    'voirie':            { trade: 'voirie',         network: 'Voirie',           color: '#5f6b73' },
    'mobiliers-urbains': { trade: 'voirie',         network: 'Mobilier urbain',  color: '#7d7d7d' },
    // Réseaux de concessionnaires du CCTP
    'electricite':       { trade: 'reseaux-tiers',  network: 'Électricité',      color: '#e00000' },
    'telephone':         { trade: 'reseaux-tiers',  network: 'Téléphone',        color: '#1f9d1f' },
    'fibre-optique':     { trade: 'reseaux-tiers',  network: 'Fibre optique',    color: '#1f9d1f' },
    'gaz':               { trade: 'reseaux-tiers',  network: 'Gaz',              color: '#ff6600' },
    'pipeline':          { trade: 'reseaux-tiers',  network: 'Pipeline',         color: '#ff6600' },
    'chauffage':         { trade: 'reseaux-tiers',  network: 'Chauffage urbain', color: '#b38f00' },
    'feux':              { trade: 'reseaux-tiers',  network: 'Feux tricolores',  color: '#fb410e' },
    'transport':         { trade: 'reseaux-tiers',  network: 'Transport',        color: '#a0307a' },
    'transports':        { trade: 'reseaux-tiers',  network: 'Transport',        color: '#a0307a' },
    'voies-ferrees':     { trade: 'reseaux-tiers',  network: 'Voies ferrées',    color: '#6a2fa0' },
    'reseaux-ni':        { trade: 'reseaux-tiers',  network: 'Réseaux non identifiés', color: '#757575' },
    // Thèmes du CCTP hors réseaux
    'batiments':         { trade: 'fond-de-plan',   network: 'Bâtiments',        color: '#800000' },
    'clotures':          { trade: 'fond-de-plan',   network: 'Clôtures',         color: '#a0603a' },
    'vegetation':        { trade: 'fond-de-plan',   network: 'Végétation',       color: '#3f9f3f' },
    'hydrographie':      { trade: 'fond-de-plan',   network: 'Hydrographie',     color: '#0095c8' },
    'relief':            { trade: 'fond-de-plan',   network: 'Relief',           color: '#8aa800' },
    'reperes':           { trade: 'fond-de-plan',   network: 'Repères',          color: '#c00000' },
    'points':            { trade: 'fond-de-plan',   network: 'Points levés',     color: '#888888' },
    'limites':           { trade: 'fond-de-plan',   network: 'Cadastre',         color: '#3355aa' },
    'numeros':           { trade: 'fond-de-plan',   network: 'Cadastre',         color: '#3355aa' }
};

// Ce que porte le calque, d'après son thème dans la charte
var _THEMES = {
    'Symboles': 'Ouvrages à attributs', 'Infrastructures': 'Ouvrages en affleurement', 'Infra-sous-sol': 'Éléments souterrains',
    'Tracés-souterrains': 'Tracés souterrains', 'Tracés-aériens': 'Tracés aériens', 'Textes': 'Annotations',
    'Signalisations-H': 'Signalisation horizontale', 'Signalisations-V': 'Signalisation verticale',
    'Limites-revêtements': 'Limites de revêtement'
};

// Calques de tracés de réseau, quel que soit le réseau (la charte en prévoit pour l'eau potable, l'éclairage, le gaz…)
export function isTraceTheme(theme) { return theme === 'Tracés-souterrains' || theme === 'Tracés-aériens'; }

export function themeLabel(theme) { return _THEMES[theme] || String(theme).replace(/_/g, ' ').replace(/-/g, ' '); }

function _norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

export function tradeOf(id) { return TRADES.filter(function (t) { return t.id === id; })[0] || null; }

// « TOPO_Eaux-usées_Symboles » -> { trade, network, color, theme, prefix } ; null pour un calque hors du modèle (mise en page…).
export function classify(layer) {
    var m = /^(TOPO|CAD)_([^_]+)(?:_(.+))?$/.exec(String(layer));
    if (!m) { return null; }
    var n = _NETWORKS[_norm(m[2])];
    return n ? { trade: n.trade, network: n.network, color: n.color, theme: m[3] || m[2], prefix: m[1] + '_' + m[2] } : null;
}

// Blocs de mise en forme, pas des ouvrages : flèche de sens d'écoulement et lettre/texte d'appartenance au réseau
// (numéros 96 à 99 de la charte), caractéristiques d'une canalisation (lues avec la canalisation).
export function isTechnical(block) {
    return /(?:^|_)[A-Z]*(?:96|97|98|99)$/.test(block) || /_DG_NAT\d*$/.test(block);
}

// Libellés des blocs de la charte (Charte_Graphique_AGGLO.dxf). Les blocs d'assainissement se déclinent par réseau :
// E_U (eaux usées), E_P (eaux pluviales), E_UNIT et ASS (unitaire) partagent les mêmes numéros.
var _SEWER = {
    '01': 'tampon mixte', '02': 'plaque carrée ou rectangulaire', '03': 'tampon circulaire plein', '04': 'avaloir',
    '05': 'tampon circulaire ajouré', '06': 'descente d\'eau pluviale', '07': 'grille',
    '09': 'tabouret de branchement (1 arrivée)', '10': 'tabouret de branchement (plusieurs arrivées)'
};
var _OTHER = {
    EAU01: 'bouche à clé', EAU02: 'coffret du réseau d\'eau', EAU04: 'poteau incendie', EAU05: 'borne ou point d\'eau',
    EAU08: 'équipement d\'eau potable', EAU09: 'plaque d\'eau carrée ou rectangulaire', EAU01_BAC: 'bouche à clé',
    ECL01: 'candélabre mono-branche', ECL02: 'tampon mixte d\'éclairage', ECL03: 'candélabre multi-branches', ECL04: 'lanterne',
    ECL05: 'candélabre mono-branche avec applique', ECL07: 'borne lumineuse', ECL10: 'équipement d\'éclairage',
    ECL11: 'armoire d\'éclairage public', ECL12: 'coffret d\'éclairage', ECL13: 'applique',
    MOB01: 'panneau indicateur', MOB02: 'panneau routier circulaire', MOB03: 'panneau routier triangulaire',
    MOB04: 'panneau directionnel', MOB05: 'panneau routier carré ou autre', MOB07: 'abri bus', MOB08: 'banc simple',
    MOB09: 'banc double', MOB12: 'boîte aux lettres murale', MOB13: 'horodateur', MOB15: 'poubelle suspendue',
    MOB16: 'panneau d\'affichage', MOB17: 'potelet', MOB18: 'borne escamotable', MOB19: 'borne granit', MOB20: 'borne Vélo\'v',
    MOB21: 'station Vélo\'v', MOB22: 'panneau publicitaire sur mât', MOB23: 'silo à verre', MOB24: 'barrière de sécurité piétons',
    MOB25: 'potelet d\'attache 2 roues', MOB26: 'boîte aux lettres sur socle', MOB27: 'patte d\'éléphant',
    MOB28: 'borne d\'activation de bornes escamotables', MOB30: 'borne Bluely', MOB31: 'station Bluely',
    MOB32: 'borne de récupération de textiles', MOB33: 'défibrillateur sur pied', MOB34: 'radar pédagogique', MOB35: 'panneau de basket',
    EDF01: 'support de câble EDF', EDF02: 'support de câble EDF + éclairage', EDF03: 'support de câble EDF + PTT',
    EDF04: 'support EDF + éclairage + PTT', EDF10: 'coffret EDF', EDF11: 'armoire EDF', EDF12: 'borne EDF', EDF13: 'pylône EDF',
    PTT01: 'support PTT', PTT07: 'armoire PTT', PTT09: 'borne PTT', PTT12: 'support PTT + éclairage', PTT13: 'jambage de poteau PTT',
    CAB04: 'coffret fibre optique', CAB05: 'armoire fibre optique', CAB06: 'poteau fibre optique',
    GAZ04: 'coffret gaz', GAZ06: 'armoire gaz', CH01: 'bouche à clé chauffage urbain', CH02: 'tampon circulaire chauffage urbain',
    CH03: 'tampon carré chauffage urbain', PIP01: 'bouche à clé pipeline', PIP02: 'tampon circulaire pipeline',
    PIP03: 'tampon carré pipeline', AFF02: 'coffret de réseau non identifié', AFF06: 'armoire non identifiée', AFF08: 'mât vide',
    AFF11: 'caméra de surveillance sur mât', SIL01: 'feu piétons', SIL02: 'feux tricolores', SIL03: 'feu tricolore (jambage à gauche)',
    SIL04: 'feu tricolore (jambage à droite)', SIL05: 'armoire de signalisation lumineuse', SIL08: 'feux SNCF', SIL11: 'feux tramway',
    SNCF01: 'support de caténaires SNCF', TCL01: 'support de câble d\'alimentation tramway', TCL03: 'arrêt de bus',
    TCL04: 'poteau horaire TCL solaire', TCL05: 'poteau horaire TCL simple', TCL06: 'totem de station de métro',
    TCL07: 'caténaire tram simple', TCL08: 'caténaire tram double',
    MUR03: 'pilier de mur de clôture', TOP03: 'repère de nivellement', TOP05: 'borne de propriété', VEG16: 'arbre feuillu', VEG17: 'arbre résineux',
    PTOPO: 'point levé',
    SIH06: 'marquage STOP', SIH07: 'marquage handicapé', SIH08: 'marquage vélo', SIH09: 'marquage école',
    SIH10: 'borne plastique de restriction', SIH11: 'marquage bus', SIH12: 'marquage payant', SIH13: 'marquage livraisons',
    SIH15: 'marquage piéton', SIH18: 'marquage taxi', SIH19: 'marquage 2 roues', SIH20: 'marquage zone 30'
};
var _COT = { ASS01_COT1: 'regard', ASS01_COT2: 'regard' };

// Libellé d'un bloc, ou '' s'il n'est pas connu.
export function blockLabel(block) {
    var m = /^(?:E_(?:U|P|UNIT)|ASS)(\d\d)$/.exec(block);
    if (m && _SEWER[m[1]]) { return _SEWER[m[1]]; }
    if (_COT[block]) { return _COT[block]; }
    return _OTHER[block] || '';
}

// Libellé affichable : « E_U03 — tampon circulaire plein » ou le nom brut.
export function blockTitle(block) {
    var l = blockLabel(block);
    return l ? block + ' — ' + l : block;
}

var SAME_SPOT = 0.5;   // symbole posé sur un regard : m

// Tous les objets des métiers suivis, à partir de { blocks, symbols } (dxf-blocks.parseBlocks) :
// [{ trade, network, theme, prefix, layer, block, label, x, y, rotation, attrs (null sans attribut), symbol, ref }]
// Les blocs techniques sont écartés. ref = l'entrée d'origine du plan (identité conservée). Le symbole posé sur un regard
// (type de tampon) n'est pas un objet à part : il devient `symbol` du regard.
export function listObjects(plan) {
    var out = [], regards = [];
    function make(b, c, withAttrs) {
        return { trade: c.trade, network: c.network, color: c.color, theme: c.theme, prefix: c.prefix, layer: b.layer, block: b.block,
            label: blockLabel(b.block), x: b.x, y: b.y, rotation: b.rotation, attrs: withAttrs ? b.attrs : null, symbol: null, ref: b };
    }
    plan.blocks.forEach(function (b) {
        var c = classify(b.layer);
        if (!c || isTechnical(b.block)) { return; }
        var o = make(b, c, true);
        out.push(o);
        if ('REGARD' in b.attrs) { regards.push(o); }
    });
    plan.symbols.forEach(function (s) {
        var c = classify(s.layer);
        if (!c || isTechnical(s.block)) { return; }
        if (c.theme === 'Infrastructures') {
            for (var i = 0; i < regards.length; i++) {
                var r = regards[i];
                if (r.prefix === c.prefix && Math.hypot(r.x - s.x, r.y - s.y) <= SAME_SPOT) {
                    if (!r.symbol) { r.symbol = s.block; }
                    return;
                }
            }
        }
        out.push(make(s, c, false));
    });
    return out;
}
