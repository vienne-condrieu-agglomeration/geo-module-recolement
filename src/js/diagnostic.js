/**
 * Raisonnement sur un plan (sans DOM : testable seul) : contrôles de conformité au CCTP et à la charte, cohérence du réseau,
 * synthèse du patrimoine. Lecture seule. Une vérification { id, level, trade, network, title, detail, items } désigne les objets concernés.
 * level : 'erreur' (donnée contradictoire), 'alerte' (donnée manquante ou non conforme), 'info' (à savoir).
 */
import * as T from './trades.js';
import * as N from './network.js';
import { parseNumber, isBlank } from './mapping.js';
import { CHARTE_LAYERS } from './charte.js';

var DEPTH_TOL = 0.02;   // écart toléré entre profondeur et tampon − radier (m)

// Projection annoncée par le cartouche : « RGF93 - CC45 » -> EPSG:3945, « Lambert 93 » -> EPSG:2154 ; null si non reconnue.
export function crsOfCartouche(text) {
    var s = String(text || '').toUpperCase(), m = /CC\s*(4[2-9]|50)/.exec(s);
    if (m) { return 'EPSG:' + (3900 + parseInt(m[1], 10)); }
    return /LAMBERT[\s-]*93|\bL93\b/.test(s) ? 'EPSG:2154' : null;
}

// « BETON », « béton » -> « Béton » ; « PVC » reste en capitales : le plan écrit les matériaux de plusieurs façons.
export function normMaterial(s) {
    if (isBlank(s)) { return 'Non relevé'; }
    var t = String(s).trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    return t === 'BETON' ? 'Béton' : t;
}

function _pipeRef(pp) { return { ref: pp.ref, label: 'Canalisation ' + (pp.dg && !isBlank(pp.dg.diam) ? 'Ø' + pp.dg.diam + ' ' : '') + '(' + N.lengthOf(pp.pts).toFixed(1).replace('.', ',') + ' m)' }; }
function _regardRef(r) { return { ref: r.ref, label: String(r.id) }; }

// Réseau : contrôles et synthèse
function _checkNetwork(net, c, push) {
    var scope = { trade: c.trade, network: c.network };
    function add(id, level, title, detail, items) { if (items.length) { push(Object.assign({ id: c.prefix + ':' + id, level: level, title: title, detail: detail, items: items }, scope)); } }
    var attached = new Set();
    net.pipes.forEach(function (p) { [p.from, p.to].forEach(function (e) { if (e && e.regard !== undefined) { attached.add(e.regard); } }); });

    var counts = {};
    net.regards.forEach(function (r) { counts[r.id] = (counts[r.id] || 0) + 1; });
    add('dup', 'erreur', 'Numéro de regard en double', 'Deux regards portent le même numéro : l\'identifiant ne pourra pas servir de clé.',
        net.regards.filter(function (r) { return !isBlank(r.id) && counts[r.id] > 1; }).map(_regardRef));
    add('noid', 'alerte', 'Regard sans numéro', 'L\'attribut REGARD est vide.', net.regards.filter(function (r) { return isBlank(r.id); }).map(function (r) { return { ref: r.ref, label: 'Regard sans numéro' }; }));

    var inverted = [], depth = [], uncoted = [];
    net.regards.forEach(function (r) {
        var zt = parseNumber(r.attrs.TAMPON), zr = parseNumber(r.attrs.RADIER), p = parseNumber(r.attrs.PROFOND);
        if (zt === null || zr === null) { uncoted.push(_regardRef(r)); return; }
        if (zr > zt) { inverted.push(_regardRef(r)); return; }
        if (p !== null && Math.abs(zt - zr - p) > DEPTH_TOL) {
            depth.push({ ref: r.ref, label: r.id + ' : ' + (zt - zr).toFixed(2).replace('.', ',') + ' m calculés, ' + p.toFixed(2).replace('.', ',') + ' m relevés' });
        }
    });
    add('radier', 'erreur', 'Radier au-dessus du tampon', 'La cote du radier dépasse celle du tampon : une des deux valeurs est fausse.', inverted);
    add('depth', 'alerte', 'Profondeur incohérente', 'La profondeur relevée diffère de tampon − radier de plus de 2 cm.', depth);
    add('uncoted', 'alerte', 'Regard non coté', 'Cote du tampon ou du radier non relevée (« NR » ou vide).', uncoted);
    add('alone', 'alerte', 'Regard sans canalisation', 'Aucune extrémité de canalisation à moins de 0,5 m.', net.regards.filter(function (r, i) { return !attached.has(i); }).map(_regardRef));

    add('nodg', 'alerte', 'Canalisation sans caractéristiques', 'Aucun bloc de matériau et de diamètre posé dessus.', net.pipes.filter(function (p) { return !p.dg; }).map(_pipeRef));
    add('noflow', 'alerte', 'Sens d\'écoulement inconnu', 'Aucune flèche d\'écoulement à proximité : les fils d\'eau ne peuvent pas être attribués.', net.pipes.filter(function (p) { return !p.flow; }).map(_pipeRef));
    add('mat', 'alerte', 'Matériau ou diamètre non relevé', 'Le bloc de caractéristiques porte « NR » ou rien.', net.pipes.filter(function (p) { return p.dg && (isBlank(p.dg.mat) || isBlank(p.dg.diam)); }).map(_pipeRef));

    var against = net.pipes.filter(function (p) { return p.from && p.to && N.pipeSlope(net, p).status === 'contre-pente'; }).map(_pipeRef)
        .concat(net.segments.filter(function (s) { return s.status === 'contre-pente' && !s.doubts.length; }).map(function (s) {
            return { ref: s, label: 'Tronçon reconstitué ' + _nodeName(net, s.up) + ' → ' + _nodeName(net, s.down) + ' : ' + s.zUp.toFixed(2).replace('.', ',') + ' → ' + s.zDown.toFixed(2).replace('.', ',') };
        }));
    add('slope', 'erreur', 'Contre-pente', 'L\'eau remonterait d\'après les cotes : flèche d\'écoulement, cote, ou appariement à revoir.', against);
    add('dn', 'alerte', 'Changement de diamètre sur un tronçon reconstitué', 'Les deux amorces n\'ont pas le même diamètre : à confirmer.',
        net.segments.filter(function (s) { return s.diamDiff && !s.doubts.length; }).map(function (s) { return { ref: s, label: _nodeName(net, s.up) + ' → ' + _nodeName(net, s.down) }; }));
    add('doubt', 'info', 'Tronçon reconstitué douteux', 'Deux amorces se font face, mais le tracé direct est peu crédible : à vérifier, non compté dans le linéaire.',
        net.segments.filter(function (s) { return s.doubts.length; }).map(function (s) {
            return { ref: s, label: _nodeName(net, s.up) + ' → ' + _nodeName(net, s.down) + ' (' + Math.round(s.gap) + ' m) : ' + s.doubts.join(', ') };
        }));

    var loose = net.pipes.filter(function (p) { return !p.from !== !p.to && !p.seg; });
    if (loose.length) {
        add('loose', 'info', 'Amorce sans vis-à-vis', 'Aucune amorce alignée en face : branchement, fin de réseau, ou suite hors du plan.', loose.map(_pipeRef));
    }
    var free = net.pipes.filter(function (p) { return !p.from && !p.to; });
    add('free', 'alerte', 'Canalisation sans raccordement', 'Aucun des deux bouts n\'atteint un regard ou un symbole.', free.map(_pipeRef));
}

function _nodeName(net, ref) {
    if (ref && ref.regard !== undefined) { return String(net.regards[ref.regard].id); }
    return ref && ref.symbol ? (T.blockLabel(ref.symbol) || ref.symbol) : '?';
}

// Patrimoine d'un réseau : [{ network, trade, regards, nodes, drawn, rebuilt, segments, checked, byType: [{ mat, diam, length, count }] }]
function _stats(model) {
    return Object.keys(model.nets).map(function (prefix) {
        var net = model.nets[prefix], c = T.classify(prefix + '_Symboles'), types = {}, seen = new Set();
        function add(dg, len) {
            var mat = normMaterial(dg ? dg.mat : ''), diam = dg && !isBlank(dg.diam) ? dg.diam : 'NR', k = mat + '|' + diam;
            var e = types[k] || (types[k] = { mat: mat, diam: diam, length: 0, count: 0 });
            e.length += len; e.count++;
        }
        var probable = net.segments.filter(function (s) { return !s.doubts.length; });
        probable.forEach(function (s) {
            seen.add(s.a); seen.add(s.b);
            add({ mat: s.mat, diam: s.diam }, s.length);
        });
        net.pipes.forEach(function (p) { if (!seen.has(p)) { add(p.dg, N.lengthOf(p.pts)); } });
        var drawn = net.pipes.reduce(function (a, p) { return a + N.lengthOf(p.pts); }, 0);
        var rebuilt = probable.reduce(function (a, s) { return a + s.length; }, 0);
        return {
            network: c.network, trade: c.trade, prefix: prefix, color: c.color, regards: net.regards.length, pipes: net.pipes.length, drawn: drawn,
            segments: probable.length, doubtful: net.segments.length - probable.length, rebuilt: rebuilt,
            checked: probable.filter(function (s) { return s.status === 'ok'; }).length,
            byType: Object.keys(types).map(function (k) { return types[k]; }).sort(function (a, b) { return b.length - a.length; })
        };
    }).sort(function (a, b) { return b.drawn - a.drawn; });
}

// model : modèle de buildModel ; opts.crs : projection configurée (EPSG:xxxx). Renvoie { checks, stats, counts }.
export function diagnose(model, opts) {
    var plan = model.plan, checks = [], options = opts || {};
    function push(c) { checks.push(c); }

    // Cartouche
    var cart = plan.cartouche, general = { trade: null, network: 'Ensemble du plan' };
    if (cart && options.crs) {
        var announced = crsOfCartouche(cart.COORDONNEES);
        if (announced && announced !== options.crs) {
            push(Object.assign({ id: 'crs', level: 'erreur', title: 'Projection différente du cartouche',
                detail: 'Le cartouche annonce « ' + cart.COORDONNEES + ' » (' + announced + '), le module lit le plan en ' + options.crs + '.', items: [] }, general));
        }
    }

    // Conformité à la charte
    var used = {};
    plan.blocks.concat(plan.symbols, plan.lines, plan.texts || [], plan.hatches || []).forEach(function (e) { used[e.layer] = (used[e.layer] || 0) + 1; });
    var known = new Set(CHARTE_LAYERS);
    var off = Object.keys(used).filter(function (l) { return /^(TOPO|CAD)_/i.test(l) && !known.has(l); }).concat(Object.keys(used).filter(function (l) { return !/^(TOPO|CAD)_/i.test(l) && used[l]; }));
    if (off.length) {
        push(Object.assign({ id: 'charte', level: 'alerte', title: 'Calque hors de la charte graphique',
            detail: 'Le CCTP impose la charte. Calques concernés : ' + off.map(function (l) { return l + ' (' + used[l] + ')'; }).join(', ') + '.', items: [] }, general));
    }
    var layout = Object.keys(used).filter(function (l) { return /_Présentation_/.test(l); });
    if (layout.length) {
        push(Object.assign({ id: 'layout', level: 'alerte', title: 'Mise en page dans l\'espace objet',
            detail: 'Le CCTP exclut cadre, carroyage et cartouche du dessin « plein Nord » : ' + layout.reduce(function (a, l) { return a + used[l]; }, 0) + ' entités sur ' + layout.join(', ') + '.', items: [] }, general));
    }
    var ignored = Object.keys(plan.ignored || {});
    if (ignored.length) {
        push(Object.assign({ id: 'ignored', level: 'alerte', title: 'Entités non lues par le module',
            detail: ignored.map(function (k) { return k + ' : ' + plan.ignored[k]; }).join(', ') + '.', items: [] }, general));
    }

    // Attributs : « les points et symboles relatifs aux réseaux contiennent des attributs qu'il convient de renseigner »
    var empties = {};
    model.features.forEach(function (f) {
        if (f.geom !== 'point' || !f.attrs || f.trade === 'fond-de-plan') { return; }
        var tags = Object.keys(f.attrs);
        if (tags.length && tags.every(function (t) { return isBlank(f.attrs[t]); })) {
            var k = f.network + '|' + f.block, e = empties[k] || (empties[k] = { trade: f.trade, network: f.network, block: f.block, tags: tags, items: [] });
            e.items.push({ ref: f.ref, label: T.blockTitle(f.block) });
        }
    });
    Object.keys(empties).forEach(function (k) {
        var e = empties[k];
        push({ id: 'empty:' + k, level: 'alerte', trade: e.trade, network: e.network, title: T.blockTitle(e.block) + ' : attributs vides',
            detail: 'Le CCTP demande de renseigner les attributs des réseaux : ' + e.tags.join(', ') + ' sont tous vides.', items: e.items });
    });

    // Réseaux
    Object.keys(model.nets).forEach(function (p) { _checkNetwork(model.nets[p], T.classify(p + '_Symboles'), push); });

    // Réseaux sans tracé : leurs ouvrages restent isolés
    var withObjects = {};
    model.features.forEach(function (f) { if (f.geom === 'point' && f.trade !== 'fond-de-plan' && f.trade !== 'voirie') { withObjects[f.prefix] = f; } });
    Object.keys(withObjects).forEach(function (p) {
        var hasLines = model.nets[p] && model.nets[p].pipes.length;
        if (!hasLines) {
            var f = withObjects[p];
            push({ id: 'notrace:' + p, level: 'info', trade: f.trade, network: f.network, title: 'Aucun tracé dans ce plan',
                detail: 'La charte prévoit des calques de tracés pour ce réseau, ils sont vides ici : seuls les ouvrages sont connus.', items: [] });
        }
    });

    var rank = { erreur: 0, alerte: 1, info: 2 };
    checks.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    var counts = { erreur: 0, alerte: 0, info: 0 };
    checks.forEach(function (c) { counts[c.level]++; });
    return { checks: checks, stats: _stats(model), counts: counts };
}
