/**
 * Correspondance entre les attributs d'un bloc de plan et les champs d'une table (sans DOM : testable seul).
 */

// « 223,15 » ou « 223.15 » -> 223.15 ; renvoie null si le texte n'est pas un nombre.
export function parseNumber(s) {
    var t = String(s === undefined || s === null ? '' : s).trim().replace(',', '.');
    if (!/^[-+]?\d+(\.\d+)?$/.test(t)) { return null; }
    return parseFloat(t);
}

// Valeurs que la topographie laisse quand la mesure n'est pas possible : rien à écrire dans la table.
export function isBlank(s) {
    var t = String(s === undefined || s === null ? '' : s).trim().toUpperCase();
    return t === '' || t === 'NR' || t === 'N/R' || t === 'NC' || t === '-' || t === '?';
}

// « REGARD=idregard;RADIER=z_radier » -> { REGARD: 'idregard', RADIER: 'z_radier' }
export function parseSpec(text) {
    var out = {};
    String(text || '').split(/[;\n]/).forEach(function (part) {
        var m = /^\s*([^=\s]+)\s*=\s*(\S+)\s*$/.exec(part);
        if (m) { out[m[1].toUpperCase()] = m[2]; }
    });
    return out;
}

function _norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Radicaux cherchés dans le nom du champ, par attribut des blocs Covadis du marché de topographie.
var _SYNONYMS = {
    REGARD: ['idregard', 'numregard', 'noregard', 'regard', 'idouvrage', 'numero', 'ident'],
    RADIER: ['radier', 'zradier', 'coteradier'],
    TAMPON: ['tampon', 'ztampon', 'cotetampon', 'ztn', 'coteter'],
    PROFOND: ['profond', 'prof'],
    MAT: ['materiau', 'mat'],
    DIAM: ['diametre', 'diam']
};

// Champ de la table qui correspond le mieux à un attribut, ou '' : nom identique, puis radicaux connus.
export function suggestField(tag, fields) {
    var t = _norm(tag), norms = fields.map(function (f) { return [f, _norm(f)]; }), i, j;
    for (i = 0; i < norms.length; i++) { if (norms[i][1] === t) { return norms[i][0]; } }
    var syn = _SYNONYMS[String(tag).toUpperCase()] || [t];
    for (j = 0; j < syn.length; j++) {
        for (i = 0; i < norms.length; i++) { if (norms[i][1] === syn[j]) { return norms[i][0]; } }
    }
    for (j = 0; j < syn.length; j++) {
        for (i = 0; i < norms.length; i++) { if (syn[j].length >= 4 && norms[i][1].indexOf(syn[j]) >= 0) { return norms[i][0]; } }
    }
    return '';
}

// mapping de départ : la correspondance de configuration d'abord, puis le choix automatique pour les attributs restants.
export function initialMapping(tags, fields, spec, saved) {
    var out = {};
    tags.forEach(function (tag) {
        var f = (saved && saved[tag]) || (spec && spec[tag.toUpperCase()]) || suggestField(tag, fields);
        out[tag] = fields.indexOf(f) >= 0 ? f : '';
    });
    return out;
}

// Valeurs du formulaire d'un bloc : { champ: valeur }. Les mesures « NR »/vides sont omises. Un champ dont le modèle
// (squelette de la fiche) est un nombre reçoit un nombre.
export function formValues(attrs, mapping, sample) {
    var out = {};
    Object.keys(mapping).forEach(function (tag) {
        var field = mapping[tag];
        if (!field || !(tag in attrs) || isBlank(attrs[tag])) { return; }
        out[field] = attrs[tag];
    });
    return coerce(out, sample);
}

export function coerce(values, sample) {
    var out = {};
    Object.keys(values).forEach(function (k) {
        var v = values[k];
        if (isBlank(v)) { return; }
        if (sample && typeof sample[k] === 'number') {
            var n = parseNumber(v);
            if (n === null) { return; }
            out[k] = n;
        } else {
            out[k] = String(v).trim();
        }
    });
    return out;
}

// Champs numériques de la table dont la valeur saisie n'est pas un nombre : [champ, ...].
export function invalidNumbers(values, sample) {
    return Object.keys(values).filter(function (k) {
        return sample && typeof sample[k] === 'number' && !isBlank(values[k]) && parseNumber(values[k]) === null;
    });
}
