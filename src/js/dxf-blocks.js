/**
 * Lecture de la géométrie d'un DXF (sans DOM : testable seul), espace objet seulement.
 * - blocks : INSERT à ATTRIB (regards, extrémités de canalisation…) : { block, layer, x, y, z, rotation, attrs: { TAG: 'valeur' } }
 * - symbols : INSERT sans attribut (types de tampon, flèches d'écoulement…) et POINT : { block, layer, x, y, rotation }
 * - lines : LWPOLYLINE, POLYLINE, LINE, ARC, CIRCLE : { layer, pts: [[x, y], ...], closed }. Les arcs sont échantillonnés.
 * - hatches : contours des HATCH : { layer, rings: [[[x, y], ...], ...] }
 * - texts : TEXT, MTEXT : { layer, text, x, y, rotation, height }
 * - ignored : { TYPE: nombre } des entités de l'espace objet qui ne sont pas lues (SPLINE, ELLIPSE, IMAGE…)
 * - cartouche : attributs du bloc de cartouche (il est en général dans l'espace papier), ou null
 */

var ARC_STEP = Math.PI / 12;   // pas d'échantillonnage des arcs (15°)
var NOT_COUNTED = { VIEWPORT: true, SEQEND: true, ATTRIB: true, VERTEX: true };

function _decode(buffer) {
    // DXF AutoCAD 2007 et suivants (AC1021…) : UTF-8. Avant : page de codes ANSI, ici Windows-1252.
    var head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096)));
    var m = /\$ACADVER\s+1\s+AC(\d+)/.exec(head);
    var utf8 = !m || parseInt(m[1], 10) >= 1021;
    return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(buffer);
}

// Points intermédiaires de l'arc a -> b de renflement « bulge » (a et b exclus). bulge > 0 : sens trigonométrique.
export function arcPoints(a, b, bulge) {
    var theta = 4 * Math.atan(bulge), n = Math.ceil(Math.abs(theta) / ARC_STEP), out = [];
    if (n < 2 || (a[0] === b[0] && a[1] === b[1])) { return out; }
    var k = (1 - bulge * bulge) / (4 * bulge);
    var cx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * k, cy = (a[1] + b[1]) / 2 + (b[0] - a[0]) * k;
    var r = Math.hypot(a[0] - cx, a[1] - cy), start = Math.atan2(a[1] - cy, a[0] - cx);
    for (var i = 1; i < n; i++) {
        var t = start + theta * i / n;
        out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return out;
}

// Sommets { x, y, b } -> points, arcs compris (b : renflement du segment qui part du sommet).
function _unfold(verts, closed) {
    var pts = [];
    verts.forEach(function (v, i) {
        var p = [v.x, v.y], next = verts[i + 1] || (closed ? verts[0] : null);
        pts.push(p);
        if (v.b && next) { arcPoints(p, [next.x, next.y], v.b).forEach(function (q) { pts.push(q); }); }
    });
    return pts;
}

function _isClosed(pts, flag) {
    if (flag) { return true; }
    var a = pts[0], b = pts[pts.length - 1];
    return pts.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001;
}

function _circle(cx, cy, r, from, to) {
    var pts = [], sweep = to - from, n = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
    for (var i = 0; i <= n; i++) {
        var t = from + sweep * i / n;
        pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return pts;
}

// Texte d'un TEXT ou d'un MTEXT, sans ses codes de mise en forme.
export function cleanText(s) {
    return String(s)
        .replace(/\\P/g, ' ').replace(/\\~/g, ' ')
        .replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '').replace(/[{}]/g, '')
        .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '')
        .replace(/\s+/g, ' ').trim();
}

// buffer : ArrayBuffer d'un DXF ASCII.
// total : nombre d'INSERT de l'espace objet (avec ou sans attributs).
export function parseBlocks(buffer) {
    var src = _decode(buffer).split('\n');
    var out = { blocks: [], symbols: [], lines: [], hatches: [], texts: [], units: null, total: 0, ignored: {}, cartouche: null };
    var section = null, sectionNext = false, headerVar = null;
    var cur = null, att = null, vtx = null;

    function addLine(layer, pts, flag) {
        if (pts.length > 1) { out.lines.push({ layer: layer, pts: pts, closed: _isClosed(pts, flag) }); }
    }

    function endAttrib() {
        if (att && cur && att.tag) { cur.attrs[att.tag] = att.value === undefined ? '' : att.value; }
        att = null;
    }

    function endEntity() {
        if (!cur) { return; }
        var e = cur;
        endAttrib();
        cur = null;
        vtx = null;
        if (e.type === 'INSERT') {
            var has = Object.keys(e.attrs).length > 0;
            if (has && /CARTOUCHE/i.test(e.block)) { out.cartouche = e.attrs; }
            if (e.paper) { return; }
            out.total++;
            if (has) { out.blocks.push({ block: e.block, layer: e.layer, x: e.x, y: e.y, z: e.z, rotation: e.rotation, attrs: e.attrs }); }
            else { out.symbols.push({ block: e.block, layer: e.layer, x: e.x, y: e.y, rotation: e.rotation }); }
            return;
        }
        if (e.paper) { return; }
        switch (e.type) {
            case 'LWPOLYLINE':
                addLine(e.layer, _unfold(e.verts, !!(e.flags & 1)), !!(e.flags & 1));
                break;
            case 'POLYLINE':
                // Maillages et surfaces (bits 16 et 64) : ce ne sont pas des lignes
                if (e.flags & 80) { out.ignored.POLYLINE = (out.ignored.POLYLINE || 0) + 1; break; }
                addLine(e.layer, _unfold(e.verts, !!(e.flags & 1)), !!(e.flags & 1));
                break;
            case 'LINE':
                addLine(e.layer, [[e.x, e.y], [e.x2, e.y2]], false);
                break;
            case 'CIRCLE':
                addLine(e.layer, _circle(e.x, e.y, e.r, 0, 2 * Math.PI).slice(0, -1), true);
                break;
            case 'ARC': {
                var a0 = e.a0 * Math.PI / 180, a1 = e.a1 * Math.PI / 180;
                if (a1 <= a0) { a1 += 2 * Math.PI; }
                addLine(e.layer, _circle(e.x, e.y, e.r, a0, a1), false);
                break;
            }
            case 'POINT':
                out.symbols.push({ block: 'POINT', layer: e.layer, x: e.x, y: e.y, rotation: 0 });
                break;
            case 'TEXT':
            case 'MTEXT': {
                var txt = cleanText(e.head + e.text);
                if (!txt) { break; }
                var aligned = e.type === 'TEXT' && (e.h72 || e.v73) && e.x2 !== undefined;
                var rot = e.type === 'MTEXT' && e.x2 !== undefined ? Math.atan2(e.y2, e.x2) * 180 / Math.PI : e.rotation;
                out.texts.push({ layer: e.layer, text: txt, x: aligned ? e.x2 : e.x, y: aligned ? e.y2 : e.y, rotation: rot, height: e.height });
                break;
            }
            case 'HATCH': {
                var rings = e.loops.filter(function (l) { return l.ok && l.verts.length > 2; }).map(function (l) { return _unfold(l.verts, true); });
                if (rings.length) { out.hatches.push({ layer: e.layer, rings: rings }); }
                else { out.ignored.HATCH = (out.ignored.HATCH || 0) + 1; }
                break;
            }
            default:
                if (!NOT_COUNTED[e.type]) { out.ignored[e.type] = (out.ignored[e.type] || 0) + 1; }
        }
    }

    function start(type) {
        var e = { type: type, layer: '0', paper: false };
        if (type === 'INSERT') { e.block = ''; e.x = 0; e.y = 0; e.z = 0; e.rotation = 0; e.attrs = {}; }
        else if (type === 'LWPOLYLINE' || type === 'POLYLINE') { e.verts = []; e.flags = 0; }
        else if (type === 'LINE') { e.x = 0; e.y = 0; e.x2 = 0; e.y2 = 0; }
        else if (type === 'CIRCLE' || type === 'ARC') { e.x = 0; e.y = 0; e.r = 0; e.a0 = 0; e.a1 = 360; }
        else if (type === 'POINT') { e.x = 0; e.y = 0; }
        else if (type === 'TEXT' || type === 'MTEXT') { e.x = 0; e.y = 0; e.rotation = 0; e.height = 0; e.text = ''; e.head = ''; }
        else if (type === 'HATCH') { e.loops = []; e.loop = null; e.edge = null; e.left = 0; e.done = false; }
        return e;
    }

    function readHatch(e, c, v) {
        if (e.done) { return; }
        if (c === '91') { e.left = parseInt(v, 10); return; }
        if (c === '75') { e.done = true; return; }        // fin des contours : les codes 10/20 suivants sont des points d'amorce
        if (c === '92') {
            var flag = parseInt(v, 10);
            e.loop = { poly: !!(flag & 2), ok: true, verts: [] };
            e.edge = null;
            e.loops.push(e.loop);
            return;
        }
        var L = e.loop;
        if (!L) { return; }
        if (L.poly) {
            if (c === '10') { L.verts.push({ x: parseFloat(v), y: 0, b: 0 }); }
            else if (c === '20' && L.verts.length) { L.verts[L.verts.length - 1].y = parseFloat(v); }
            else if (c === '42' && L.verts.length) { L.verts[L.verts.length - 1].b = parseFloat(v); }
            return;
        }
        // Contour par arêtes : seules les arêtes droites sont lues
        if (c === '72') {
            e.edge = parseInt(v, 10);
            if (e.edge !== 1) { L.ok = false; }
        } else if (e.edge === 1) {
            if (c === '10') { L.verts.push({ x: parseFloat(v), y: 0, b: 0 }); }
            else if (c === '20' && L.verts.length) { L.verts[L.verts.length - 1].y = parseFloat(v); }
        }
    }

    for (var i = 0; i + 1 < src.length; i += 2) {
        var c = src[i].trim(), v = src[i + 1].replace(/\r$/, '');
        if (c === '0') {
            if (v === 'ATTRIB' && cur && cur.type === 'INSERT') { endAttrib(); att = { tag: null, value: undefined }; continue; }
            if (v === 'VERTEX' && cur && cur.type === 'POLYLINE') { vtx = { x: 0, y: 0, b: 0 }; cur.verts.push(vtx); continue; }
            // Toute autre entité ferme la précédente (un INSERT sans attributs n'a pas de SEQEND).
            endEntity();
            if (v === 'SEQEND') { continue; }
            if (v === 'SECTION') { sectionNext = true; section = null; continue; }
            if (v === 'ENDSEC') { section = null; continue; }
            if (section === 'ENTITIES') { cur = start(v); }
            continue;
        }
        if (sectionNext && c === '2') { section = v; sectionNext = false; continue; }
        if (section === 'HEADER') {
            if (c === '9') { headerVar = v; }
            else if (headerVar === '$INSUNITS' && c === '70') { out.units = parseInt(v, 10); headerVar = null; }
            continue;
        }
        if (section !== 'ENTITIES' || !cur) { continue; }
        if (att) {
            // Code 1 : valeur, 2 : nom (tag) de l'attribut ; les autres codes (position, hauteur…) sont ignorés.
            if (c === '1') { att.value = v; } else if (c === '2') { att.tag = v; }
            continue;
        }
        if (vtx) {
            if (c === '10') { vtx.x = parseFloat(v); } else if (c === '20') { vtx.y = parseFloat(v); } else if (c === '42') { vtx.b = parseFloat(v); }
            continue;
        }
        if (c === '8') { cur.layer = v; continue; }
        if (c === '67') { cur.paper = parseInt(v, 10) === 1; continue; }
        var e = cur, n = parseFloat(v);
        switch (e.type) {
            case 'INSERT':
                if (c === '2') { e.block = v; } else if (c === '10') { e.x = n; } else if (c === '20') { e.y = n; }
                else if (c === '30') { e.z = n; } else if (c === '50') { e.rotation = n; }
                break;
            case 'LWPOLYLINE':
                if (c === '70') { e.flags = parseInt(v, 10); }
                else if (c === '10') { e.verts.push({ x: n, y: 0, b: 0 }); }
                else if (c === '20' && e.verts.length) { e.verts[e.verts.length - 1].y = n; }
                else if (c === '42' && e.verts.length) { e.verts[e.verts.length - 1].b = n; }
                break;
            case 'POLYLINE':
                if (c === '70') { e.flags = parseInt(v, 10); }
                break;
            case 'LINE':
                if (c === '10') { e.x = n; } else if (c === '20') { e.y = n; } else if (c === '11') { e.x2 = n; } else if (c === '21') { e.y2 = n; }
                break;
            case 'ARC':
            case 'CIRCLE':
                if (c === '10') { e.x = n; } else if (c === '20') { e.y = n; } else if (c === '40') { e.r = n; }
                else if (c === '50') { e.a0 = n; } else if (c === '51') { e.a1 = n; }
                break;
            case 'POINT':
                if (c === '10') { e.x = n; } else if (c === '20') { e.y = n; }
                break;
            case 'TEXT':
            case 'MTEXT':
                if (c === '1') { e.text = v; } else if (c === '3') { e.head += v; }
                else if (c === '10') { e.x = n; } else if (c === '20') { e.y = n; }
                else if (c === '11') { e.x2 = n; } else if (c === '21') { e.y2 = n; }
                else if (c === '40') { e.height = n; } else if (c === '50') { e.rotation = n; }
                else if (c === '72') { e.h72 = parseInt(v, 10); } else if (c === '73') { e.v73 = parseInt(v, 10); }
                break;
            case 'HATCH':
                readHatch(e, c, v);
                break;
            default:
        }
    }
    endEntity();
    return out;
}

// Calques portant des blocs à attributs : [{ layer, count, blocks: [{ block, count, tags: [..] }] }], du plus fourni au moins fourni.
export function summarize(blocks) {
    var byLayer = {};
    blocks.forEach(function (b) {
        var L = byLayer[b.layer] || (byLayer[b.layer] = { layer: b.layer, count: 0, byBlock: {} });
        L.count++;
        var B = L.byBlock[b.block] || (L.byBlock[b.block] = { block: b.block, count: 0, tagSet: {} });
        B.count++;
        Object.keys(b.attrs).forEach(function (t) { B.tagSet[t] = true; });
    });
    return Object.keys(byLayer).map(function (k) {
        var L = byLayer[k];
        return {
            layer: L.layer, count: L.count,
            blocks: Object.keys(L.byBlock).map(function (n) {
                var B = L.byBlock[n];
                return { block: B.block, count: B.count, tags: Object.keys(B.tagSet).sort() };
            }).sort(function (a, b) { return b.count - a.count; })
        };
    }).sort(function (a, b) { return b.count - a.count; });
}
