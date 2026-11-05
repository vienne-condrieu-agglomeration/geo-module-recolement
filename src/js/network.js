/**
 * Rattachements d'un plan de récolement (sans DOM : testable seul). Le plan ne porte aucun identifiant de lien :
 * tout se déduit de la géométrie, selon la charte graphique du marché de topographie.
 *
 * Pour un réseau (préfixe de calque, ex. « TOPO_Eaux-usées ») :
 *   - regard : bloc à attribut REGARD du calque « <préfixe>_Symboles » ;
 *   - canalisation : polyligne du calque « <préfixe>_Tracés-souterrains » ;
 *   - caractéristiques : bloc à attribut ALTI_AMONT / ALTI_AVAL du calque « _Symboles », posé sur la polyligne ;
 *   - sens d'écoulement : flèche (bloc E_U98, E_P98…) du calque « <préfixe>_Infra-sous-sol », posée près de la polyligne
 *     et tournée dans le sens de l'eau ;
 *   - symbole du regard : bloc sans attribut du calque « <préfixe>_Infrastructures » à l'emplacement du regard.
 *
 * Le plan ne dessine pas le réseau continu : autour de chaque regard, il dessine des amorces de quelques mètres dont un bout
 * reste libre. Le tronçon entre deux regards se reconstitue en appariant les amorces qui se font face (reconstruct). Ce lien est
 * une déduction : il est signalé comme tel. Deux contrôles indépendants de l'appariement le jugent : les cotes (une pente juste ne
 * prouve rien à elle seule : sur le plan de test, 50 à 56 % des couples d'amorces pris sans condition d'alignement la respectent)
 * et la géométrie (un tronçon qui traverse un bâtiment ou en croise un autre plus court du même réseau est « douteux »).
 */

import { blockLabel, isTechnical } from './trades.js';
import { parseNumber, isBlank } from './mapping.js';

var PIPE_SUFFIXES = ['_Tracés-souterrains', '_Tracés-aériens'];
var FLOW_SUFFIX = '_Infra-sous-sol';
var SYMBOL_SUFFIX = '_Infrastructures';
var BUILDING_LAYER = /^TOPO_B[âa]timents_(Contours|Constructions)$/;
var NODE_TOL = 0.5;      // extrémité de canalisation rattachée à un regard ou à un symbole (m)
var ON_LINE_TOL = 0.05;  // bloc posé sur la polyligne (m)
var ARROW_TOL = 1.0;     // flèche d'écoulement rattachée à la polyligne (m)
var ANGLE_TOL = 25;      // écart d'orientation toléré entre un bloc et la polyligne (°)
var GAP_MAX = 200;       // distance maximale entre deux amorces qui se font face (m)
var ALIGN_TOL = 15;      // écart toléré entre une amorce et la droite qui rejoint l'autre amorce (°)
var SLOPE_TOL = 0.02;    // contre-pente signalée au-delà de cet écart de cote (m)

// « E_U03 » -> « tampon circulaire plein » ; les autres noms sont rendus tels quels (catalogue : trades.js).
export function symbolLabel(block) { return blockLabel(block); }

export function prefixOf(layer) { return String(layer).replace(/_[^_]+$/, ''); }

function _dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// Pied de p sur la polyligne : { d: distance, angle: direction du segment (° dans [0, 360[), s: abscisse normalisée [0, 1] }
function _foot(pts, p) {
    var total = 0, acc = 0, best = null, i;
    for (i = 0; i + 1 < pts.length; i++) { total += _dist(pts[i], pts[i + 1]); }
    for (i = 0; i + 1 < pts.length; i++) {
        var a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        var t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
        var d = _dist(p, [a[0] + t * dx, a[1] + t * dy]), len = Math.sqrt(L2);
        if (!best || d < best.d) {
            best = { d: d, angle: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, s: total ? (acc + t * len) / total : 0 };
        }
        acc += len;
    }
    return best;
}

// Écart entre deux angles, en degrés, dans [0, 180]
function _gap(a, b) { var x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; }
// Écart modulo 180 (blocs non orientés)
function _gap180(a, b) { var x = _gap(a, b); return Math.min(x, 180 - x); }

// plan : { blocks, symbols, lines } (dxf-blocks.parseBlocks). Renvoie le réseau du préfixe donné :
// { regards: [{ id, x, y, attrs, ref (le bloc du plan), symbol }], symbols: [symboles sans attribut du calque « _Infrastructures »], pipes: [{ idx, pts, from, to, dg, flow, up, down }] }
// from/to : { regard: indice } ou { symbol: nom, sym: indice dans symbols } ou null, aux extrémités début/fin de la polyligne.
// flow : 'fwd' (début → fin), 'rev' ou null si aucune flèche. dg : { mat, diam, amont, aval } ou null.
export function buildNetwork(plan, prefix) {
    var symLayer = prefix + '_Symboles';
    var regards = [], dgs = [], infra = [];
    plan.blocks.forEach(function (b) {
        if (b.layer !== symLayer && b.layer !== prefix + SYMBOL_SUFFIX) { return; }
        if ('REGARD' in b.attrs) { regards.push({ id: b.attrs.REGARD, x: b.x, y: b.y, attrs: b.attrs, block: b.block, ref: b, symbol: null }); }
        else if ('ALTI_AMONT' in b.attrs || 'ALTI_AVAL' in b.attrs) { dgs.push(b); }
        else if (!isTechnical(b.block)) { infra.push(b); }       // ouvrage à attributs : bouche à clé, poteau incendie…
    });
    plan.symbols.forEach(function (s) { if (s.layer === prefix + SYMBOL_SUFFIX && !isTechnical(s.block)) { infra.push(s); } });
    var arrows = plan.symbols.filter(function (s) { return s.layer === prefix + FLOW_SUFFIX; });
    var pipes = plan.lines.filter(function (l) { return PIPE_SUFFIXES.some(function (x) { return l.layer === prefix + x; }); }).map(function (l, i) {
        return { idx: i, pts: l.pts, ref: l, from: null, to: null, dg: null, flow: null, up: null, down: null, seg: null };
    });

    function nearest(list, p, tol) {
        var best = null;
        list.forEach(function (o, i) { var d = _dist([o.x, o.y], p); if (d <= tol && (!best || d < best.d)) { best = { i: i, d: d }; } });
        return best;
    }

    // Symbole de chaque regard (le plus proche à moins de NODE_TOL)
    regards.forEach(function (r) { var s = nearest(infra, [r.x, r.y], NODE_TOL); if (s) { r.symbol = infra[s.i].block; } });

    // Extrémités : un regard, à défaut un symbole (tabouret de branchement, avaloir…)
    function endRef(p) {
        var r = nearest(regards, p, NODE_TOL);
        if (r) { return { regard: r.i }; }
        var s = nearest(infra, p, NODE_TOL);
        return s ? { symbol: infra[s.i].block, sym: s.i } : null;
    }
    pipes.forEach(function (pp) { pp.from = endRef(pp.pts[0]); pp.to = endRef(pp.pts[pp.pts.length - 1]); });

    // Caractéristiques : le bloc posé sur la polyligne, de même orientation
    dgs.forEach(function (b) {
        var best = null;
        pipes.forEach(function (pp) {
            var f = _foot(pp.pts, [b.x, b.y]);
            if (f.d <= ON_LINE_TOL && _gap180(f.angle, b.rotation) <= ANGLE_TOL && (!best || f.d < best.d)) { best = { pp: pp, d: f.d }; }
        });
        if (best && !best.pp.dg) { best.pp.dg = { mat: b.attrs.MAT, diam: b.attrs.DIAM, amont: b.attrs.ALTI_AMONT, aval: b.attrs.ALTI_AVAL }; }
    });

    // Sens d'écoulement : la flèche la plus proche d'une polyligne, de même orientation ; sa rotation donne le sens
    arrows.forEach(function (a) {
        var best = null;
        pipes.forEach(function (pp) {
            var f = _foot(pp.pts, [a.x, a.y]);
            if (f.d <= ARROW_TOL && _gap180(f.angle, a.rotation) <= ANGLE_TOL && (!best || f.d < best.d)) { best = { pp: pp, f: f, d: f.d }; }
        });
        if (best && !best.pp.flow) { best.pp.flow = _gap(best.f.angle, a.rotation) < 90 ? 'fwd' : 'rev'; }
    });
    pipes.forEach(function (pp) {
        if (pp.flow === 'fwd') { pp.up = pp.from; pp.down = pp.to; }
        else if (pp.flow === 'rev') { pp.up = pp.to; pp.down = pp.from; }
    });
    var net = { prefix: prefix, regards: regards, symbols: infra, pipes: pipes, segments: [] };
    net.segments = reconstruct(net, plan.lines.filter(function (l) { return BUILDING_LAYER.test(l.layer); }));
    return net;
}

export function lengthOf(pts) {
    var L = 0;
    for (var i = 0; i + 1 < pts.length; i++) { L += _dist(pts[i], pts[i + 1]); }
    return L;
}

function _bearing(a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }

function _radierOf(net, ref) {
    return ref && ref.regard !== undefined ? parseNumber(net.regards[ref.regard].attrs.RADIER) : null;
}

// Cote au bout amont ou aval d'une canalisation orientée : fil d'eau relevé, sinon radier du regard à ce bout.
function _levelAt(net, pp, up) {
    var v = pp.dg ? parseNumber(up ? pp.dg.amont : pp.dg.aval) : null;
    return v !== null ? v : _radierOf(net, up ? pp.up : pp.down);
}

// Canalisation orientée raccordée aux deux bouts : { zUp, zDown, slope (m/m, positive si l'eau descend), status }.
export function pipeSlope(net, pp) {
    if (!pp.flow) { return { zUp: null, zDown: null, slope: null, status: 'inconnu' }; }
    var zUp = _levelAt(net, pp, true), zDown = _levelAt(net, pp, false), L = lengthOf(pp.pts);
    if (zUp === null || zDown === null || !L) { return { zUp: zUp, zDown: zDown, slope: null, status: 'inconnu' }; }
    return { zUp: zUp, zDown: zDown, slope: (zUp - zDown) / L, status: zUp >= zDown - SLOPE_TOL ? 'ok' : 'contre-pente' };
}

// Amorces : canalisations dont un seul bout est raccordé, orientées du nœud vers le bout libre.
function _amorces(net) {
    var out = [];
    net.pipes.forEach(function (pp) {
        if (!pp.from === !pp.to) { return; }
        var atStart = !!pp.from, pts = atStart ? pp.pts : pp.pts.slice().reverse();
        out.push({
            pipe: pp, node: atStart ? pp.from : pp.to, pts: pts, end: pts[pts.length - 1],
            dir: _bearing(pts[pts.length - 2], pts[pts.length - 1]),
            out: pp.flow ? (pp.flow === 'fwd') === atStart : null        // l'eau part du nœud ; null si sens inconnu
        });
    });
    return out;
}

function _sameNode(a, b) {
    return a.regard !== undefined ? a.regard === b.regard : a.sym !== undefined && a.sym === b.sym;
}

function _diam(am) { var d = am.pipe.dg && am.pipe.dg.diam; return d && !isBlank(d) ? d : null; }

// Tronçons déduits : deux amorces se font face, alignées, sens compatibles ; chacune est le meilleur choix de l'autre.
// [{ idx, prefix, up, down, oriented, a, b, pts, gap, length, mat, diam, diamDiff, zUp, zDown, slope, status, doubts }]
// status : 'ok' (les cotes confirment le sens), 'contre-pente' (elles le contredisent), 'inconnu' (cotes ou sens manquants).
// doubts : raisons de douter du tracé ; vide = tronçon probable. buildings : polylignes des bâtiments du plan.
export function reconstruct(net, buildings) {
    var am = _amorces(net);
    var choices = am.map(function (a, i) {
        var list = [];
        am.forEach(function (c, j) {
            if (i === j || _sameNode(a.node, c.node)) { return; }
            var d = _dist(a.end, c.end);
            if (d > GAP_MAX || d < 0.01) { return; }
            var axis = _bearing(a.end, c.end), e = _gap(axis, a.dir) + _gap(axis + 180, c.dir);
            if (_gap(axis, a.dir) > ALIGN_TOL || _gap(axis + 180, c.dir) > ALIGN_TOL) { return; }
            if (a.out !== null && c.out !== null && a.out === c.out) { return; }
            var da = _diam(a), dc = _diam(c);
            list.push({ j: j, d: d, score: e + d * 0.05, same: !da || !dc || da === dc });
        });
        // Un diamètre identique prime ; à diamètre égal, le plus aligné et le plus proche
        list.sort(function (x, y) { return (y.same - x.same) || (x.score - y.score); });
        return list[0] || null;
    });
    var segments = [];
    am.forEach(function (a, i) {
        var c = choices[i];
        if (!c || c.j < i) { return; }
        var back = choices[c.j];
        if (!back || back.j !== i) { return; }
        var other = am[c.j];
        // Sens : celui d'une des deux amorces suffit (l'autre peut ne pas avoir de flèche)
        var aIsUp = a.out !== null ? a.out : other.out !== null ? !other.out : true;
        var oriented = a.out !== null || other.out !== null;
        var U = aIsUp ? a : other, D = aIsUp ? other : a;
        var pts = U.pts.concat(D.pts.slice().reverse());
        var zUp = U.out === true && U.pipe.dg ? parseNumber(U.pipe.dg.amont) : null;
        var zDown = D.out === false && D.pipe.dg ? parseNumber(D.pipe.dg.aval) : null;
        if (zUp === null) { zUp = _radierOf(net, U.node); }
        if (zDown === null) { zDown = _radierOf(net, D.node); }
        var L = lengthOf(pts), known = oriented && zUp !== null && zDown !== null;
        var dgs = [U.pipe.dg, D.pipe.dg].filter(Boolean);
        var pick = function (k) { var f = dgs.filter(function (g) { return !isBlank(g[k]); })[0]; return f ? f[k] : null; };
        var seg = {
            idx: segments.length, prefix: net.prefix, up: U.node, down: D.node, oriented: oriented, a: U.pipe, b: D.pipe, pts: pts,
            gap: c.d, length: L, mat: pick('mat'), diam: pick('diam'), diamDiff: !c.same, zUp: zUp, zDown: zDown,
            slope: known ? (zUp - zDown) / L : null,
            status: known ? (zUp >= zDown - SLOPE_TOL ? 'ok' : 'contre-pente') : 'inconnu',
            span: [U.end, D.end], doubts: []
        };
        a.pipe.seg = seg;
        other.pipe.seg = seg;
        segments.push(seg);
    });
    _judge(segments, buildings || []);
    return segments;
}

// Les deux segments [a, b] et [c, d] se coupent-ils ? Un contact à une extrémité ne compte pas.
function _crosses(a, b, c, d) {
    function side(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function _hitsLine(span, pts, closed) {
    for (var i = 0; i + 1 < pts.length; i++) { if (_crosses(span[0], span[1], pts[i], pts[i + 1])) { return true; } }
    return !!closed && _crosses(span[0], span[1], pts[pts.length - 1], pts[0]);
}

// Du plus court au plus long : le plus court a la priorité, car une amorce vise d'autant moins juste que la distance est grande.
function _judge(segments, buildings) {
    var kept = [];
    segments.slice().sort(function (x, y) { return x.gap - y.gap; }).forEach(function (s) {
        if (buildings.some(function (b) { return _hitsLine(s.span, b.pts, b.closed); })) { s.doubts.push('traverse un bâtiment'); }
        if (kept.some(function (k) { return _crosses(s.span[0], s.span[1], k.span[0], k.span[1]); })) { s.doubts.push('croise un tronçon plus court du même réseau'); }
        if (!s.doubts.length) { kept.push(s); }
    });
}

// Un nœud du réseau : { regard: indice } ou { sym: indice } (symbole sans attribut : avaloir, tabouret de branchement…)
function _isNode(ref, node) {
    return !!ref && (node.regard !== undefined ? ref.regard === node.regard : ref.sym === node.sym);
}

// Arbre d'un nœud : { regard, symbol, pipes: [{ pipe, role, other, here, there }] }
//   role : 'out' (l'eau part du nœud), 'in' (elle y arrive) ou null (sens inconnu)
//   other : { regard: indice } ou { symbol: nom, sym } ou null : l'objet à l'autre bout
//   here / there : fil d'eau du bloc de caractéristiques au nœud et à l'autre bout (texte du plan, 'NR' si non relevé)
export function treeOfNode(net, node) {
    var r = node.regard !== undefined ? net.regards[node.regard] : null;
    var out = { regard: r, symbol: r ? r.symbol : net.symbols[node.sym].block, pipes: [] };
    net.pipes.forEach(function (pp) {
        var atFrom = _isNode(pp.from, node), atTo = _isNode(pp.to, node);
        if (!atFrom && !atTo) { return; }
        var hereUp = pp.flow ? (pp.flow === 'fwd' ? atFrom : atTo) : null;     // ce nœud est l'amont de la canalisation
        var role = hereUp === null ? null : hereUp ? 'out' : 'in';
        var val = function (up) { return pp.dg ? (up ? pp.dg.amont : pp.dg.aval) : undefined; };
        out.pipes.push({
            pipe: pp, role: role, other: atFrom ? pp.to : pp.from,
            here: hereUp === null ? undefined : val(hereUp), there: hereUp === null ? undefined : val(!hereUp)
        });
    });
    return out;
}

// Arbre d'un regard (indice dans net.regards)
export function treeOf(net, regardIdx) { return treeOfNode(net, { regard: regardIdx }); }

// Sens inverse : la canalisation et ses deux extrémités. { pipe, up, down, ends: [{ end: 'from'|'to', ref, fil }] }
// ref : { regard } / { symbol, sym } / null ; fil : fil d'eau relevé à cette extrémité (texte du plan) ou undefined.
export function pipeSheet(net, pipeIdx) {
    var pp = net.pipes[pipeIdx], fwd = pp.flow !== 'rev';
    function fil(end) {
        if (!pp.dg || !pp.flow) { return undefined; }
        var isUp = (end === 'from') === fwd;
        return isUp ? pp.dg.amont : pp.dg.aval;
    }
    return {
        pipe: pp, up: pp.up, down: pp.down,
        ends: [{ end: 'from', ref: pp.from, fil: fil('from') }, { end: 'to', ref: pp.to, fil: fil('to') }]
    };
}
