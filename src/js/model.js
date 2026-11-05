/**
 * Modèle SIG d'un plan de récolement (sans DOM : testable seul). Chaque entité du DXF est rangée dans une classe :
 * métier > réseau > calque > géométrie (point, ligne, surface, texte). Les réseaux sont calculés au passage (network.js),
 * et le décompte dit ce que chaque entité est devenue : rien ne disparaît sans être compté.
 */
import * as T from './trades.js';
import * as N from './network.js';

var TEXT_LINK = 5;   // annotation rattachée à l'ouvrage le plus proche de son réseau (m)

function _ringArea(pts) {
    var A = 0;
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i], q = pts[(i + 1) % pts.length];
        A += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(A) / 2;
}

// Longueur d'un contour fermé, dernier segment compris
export function perimeter(pts) { return N.lengthOf(pts.concat([pts[0]])); }

export function area(rings) {
    return rings.reduce(function (a, r, i) { return i === 0 ? _ringArea(r) : a - _ringArea(r); }, 0);
}

// Une entrée du plan -> { features, layers, networks, nets, unclassified, absorbed, plan }
export function buildModel(plan) {
    var features = [], unclassified = {}, absorbed = { arrows: 0, characteristics: 0, marks: 0, letters: 0 };

    function other(layer) { unclassified[layer] = (unclassified[layer] || 0) + 1; }
    function base(c, layer, geom, ref) {
        return { geom: geom, trade: c.trade, network: c.network, color: c.color, theme: c.theme, prefix: c.prefix, layer: layer, block: null, ref: ref };
    }

    // Points : ouvrages à attributs et symboles
    var objects = T.listObjects(plan), kept = new Set();
    objects.forEach(function (o) { o.geom = 'point'; kept.add(o.ref); features.push(o); });
    function tallyPoint(b) {
        if (kept.has(b)) { return; }
        var c = T.classify(b.layer);
        if (!c) { other(b.layer); return; }
        if (/_DG_NAT\d*$/.test(b.block)) { absorbed.characteristics++; }
        else if (/98$/.test(b.block)) { absorbed.arrows++; }
        else if (T.isTechnical(b.block)) { absorbed.letters++; }
        else { absorbed.marks++; }                                // symbole posé sur un regard
    }
    plan.blocks.forEach(tallyPoint);
    plan.symbols.forEach(tallyPoint);

    // Lignes et surfaces
    plan.lines.forEach(function (l) {
        var c = T.classify(l.layer);
        if (!c) { other(l.layer); return; }
        var f = base(c, l.layer, l.closed ? 'polygon' : 'line', l);
        if (l.closed) { f.rings = [l.pts]; } else { f.pts = l.pts; }
        features.push(f);
    });
    (plan.hatches || []).forEach(function (h) {
        var c = T.classify(h.layer);
        if (!c) { other(h.layer); return; }
        var f = base(c, h.layer, 'polygon', h);
        f.rings = h.rings;
        f.hatch = true;
        features.push(f);
    });

    // Textes
    (plan.texts || []).forEach(function (t) {
        var c = T.classify(t.layer);
        if (!c) { other(t.layer); return; }
        var f = base(c, t.layer, 'text', t);
        f.text = t.text; f.x = t.x; f.y = t.y; f.rotation = t.rotation; f.height = t.height;
        features.push(f);
    });

    // Réseaux : tout préfixe qui porte des tracés, quel que soit le métier
    var nets = {};
    plan.lines.forEach(function (l) {
        var c = T.classify(l.layer);
        if (c && T.isTraceTheme(c.theme) && !nets[c.prefix]) { nets[c.prefix] = N.buildNetwork(plan, c.prefix); }
    });
    // Assainissement sans tracé : les regards restent un réseau, à vérifier par le diagnostic
    objects.forEach(function (o) { if (o.attrs && 'REGARD' in o.attrs && !nets[o.prefix]) { nets[o.prefix] = N.buildNetwork(plan, o.prefix); } });

    // Annotations : chaque texte d'un réseau est proposé sur l'ouvrage le plus proche
    var byPrefix = {};
    objects.forEach(function (o) { if (o.trade !== 'fond-de-plan') { (byPrefix[o.prefix] = byPrefix[o.prefix] || []).push(o); } });
    features.forEach(function (f) {
        if (f.geom !== 'text' || !byPrefix[f.prefix]) { return; }
        var best = null, bd = TEXT_LINK;
        byPrefix[f.prefix].forEach(function (o) {
            var d = Math.hypot(o.x - f.x, o.y - f.y);
            if (d <= bd) { bd = d; best = o; }
        });
        if (best) { (best.notes = best.notes || []).push(f.text); }
    });

    var byRef = new Map();
    features.forEach(function (f, i) { f.idx = i; byRef.set(f.ref, f); });

    return {
        plan: plan, features: features, byRef: byRef, nets: nets, tree: _tree(features, nets), absorbed: absorbed,
        unclassified: Object.keys(unclassified).map(function (k) { return { layer: k, count: unclassified[k] }; }).sort(function (a, b) { return b.count - a.count; })
    };
}

// Arbre du filtre : [{ trade, label, color, count, networks: [{ network, color, prefix, segments, layers: [{ layer, theme, label, counts, blocks }] }] }]
function _tree(features, nets) {
    var byTrade = {};
    features.forEach(function (f) {
        var t = byTrade[f.trade] || (byTrade[f.trade] = { count: 0, nets: {} });
        t.count++;
        var n = t.nets[f.network] || (t.nets[f.network] = { network: f.network, color: f.color, prefix: f.prefix, layers: {} });
        var L = n.layers[f.layer] || (n.layers[f.layer] = { layer: f.layer, theme: f.theme, label: T.themeLabel(f.theme), counts: { point: 0, line: 0, polygon: 0, text: 0 }, byBlock: {} });
        L.counts[f.geom]++;
        if (f.geom === 'point') {
            var B = L.byBlock[f.block] || (L.byBlock[f.block] = { block: f.block, label: f.label, count: 0 });
            B.count++;
        }
    });
    return T.TRADES.filter(function (t) { return byTrade[t.id]; }).map(function (t) {
        var v = byTrade[t.id];
        return {
            trade: t.id, label: t.label, color: t.color, count: v.count,
            networks: Object.keys(v.nets).map(function (k) {
                var n = v.nets[k], net = nets[n.prefix];
                return {
                    network: n.network, color: n.color, prefix: n.prefix,
                    segments: net ? net.segments.filter(function (s) { return !s.doubts.length; }).length : 0,
                    doubtful: net ? net.segments.filter(function (s) { return s.doubts.length; }).length : 0,
                    layers: Object.keys(n.layers).sort().map(function (l) {
                        var L = n.layers[l];
                        return { layer: L.layer, theme: L.theme, label: L.label, counts: L.counts,
                            blocks: Object.keys(L.byBlock).map(function (b) { return L.byBlock[b]; }).sort(function (a, b) { return b.count - a.count; }) };
                    })
                };
            })
        };
    });
}
