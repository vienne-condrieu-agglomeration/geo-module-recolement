/**
 * geo-recolement — lecture et analyse d'un plan de récolement (DXF du marché de topographie).
 *
 * Le plan est lu dans le navigateur : rien n'est envoyé ni écrit. Chaque entité du DXF (points, lignes, surfaces, textes) est
 * rangée dans le modèle du CCTP (métier > réseau > calque : model.js, trades.js) et s'affiche sur la carte OpenLayers principale,
 * filtrable. Le réseau est déduit de la géométrie, dans les deux sens : d'un regard vers ses canalisations, d'une canalisation
 * vers ses extrémités, et d'une amorce vers l'amorce d'en face pour reconstituer le tronçon (network.js). Le diagnostic contrôle
 * la conformité au CCTP et la cohérence du réseau (diagnostic.js). Si des tables cibles sont configurées, un ouvrage à attributs
 * peut être inséré dans une fiche info par transaction GEO (InfosheetFunctionalityService ; correspondance : mapping.js).
 */
import angular from "angular";
import proj4 from 'proj4';
import pluginConf from '../plugin.geoext.json';
import * as D from './dxf-blocks.js';
import * as M from './mapping.js';
import * as N from './network.js';
import * as T from './trades.js';
import * as G from './model.js';
import * as X from './diagnostic.js';
import { createChangelog } from './changelog.js';
import changelogMd from '../../CHANGELOG.md';

// Lambert-93 et Lambert conique conforme 9 zones (CC42 à CC50) : projections des plans de topographie.
proj4.defs('EPSG:2154', '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
for (var z = 42; z <= 50; z++) {
    proj4.defs('EPSG:' + (3900 + z), '+proj=lcc +lat_0=' + z + ' +lon_0=3 +lat_1=' + (z - 0.75) + ' +lat_2=' + (z + 0.75) +
        ' +x_0=1700000 +y_0=' + ((z - 41) * 1000000 + 200000) + ' +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
}

var TEXT_MAX_RES = 0.6;    // textes affichés sous cette résolution (m/pixel)
var ARROW_MAX_RES = 1;     // flèches d'écoulement affichées sous cette résolution (m/pixel)
var ITEMS_SHOWN = 100;     // objets listés par vérification du diagnostic
var LEVELS = { erreur: 'Erreurs', alerte: 'Alertes', info: 'Informations' };

angular
    .module(pluginConf.code.moduleName, pluginConf.code.dependencies)
    .run(['geoApplication', 'acfExtensionService', '$injector', '$timeout', '$rootScope',
          function (geoApplication, acfExtensionService, $injector, $timeout, $rootScope) {

        // ============================================================
        // Configuration (remplie depuis le Générateur GEO)
        // ============================================================
        var changelog = createChangelog({
            name: pluginConf.name, title: pluginConf.displayName, version: pluginConf.version,
            markdown: changelogMd, prefix: 'geo-recolement'
        });

        var _toolName   = 'Récolement';
        var _impCrs     = 'EPSG:3945';          // RGF93 CC45 : CCTP de topographie de l'agglomération
        var _mappingSpec = {};                  // correspondance de départ ATTRIBUT -> champ (Générateur)
        var _targets    = [];                   // [{ id, name }] : fiches info éditables (facultatif)
        var _panelWidthPct = 35;                // largeur du panneau (% de la fenêtre), réglée dans le Générateur
        var _widgetId   = null;
        var _registered = false;

        // ============================================================
        // État
        // ============================================================
        var _map = null, _panelEl = null, _clickKey = null;
        var _layers = null;                     // calques OpenLayers : { polygon, line, text, hl, point }
        var _plan = null;                       // { name, raw, model, diag }
        var _ol = new Map();                    // entrée du plan ou tronçon -> feature OpenLayers
        var _pipeByRef = new Map();             // entrée du plan -> { net, pipe }
        var _offTrades = {};                    // métiers décochés : { id: true }
        var _offNets = {};                      // réseaux décochés : { 'métier|réseau': true }
        var _offLayers = {};                    // calques décochés : { calque: true }
        var _offBlocks = {};                    // types d'ouvrage décochés : { 'calque|bloc': true }
        var _offSegs = {};                      // tronçons reconstitués masqués : { préfixe: true }
        var _onDoubts = {};                     // tronçons douteux affichés : { préfixe: true } (masqués au départ)
        var _open = {};                         // branches dépliées de l'arbre et groupes du diagnostic : { clé: true }
        var _tab = 'layers';                    // onglet affiché : layers, diag, stats, object, target
        var _backTab = null;                    // onglet d'où l'on vient, quand un lien mène à la fiche d'un objet
        var _selected = null;                   // feature OpenLayers choisie (point, ligne, surface, texte ou tronçon)
        var _openCheck = null;                  // vérification du diagnostic dépliée (indice)
        var _target = null;                     // { id, svc, fields, sample, error }
        var _targetIdx = 0;
        var _mapping = {};                      // attribut -> champ de la table

        function _getMap() {
            try {
                var mapView = $injector.get('acfMapService').getMapViewImmediate();
                return mapView && mapView.getNativeMap();
            } catch (e) {
                console.warn('[geo-recolement] Carte GEO introuvable :', e);
                return null;
            }
        }

        function _esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
        function _fmtLen(m) { return m.toFixed(1).replace('.', ',') + ' m'; }
        function _fmtInt(m) { return Math.round(m).toLocaleString('fr-FR'); }
        function _z(v) { return v === null || v === undefined ? '—' : Number(v).toFixed(2).replace('.', ','); }

        function _store(key, value) {
            try {
                if (value === undefined) { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; }
                window.localStorage.setItem(key, JSON.stringify(value));
            } catch (e) { /* stockage indisponible : la correspondance n'est alors pas mémorisée */ }
            return null;
        }

        function _rgba(hex, a) {
            var n = parseInt(hex.slice(1), 16);
            return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
        }

        // ============================================================
        // Calques OpenLayers
        // ============================================================
        function _ensureLayer() {
            if (_layers) { return true; }
            _map = _getMap();
            var ol = window.ol;
            if (!_map || !ol) { return false; }
            var S = ol.style, cache = {};
            function memo(key, make) { return cache[key] || (cache[key] = make()); }

            function dot(color, r) {
                return memo('p' + color + r, function () {
                    return new S.Style({ image: new S.Circle({ radius: r, fill: new S.Fill({ color: color }), stroke: new S.Stroke({ color: '#fff', width: r > 3 ? 1.5 : 0.5 }) }) });
                });
            }
            function make(zIndex, style, opts) {
                var source = new ol.source.Vector();
                var layer = new ol.layer.Vector(Object.assign({ source: source, zIndex: zIndex, style: style }, opts || {}));
                _map.addLayer(layer);
                return { source: source, layer: layer };
            }
            var polygon = make(994, function (f) {
                var c = f.get('color');
                return memo('s' + c, function () {
                    return new S.Style({ fill: new S.Fill({ color: _rgba(c, 0.16) }), stroke: new S.Stroke({ color: c, width: 1.2 }) });
                });
            });
            var line = make(995, function (f, res) {
                var c = f.get('color'), w = f.get('width'), dash = f.get('dash');
                var st = memo('l' + c + w + (dash ? 'd' : ''), function () {
                    return new S.Style({ stroke: new S.Stroke({ color: c, width: w, lineDash: dash ? [8, 6] : undefined }) });
                });
                var arrow = f.get('arrow');
                if (!arrow || res > ARROW_MAX_RES) { return st; }
                var head = f.get('arrowStyle');
                if (!head) {
                    head = new S.Style({ geometry: new ol.geom.Point(arrow.at), image: new S.RegularShape({
                        points: 3, radius: 6, rotation: arrow.rot, rotateWithView: true, fill: new S.Fill({ color: c }), stroke: new S.Stroke({ color: '#fff', width: 1 }) }) });
                    f.set('arrowStyle', head, true);
                }
                return [st, head];
            });
            var text = make(997, function (f, res) {
                if (res > TEXT_MAX_RES) { return null; }
                var st = f.get('textStyle');
                if (!st) {
                    st = new S.Style({ text: new S.Text({ text: f.get('text'), rotation: -(f.get('rotation') || 0) * Math.PI / 180, font: '11px "Open Sans",Helvetica,Arial,sans-serif',
                        fill: new S.Fill({ color: f.get('color') }), stroke: new S.Stroke({ color: '#fff', width: 3 }) }) });
                    f.set('textStyle', st, true);
                }
                return st;
            }, { declutter: true });
            var hl = make(998, function (f) {
                var color = f.get('diag') ? '#ff9800' : f.get('sel') ? '#d93025' : '#2f81f7', w = f.get('sel') ? 5 : 3;
                if (f.getGeometry().getType() === 'Point') {
                    return memo('hp' + color, function () {
                        return new S.Style({ image: new S.Circle({ radius: 10, fill: new S.Fill({ color: _rgba(color, 0.35) }), stroke: new S.Stroke({ color: color, width: 2.5 }) }) });
                    });
                }
                return memo('hl' + color + w, function () {
                    return [new S.Style({ stroke: new S.Stroke({ color: '#fff', width: w + 3 }) }), new S.Style({ stroke: new S.Stroke({ color: color, width: w }) })];
                });
            });
            var point = make(999, function (f) {
                var st = f.get('state');
                if (st === 'sel') { return dot('#2f81f7', 9); }
                if (st === 'done') { return dot('#188038', 6); }
                return dot(f.get('color'), f.get('r'));
            });
            _layers = { polygon: polygon, line: line, text: text, hl: hl, point: point };
            return true;
        }

        // Le panneau recouvre la droite de la carte : on cadre dans la partie visible.
        function _fit(ext, pad, maxZoom, duration) {
            var size = _map.getSize(), right = pad + (size ? size[0] * _panelWidthPct / 100 : 0);
            _map.getView().fit(ext, { padding: [pad, right, pad, pad], maxZoom: maxZoom, duration: duration });
        }

        function _setVisible(on) {
            if (_layers) { Object.keys(_layers).forEach(function (k) { _layers[k].layer.setVisible(on); }); }
        }

        function _toMap(x, y) {
            var ll = proj4(_impCrs, 'EPSG:4326', [x, y]);
            return window.ol.proj.transform(ll, 'EPSG:4326', _map.getView().getProjection());
        }

        function _inFrance(x, y) {
            var ll = proj4(_impCrs, 'EPSG:4326', [x, y]);
            return ll[0] > -6 && ll[0] < 10 && ll[1] > 41 && ll[1] < 52;
        }

        function _toMapLine(pts) { return pts.map(function (q) { return _toMap(q[0], q[1]); }); }

        // Flèche au milieu d'une canalisation orientée, dans le sens de l'eau
        function _arrowOf(coords, flow) {
            var line = flow === 'rev' ? coords.slice().reverse() : coords, i = Math.floor((line.length - 1) / 2), a = line[i], b = line[i + 1];
            return { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], rot: Math.atan2(b[0] - a[0], b[1] - a[1]) };
        }

        // Feature OpenLayers d'un objet du modèle : créée une fois, conservée d'un filtrage à l'autre.
        function _featureOf(f) {
            var cached = _ol.get(f.ref);
            if (cached) { return cached; }
            var ol = window.ol, props = { kind: f.geom, idx: f.idx, trade: f.trade, color: f.color };
            if (f.geom === 'point') {
                props.state = 'pt';
                props.r = f.trade === 'fond-de-plan' ? 2.5 : f.attrs ? 6 : 4;
                props.geometry = new ol.geom.Point(_toMap(f.x, f.y));
            } else if (f.geom === 'text') {
                props.text = f.text;
                props.rotation = f.rotation;
                props.geometry = new ol.geom.Point(_toMap(f.x, f.y));
            } else if (f.geom === 'polygon') {
                props.geometry = new ol.geom.Polygon(f.rings.map(function (r) { var c = _toMapLine(r); return c.concat([c[0]]); }));
            } else {
                var coords = _toMapLine(f.pts), pipe = _pipeByRef.get(f.ref);
                props.width = pipe ? 2.5 : f.trade === 'fond-de-plan' ? 1 : 1.4;
                if (pipe && pipe.pipe.flow) { props.arrow = _arrowOf(coords, pipe.pipe.flow); }
                props.geometry = new ol.geom.LineString(coords);
            }
            var feat = new ol.Feature(props);
            _ol.set(f.ref, feat);
            return feat;
        }

        // Tronçon reconstitué : tireté, rouge en contre-pente, jamais confondu avec ce que le plan dessine.
        function _featureOfSegment(s, color) {
            var cached = _ol.get(s);
            if (cached) { return cached; }
            var coords = _toMapLine(s.pts);
            var feat = new window.ol.Feature({
                kind: 'segment', seg: s, prefix: s.prefix, width: s.doubts.length ? 1 : 2, dash: true,
                color: s.doubts.length ? '#9a9a9a' : s.status === 'contre-pente' ? '#d93025' : color,
                geometry: new window.ol.geom.LineString(coords)
            });
            _ol.set(s, feat);
            return feat;
        }

        function _isShown(f) {
            return !_offTrades[f.trade] && !_offNets[f.trade + '|' + f.network] && !_offLayers[f.layer] && !(f.block && _offBlocks[f.layer + '|' + f.block]);
        }

        function _segShown(c, prefix) { return !_offTrades[c.trade] && !_offNets[c.trade + '|' + c.network] && !_offSegs[prefix]; }
        function _doubtShown(c, prefix) { return !_offTrades[c.trade] && !_offNets[c.trade + '|' + c.network] && !!_onDoubts[prefix]; }

        // Affiche ce que le filtre laisse passer ; recentre la carte si demandé. La sélection reste si son objet reste affiché.
        function _draw(fit) {
            if (!_ensureLayer()) { return; }
            ['polygon', 'line', 'text', 'point'].forEach(function (k) { _layers[k].source.clear(); });
            if (!_plan) { _selected = null; _drawHighlight(); _renderSheet(); return; }
            var lists = { polygon: [], line: [], text: [], point: [] };
            _plan.model.features.forEach(function (f) { if (_isShown(f)) { lists[f.geom].push(_featureOf(f)); } });
            Object.keys(_plan.model.nets).forEach(function (p) {
                var c = T.classify(p + '_Symboles');
                _plan.model.nets[p].segments.forEach(function (s) {
                    if (s.doubts.length ? _doubtShown(c, p) : _segShown(c, p)) { lists.line.push(_featureOfSegment(s, c.color)); }
                });
            });
            var ext = window.ol.extent.createEmpty();
            Object.keys(lists).forEach(function (k) {
                if (lists[k].length) {
                    _layers[k].source.addFeatures(lists[k]);
                    if (k !== 'text') { window.ol.extent.extend(ext, _layers[k].source.getExtent()); }
                }
            });
            if (_selected && !_inSources(_selected)) { _setSelected(null); }
            if (fit && !window.ol.extent.isEmpty(ext)) {
                _fit(ext, 60, 20, 300);
            }
            _drawHighlight();
            _renderSheet();
        }

        function _inSources(f) {
            var k = f.get('kind');
            return _layers[k === 'segment' ? 'line' : k].source.hasFeature ? _layers[k === 'segment' ? 'line' : k].source.hasFeature(f) : true;
        }

        // ============================================================
        // Sélection
        // ============================================================
        function _setSelected(f) {
            if (_selected && _selected.get('kind') === 'point' && _selected.get('state') === 'sel') { _selected.set('state', _selected.get('was') || 'pt'); }
            _selected = f;
            if (f && f.get('kind') === 'point') {
                f.set('was', f.get('state'));
                f.set('state', 'sel');
            }
        }

        function _select(f) {
            if (f === _selected) { return; }
            _setSelected(f);
            _drawHighlight();
            _showObjectTab();
        }

        // Ouvre la fiche ; depuis le diagnostic, retient l'onglet pour pouvoir y revenir.
        function _showObjectTab() {
            if (_tab !== 'object') { _backTab = _tab === 'diag' ? 'diag' : null; }
            _setTab('object');
        }

        function _onMapClick(evt) {
            if (!_layers || !_layers.point.layer.getVisible()) { return; }
            var order = ['point', 'text', 'line', 'polygon'], hit = null;
            for (var i = 0; i < order.length && !hit; i++) {
                var target = _layers[order[i]].layer;
                hit = _map.forEachFeatureAtPixel(evt.pixel, function (ft) { return ft; }, { layerFilter: function (l) { return l === target; }, hitTolerance: 5 }) || null;
            }
            if (hit) { _select(hit); }
        }

        // Rend l'objet affiché, le choisit et y amène la carte : depuis le diagnostic ou d'une extrémité à l'autre.
        function _goRef(ref) {
            var mf = _plan.model.byRef.get(ref);
            if (ref && ref.pts && ref.prefix) {
                if (ref.doubts.length) { _onDoubts[ref.prefix] = true; } else { _offSegs[ref.prefix] = false; }
                _reveal(T.classify(ref.prefix + '_Symboles'));
            }
            else if (mf) {
                _offLayers[mf.layer] = false;
                if (mf.block) { _offBlocks[mf.layer + '|' + mf.block] = false; }
                _reveal(mf);
            } else {
                _flash('Cet objet n\'est pas affiché à part : il est fusionné avec un regard.');
                return;
            }
            _draw(false);
            var feat = _ol.get(ref);
            if (!feat) { return; }
            if (feat === _selected) { _showObjectTab(); } else { _select(feat); }
            _fit(feat.getGeometry().getExtent(), 120, 20, 250);
        }

        function _reveal(c) {
            _offTrades[c.trade] = false;
            _offNets[c.trade + '|' + c.network] = false;
        }

        // Surligne l'objet choisi, ses canalisations et les objets de la vérification ouverte.
        function _drawHighlight(pipeIdx) {
            if (!_layers) { return; }
            var src = _layers.hl.source, ol = window.ol;
            src.clear();
            if (!_plan) { return; }
            var check = _openCheck !== null ? _plan.diag.checks[_openCheck] : null;
            if (check) {
                check.items.forEach(function (it) {
                    var g = _geometryOf(it.ref);
                    if (g) { src.addFeature(new ol.Feature({ diag: true, geometry: g })); }
                });
            }
            if (!_selected) { return; }
            var k = _selected.get('kind');
            if (k === 'point') {
                var t = _currentTree();
                if (t) { t.tree.pipes.forEach(function (p) { src.addFeature(new ol.Feature({ sel: p.pipe.idx === pipeIdx, geometry: new ol.geom.LineString(_toMapLine(p.pipe.pts)) })); }); }
            } else if (k !== 'text') {
                src.addFeature(new ol.Feature({ sel: true, geometry: _selected.getGeometry().clone() }));
            }
        }

        function _geometryOf(ref) {
            if (_ol.get(ref)) { return _ol.get(ref).getGeometry().clone(); }
            var mf = _plan.model.byRef.get(ref);
            if (mf) { return _featureOf(mf).getGeometry().clone(); }
            return ref.pts ? new window.ol.geom.LineString(_toMapLine(ref.pts)) : null;
        }

        // ============================================================
        // Import du plan
        // ============================================================
        function _importFile(file) {
            if (!file) { return; }
            if (/\.dwg$/i.test(file.name)) {
                _flash('Le DWG n\'est pas lu : enregistrez le plan en DXF (AutoCAD : ENREGISTRERSOUS, DXF 2018) et déposez ce fichier.');
                return;
            }
            if (!/\.dxf$/i.test(file.name)) { _flash('Seuls les fichiers DXF sont lus.'); return; }
            _flash('Lecture de ' + file.name + '…');
            file.arrayBuffer().then(function (buffer) {
                // Un ticket d'attente pour laisser s'afficher le message avant le calcul
                return new Promise(function (ok) { setTimeout(function () { ok(D.parseBlocks(buffer)); }, 20); });
            }).then(function (r) {
                var model = G.buildModel(r);
                _plan = { name: file.name, raw: r, model: model, diag: X.diagnose(model, { crs: _impCrs }) };
                _ol = new Map();
                _pipeByRef = new Map();
                Object.keys(model.nets).forEach(function (p) {
                    model.nets[p].pipes.forEach(function (pp) { _pipeByRef.set(pp.ref, { net: model.nets[p], pipe: pp }); });
                });
                _setSelected(null);
                _openCheck = null;
                _defaultFilter();
                _renderPanel();
                _draw(true);
                var first = model.features.filter(function (f) { return f.geom === 'point'; })[0];
                var warn = [];
                if (!model.features.length) { warn.push('Rien de reconnu : les calques du plan ne suivent pas la charte (TOPO_<réseau>_<thème>).'); }
                if (first && !_inFrance(first.x, first.y)) { warn.push('Le plan tombe hors de France avec la projection ' + _impCrs + ' : vérifiez la projection du module.'); }
                if (r.units !== null && r.units !== 0 && r.units !== 6) { warn.push('Unité du dessin non métrique (INSUNITS = ' + r.units + ').'); }
                _flash(warn.join(' '));
            }).catch(function (e) {
                console.warn('[geo-recolement] Lecture impossible :', e);
                _flash('Lecture impossible : ' + e.message);
            });
        }

        // Au départ : tous les métiers, sans le fond de plan ; quand on l'ouvre, sans les 8 000 points levés ni les hachures de talus.
        function _defaultFilter() {
            _offTrades = { 'fond-de-plan': true };
            _offNets = {};
            _offBlocks = {};
            _offSegs = {};
            _onDoubts = {};
            _offLayers = {};
            _open = {};
            _tab = 'layers';
            _backTab = null;
            _plan.model.tree.forEach(function (t) {
                _open['t:' + t.trade] = t.trade !== 'fond-de-plan';
                t.networks.forEach(function (n) {
                    n.layers.forEach(function (l) { if (/_Points_|_Relief_Habillages$/.test(l.layer)) { _offLayers[l.layer] = true; } });
                });
            });
            if (_targets.length) { _initMapping(); }
        }

        // Attributs des ouvrages affichés qui en portent, pour la correspondance avec les champs de la table
        function _tags() {
            var set = {};
            if (_plan) {
                _plan.model.features.forEach(function (f) {
                    if (f.geom === 'point' && f.attrs && _isShown(f)) { Object.keys(f.attrs).forEach(function (t) { set[t] = true; }); }
                });
            }
            return Object.keys(set).sort();
        }

        // ============================================================
        // Fiches de l'objet choisi
        // ============================================================
        function _currentObject() {
            if (!_selected || !_plan || _selected.get('kind') === 'segment') { return null; }
            return _plan.model.features[_selected.get('idx')];
        }

        function _nodeOf(o) {
            var net = _plan.model.nets[o.prefix];
            if (!net) { return null; }
            var i;
            for (i = 0; i < net.regards.length; i++) { if (net.regards[i].ref === o.ref) { return { net: net, node: { regard: i } }; } }
            i = net.symbols.indexOf(o.ref);
            return i >= 0 ? { net: net, node: { sym: i } } : null;
        }

        // Arbre du point choisi s'il appartient à un réseau, sinon null
        function _currentTree() {
            var o = _currentObject();
            if (!o || o.geom !== 'point') { return null; }
            var n = _nodeOf(o);
            return n ? { net: n.net, tree: N.treeOfNode(n.net, n.node) } : null;
        }

        function _level(v) { return v === undefined || v === null ? '' : M.isBlank(v) ? '<i>non relevé</i>' : '<b>' + _esc(String(v).replace('.', ',')) + '</b>'; }

        // Objet à une extrémité : regard (numéro), symbole (type) ou rien ; lien vers l'objet quand il est dans le plan.
        function _endHtml(net, ref) {
            if (ref && ref.regard !== undefined) {
                var r = net.regards[ref.regard];
                return '<a href="#" class="geo-recolement-go" data-go="r' + ref.regard + '@' + _esc(net.prefix) + '"><b>' + _esc(r.id) + '</b></a>' +
                    (r.symbol && N.symbolLabel(r.symbol) ? ' (' + _esc(N.symbolLabel(r.symbol)) + ')' : '');
            }
            if (ref && ref.symbol) {
                var lb = N.symbolLabel(ref.symbol);
                return '<a href="#" class="geo-recolement-go" data-go="s' + ref.sym + '@' + _esc(net.prefix) + '">' + _esc(ref.symbol) + (lb ? ' (' + _esc(lb) + ')' : '') + '</a>';
            }
            return 'bout libre';
        }

        function _segLink(s, text) { return '<a href="#" class="geo-recolement-go" data-seg="' + s.idx + '@' + _esc(s.prefix) + '">' + text + '</a>'; }
        function _pipeLink(net, pp, text) { return '<a href="#" class="geo-recolement-go" data-pf="' + pp.idx + '@' + _esc(net.prefix) + '">' + text + '</a>'; }

        function _goKey(key) {
            var m = /^([rs])(\d+)@(.*)$/.exec(key), net = m && _plan.model.nets[m[3]];
            if (net) { _goRef(m[1] === 'r' ? net.regards[+m[2]].ref : net.symbols[+m[2]]); }
        }

        function _caracHtml(pp) {
            var dg = pp.dg, carac = [];
            if (!dg) { return '<div class="geo-recolement-note">Caractéristiques non relevées sur le plan.</div>'; }
            if (!M.isBlank(dg.mat)) { carac.push(_esc(X.normMaterial(dg.mat))); }
            if (!M.isBlank(dg.diam)) { carac.push('Ø' + _esc(dg.diam)); }
            return '<div class="geo-recolement-note">' + (carac.join(' · ') || 'matériau et diamètre non relevés') + '</div>';
        }

        function _pipeRow(t, p) {
            var net = t.net, seg = p.pipe.seg, who;
            if (!p.other && seg) {
                var far = seg.a === p.pipe ? seg.down : seg.up;
                who = _endHtml(net, far) + ' ' + _segLink(seg, '<span class="geo-recolement-tags">' + (seg.doubts.length ? 'tronçon douteux' : 'tronçon reconstitué') + '</span>');
            } else {
                who = _endHtml(net, p.other);
            }
            var arrow = p.role === 'out' ? '→ vers ' : p.role === 'in' ? '← depuis ' : '↔ ';
            var o = [arrow + who + ' ' + _pipeLink(net, p.pipe, '<span class="geo-recolement-tags">' + _fmtLen(N.lengthOf(p.pipe.pts)) + '</span>')];
            o.push(_caracHtml(p.pipe));
            if (!p.pipe.dg) { return o.join(''); }
            if (p.role) {
                var cmp = '', rad = t.tree.regard ? M.parseNumber(t.tree.regard.attrs.RADIER) : null, here = M.parseNumber(p.here);
                if (rad !== null && here !== null) {
                    var dz = here - rad;
                    cmp = Math.abs(dz) < 0.005 ? ' (= radier)' : ' (' + (dz > 0 ? '+' : '−') + Math.abs(dz).toFixed(2).replace('.', ',') + ' m / radier)';
                }
                o.push('<div class="geo-recolement-note">Fil d\'eau ici : ' + _level(p.here) + cmp + ' · à l\'autre bout : ' + _level(p.there) + '</div>');
            } else {
                o.push('<div class="geo-recolement-note">Sens d\'écoulement inconnu · amont : ' + _level(p.pipe.dg.amont) + ' · aval : ' + _level(p.pipe.dg.aval) + '</div>');
            }
            return o.join('');
        }

        function _treeHtml(t) {
            if (!t) { return ''; }
            var o = ['<div class="geo-recolement-tree"><div class="geo-recolement-sub">Rattachements</div><ul>'];
            if (t.tree.regard && t.tree.symbol) {
                var lb = N.symbolLabel(t.tree.symbol);
                o.push('<li>Symbole : <b>' + _esc(t.tree.symbol) + '</b>' + (lb ? ' — ' + _esc(lb) : '') + '</li>');
            }
            t.tree.pipes.forEach(function (p) {
                o.push('<li class="geo-recolement-pipe" data-pipe="' + p.pipe.idx + '">' + _pipeRow(t, p) + '</li>');
            });
            if (!t.tree.pipes.length) { o.push('<li>Aucune canalisation rattachée (extrémité à moins de 0,5 m).</li>'); }
            o.push('</ul></div>');
            return o.join('');
        }

        function _statusHtml(status, oriented) {
            if (status === 'ok') { return '<div class="geo-recolement-r geo-recolement-r--ok">Les cotes sont cohérentes avec le sens d\'écoulement.</div>'; }
            if (status === 'contre-pente') { return '<div class="geo-recolement-r geo-recolement-r--bad">Contre-pente : l\'eau remonterait d\'après les cotes.</div>'; }
            return '<div class="geo-recolement-note">' + (oriented === false ? 'Sens d\'écoulement inconnu.' : 'Cotes insuffisantes pour vérifier le sens.') + '</div>';
        }

        // Fiche d'une canalisation : ses deux extrémités, et le tronçon reconstitué si elle en est une amorce
        function _pipeSheetHtml(net, pp) {
            var sh = N.pipeSheet(net, pp.idx), c = T.classify(net.prefix + '_Symboles');
            var o = ['<div class="geo-recolement-sub">Canalisation · ' + _esc(c.network) + ' · ' + _fmtLen(N.lengthOf(pp.pts)) + '</div>'];
            o.push(_caracHtml(pp));
            o.push('<div class="geo-recolement-tree"><ul>');
            sh.ends.forEach(function (e) {
                var up = pp.flow ? ((e.end === 'from') === (pp.flow === 'fwd')) : null;
                var tag = up === null ? (e.end === 'from' ? 'Début' : 'Fin') : up ? 'Amont' : 'Aval';
                o.push('<li>' + tag + ' : ' + _endHtml(net, e.ref) + (e.fil !== undefined ? ' · fil d\'eau ' + _level(e.fil) : '') + '</li>');
            });
            o.push('</ul></div>');
            if (!pp.flow) { o.push('<div class="geo-recolement-note">Sens d\'écoulement inconnu : aucune flèche sur le plan.</div>'); }
            if (pp.seg) {
                o.push('<div class="geo-recolement-note">Amorce du ' + _segLink(pp.seg, pp.seg.doubts.length ? 'tronçon douteux' : 'tronçon reconstitué') + ' ' + _endHtml(net, pp.seg.up) + ' → ' + _endHtml(net, pp.seg.down) + '.</div>');
            } else if (pp.from && pp.to) {
                var sl = N.pipeSlope(net, pp);
                if (sl.slope !== null) { o.push('<div class="geo-recolement-note">Pente : <b>' + (sl.slope * 100).toFixed(2).replace('.', ',') + ' %</b> (' + _z(sl.zUp) + ' → ' + _z(sl.zDown) + ')</div>'); }
                o.push(_statusHtml(sl.status, !!pp.flow));
            } else if (!pp.from !== !pp.to) {
                o.push('<div class="geo-recolement-note">Aucune amorce alignée en face : branchement, fin de réseau, ou suite hors du plan.</div>');
            }
            return o.join('');
        }

        function _segSheetHtml(s) {
            var net = _plan.model.nets[s.prefix], c = T.classify(s.prefix + '_Symboles'), o = [];
            o.push('<div class="geo-recolement-sub">Tronçon ' + (s.doubts.length ? 'douteux' : 'reconstitué') + ' · ' + _esc(c.network) + ' · ' + _fmtLen(s.length) + '</div>');
            if (s.doubts.length) { o.push('<div class="geo-recolement-r geo-recolement-r--bad">Peu crédible : ' + _esc(s.doubts.join(', ')) + '. Non compté dans le linéaire.</div>'); }
            o.push('<div class="geo-recolement-note">Le plan ne le dessine pas : déduit de deux amorces qui se font face, séparées de ' + _fmtLen(s.gap) + '. À confirmer.</div>');
            var carac = [];
            if (s.mat) { carac.push(_esc(X.normMaterial(s.mat))); }
            if (s.diam) { carac.push('Ø' + _esc(s.diam)); }
            if (carac.length) { o.push('<div class="geo-recolement-note">' + carac.join(' · ') + (s.diamDiff ? ' — <b>diamètres différents aux deux bouts</b>' : '') + '</div>'); }
            o.push('<div class="geo-recolement-tree"><ul>');
            o.push('<li>' + (s.oriented ? 'Amont' : 'Bout 1') + ' : ' + _endHtml(net, s.up) + ' · cote ' + _z(s.zUp) + ' · ' + _pipeLink(net, s.a, 'amorce') + '</li>');
            o.push('<li>' + (s.oriented ? 'Aval' : 'Bout 2') + ' : ' + _endHtml(net, s.down) + ' · cote ' + _z(s.zDown) + ' · ' + _pipeLink(net, s.b, 'amorce') + '</li>');
            o.push('</ul></div>');
            if (s.slope !== null) { o.push('<div class="geo-recolement-note">Pente : <b>' + (s.slope * 100).toFixed(2).replace('.', ',') + ' %</b></div>'); }
            o.push(_statusHtml(s.status, s.oriented));
            return o.join('');
        }

        function _attrsHtml(attrs) {
            var o = ['<table class="geo-recolement-attrs">'];
            Object.keys(attrs).forEach(function (t) {
                o.push('<tr><th>' + _esc(t) + '</th><td>' + (M.isBlank(attrs[t]) ? '<i>non renseigné</i>' : _esc(attrs[t])) + '</td></tr>');
            });
            o.push('</table>');
            return o.join('');
        }

        function _originHtml(f) {
            var tr = T.tradeOf(f.trade);
            return '<div class="geo-recolement-note">' + _esc(tr.label) + ' · ' + _esc(f.network) + ' · ' + _esc(T.themeLabel(f.theme)) + '</div>';
        }

        function _insertFormHtml(b) {
            if (!_targets.length) { return ''; }
            var o = [], done = _selected.get('done');
            var mapped = Object.keys(b.attrs).filter(function (t) { return _mapping[t]; });
            var values = M.formValues(b.attrs, _mapping, null);
            if (mapped.length) { o.push('<div class="geo-recolement-sub">Valeurs à insérer</div>'); }
            mapped.forEach(function (t) {
                var f = _mapping[t];
                o.push('<label class="geo-recolement-row" title="Attribut du plan : ' + _esc(t) + '"><span>' + _esc(f) + '</span>' +
                    '<input class="geo-recolement-in" data-field="' + _esc(f) + '" value="' + _esc(values[f] === undefined ? '' : values[f]) + '"' + (done ? ' disabled' : '') + '></label>');
            });
            if (done) { o.push('<div class="geo-recolement-r geo-recolement-r--ok">Déjà inséré' + (done !== true ? ' (identifiant ' + _esc(done) + ')' : '') + '.</div>'); }
            else {
                var ok = _target && _target.svc && !_target.error && mapped.length;
                o.push('<div class="geo-recolement-btns"><button type="button" class="geo-recolement-btn" data-act="insert"' + (ok ? '' : ' disabled') + '>Insérer dans la table</button></div>');
            }
            return o.join('');
        }

        function _sheetHtml() {
            if (!_plan) { return ''; }
            if (!_selected) { return '<div class="geo-recolement-empty">Cliquez un objet de la carte pour afficher ce que le plan en dit et ses rattachements.</div>'; }
            var k = _selected.get('kind');
            if (k === 'segment') { return _segSheetHtml(_selected.get('seg')); }
            var f = _currentObject(), o = [];
            if (k === 'line' && _pipeByRef.has(f.ref)) {
                var p = _pipeByRef.get(f.ref);
                return _pipeSheetHtml(p.net, p.pipe);
            }
            if (k === 'point') {
                o.push('<div class="geo-recolement-sub">' + _esc((f.attrs && f.attrs.REGARD) || T.blockTitle(f.block)) + '</div>');
                o.push(_originHtml(f));
                o.push('<div class="geo-recolement-note">' + _esc(T.blockTitle(f.block)) + (f.symbol ? ' · symbole ' + _esc(T.blockTitle(f.symbol)) : '') + '</div>');
                if (f.notes) { o.push('<div class="geo-recolement-note">Annotation proche sur le plan : <b>' + f.notes.map(_esc).join(' · ') + '</b></div>'); }
                o.push(_treeHtml(_currentTree()));
                if (f.attrs) {
                    o.push('<div class="geo-recolement-sub">Attributs du plan</div>');
                    o.push(_attrsHtml(f.attrs));
                    o.push(_insertFormHtml(f));
                } else {
                    o.push('<div class="geo-recolement-note">Ce bloc du plan ne porte aucun attribut : seuls son type, son réseau et sa position sont connus.</div>');
                }
                return o.join('');
            }
            if (k === 'text') {
                o.push('<div class="geo-recolement-sub">« ' + _esc(f.text) + ' »</div>');
                o.push(_originHtml(f));
                return o.join('');
            }
            if (k === 'polygon') {
                o.push('<div class="geo-recolement-sub">Surface · ' + _esc(T.themeLabel(f.theme)) + '</div>');
                o.push(_originHtml(f));
                o.push('<div class="geo-recolement-note">Surface : <b>' + G.area(f.rings).toFixed(1).replace('.', ',') + ' m²</b> · périmètre : ' + _fmtLen(G.perimeter(f.rings[0])) +
                    (f.hatch ? ' · hachure du plan' : '') + '</div>');
                return o.join('');
            }
            o.push('<div class="geo-recolement-sub">Ligne · ' + _esc(T.themeLabel(f.theme)) + '</div>');
            o.push(_originHtml(f));
            o.push('<div class="geo-recolement-note">Longueur : <b>' + _fmtLen(N.lengthOf(f.pts)) + '</b></div>');
            return o.join('');
        }

        // ============================================================
        // Table cible (fiche info éditable) : facultatif
        // ============================================================
        function _loadTarget() {
            var t = _targets[_targetIdx];
            _target = { id: t && t.id, svc: null, fields: [], sample: {}, error: '' };
            if (!t) { _target.error = 'Aucune table cible n\'est configurée dans le Générateur GEO.'; return; }
            try {
                var func = geoApplication.getFunctionalityById(t.id);
                if (!func || typeof func.getService !== 'function') { throw new Error('fiche info introuvable'); }
                _target.svc = func.getService();
                var sk = _target.svc.getTransactionBuilder().getFeatureSkeleton();
                _target.sample = (sk && sk.properties) || {};
                _target.fields = Object.keys(_target.sample);
                if (!_target.fields.length) { _target.error = 'Cette fiche info n\'a aucun champ modifiable : la création d\'objets est-elle autorisée ?'; }
            } catch (e) {
                console.warn('[geo-recolement] Fiche info inutilisable :', e);
                _target.error = 'Fiche info inutilisable (' + e.message + ').';
            }
        }

        function _mappingKey() { return 'geo-recolement:mapping:' + (_target && _target.id); }

        function _initMapping() {
            if (!_target) { _loadTarget(); }
            _mapping = M.initialMapping(_tags(), _target.fields, _mappingSpec, _store(_mappingKey()));
        }

        function _insert() {
            if (!_selected || !_target || !_target.svc) { return; }
            var btn = _panelEl.querySelector('[data-act="insert"]');
            var values = {};
            Array.prototype.forEach.call(_panelEl.querySelectorAll('[data-field]'), function (i) { values[i.getAttribute('data-field')] = i.value; });
            var bad = M.invalidNumbers(values, _target.sample);
            if (bad.length) { _flash('Valeur non numérique pour : ' + bad.join(', ') + '.'); return; }
            var props = M.coerce(values, _target.sample);
            if (!Object.keys(props).length) { _flash('Aucune valeur à insérer : associez au moins un attribut à un champ.'); return; }
            var b = _currentObject();
            var feature = { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: proj4(_impCrs, 'EPSG:4326', [b.x, b.y]), crs: 'EPSG:4326' } };
            var f = _selected, builder = _target.svc.getTransactionBuilder();
            builder.addFeature(feature, true);
            var uuid = builder.getUuid(), settled = false;
            if (btn) { btn.disabled = true; }
            _flash('Insertion en cours…');
            _target.svc.saveOperations(builder.build()).subscribe(function (res) {
                if (settled) { return; }
                settled = true;
                var list = Array.isArray(res) ? res : (res && res.result) || [];
                var d = list.filter(function (x) { return x && x.id === uuid; })[0] || list[0] || {};
                var ids = d.created ? [].concat(d.created) : [];
                f.set('was', 'done');
                if (f.get('state') !== 'sel') { f.set('state', 'done'); }
                f.set('done', ids.length ? ids.join(', ') : true);
                _flash('Inséré dans la table' + (ids.length ? ' (identifiant ' + ids.join(', ') + ')' : '') + '.');
                _renderSheet();
            }, function (err) {
                console.warn('[geo-recolement] Transaction refusée :', err);
                _flash('Insertion refusée : ' + ((err && (err.message || err.statusText)) || 'erreur du serveur') + '.');
                if (btn) { btn.disabled = false; }
            });
        }

        function _targetHtml() {
            if (!_target) { _loadTarget(); if (_plan) { _initMapping(); } }
            var o = [];
            if (_targets.length > 1) {
                o.push('<label class="geo-recolement-lbl">Table</label><select class="geo-recolement-in" data-f="target">');
                _targets.forEach(function (t, i) { o.push('<option value="' + i + '"' + (i === _targetIdx ? ' selected' : '') + '>' + _esc(t.name) + '</option>'); });
                o.push('</select>');
            } else if (_targets[0]) {
                o.push('<div class="geo-recolement-sub">' + _esc(_targets[0].name) + '</div>');
            }
            if (_target.error) { o.push('<div class="geo-recolement-r geo-recolement-r--bad">' + _esc(_target.error) + '</div>'); return o.join(''); }
            var tags = _tags();
            if (!tags.length) { o.push('<div class="geo-recolement-note">Déposez un plan pour associer ses attributs aux champs de la table.</div>'); return o.join(''); }
            o.push('<div class="geo-recolement-note">Attribut du plan → champ de la table</div>');
            tags.forEach(function (tag) {
                o.push('<label class="geo-recolement-row"><span>' + _esc(tag) + '</span><select class="geo-recolement-in" data-f="map" data-t="' + _esc(tag) + '">' +
                    '<option value="">— ignorer —</option>' +
                    _target.fields.map(function (f) { return '<option value="' + _esc(f) + '"' + (_mapping[tag] === f ? ' selected' : '') + '>' + _esc(f) + '</option>'; }).join('') +
                    '</select></label>');
            });
            return o.join('');
        }

        // ============================================================
        // Panneau
        // ============================================================
        function _flash(text) {
            if (text) { console.warn('[geo-recolement] ' + text); }
            if (_panelEl) { var m = _panelEl.querySelector('[data-r="msg"]'); if (m) { m.textContent = text || ''; } }
        }

        function _buildPanel() {
            _panelEl = document.createElement('div');
            _panelEl.className = 'geo-recolement-panel';
            _panelEl.addEventListener('click', _onPanelClick);
            _panelEl.addEventListener('change', _onPanelChange);
            var inDrop = function (e) { return e.target.closest && e.target.closest('.geo-recolement-drop'); };
            _panelEl.addEventListener('dragover', function (e) { var z = inDrop(e); if (z) { e.preventDefault(); z.classList.add('geo-recolement-drop--over'); } });
            _panelEl.addEventListener('dragleave', function (e) { var z = inDrop(e); if (z) { z.classList.remove('geo-recolement-drop--over'); } });
            _panelEl.addEventListener('drop', function (e) {
                var z = inDrop(e);
                if (z) { e.preventDefault(); z.classList.remove('geo-recolement-drop--over'); _importFile(e.dataTransfer.files[0]); }
            });
            _renderPanel();
        }

        function _renderPanel() {
            if (!_panelEl) { return; }
            var msg = _panelEl.querySelector('[data-r="msg"]'), keep = msg ? msg.textContent : '';
            var o = ['<div class="geo-recolement-head">'];
            if (_plan) {
                o.push('<label class="geo-recolement-drop geo-recolement-drop--bar"><input type="file" accept=".dxf,.dwg" data-f="file" hidden>' +
                    '<span class="geo-recolement-file">' + _esc(_plan.name) + '</span><u>Changer de plan</u></label>');
                o.push(_planHtml());
            } else {
                o.push('<label class="geo-recolement-drop"><input type="file" accept=".dxf,.dwg" data-f="file" hidden>' +
                    '<b>Déposez un plan de récolement au format DXF</b><br>ou <u>choisissez un fichier</u>' +
                    '<div class="geo-recolement-note">Le plan est lu dans votre navigateur : rien n\'est envoyé ni enregistré.</div></label>');
            }
            o.push('<div class="geo-recolement-msg" data-r="msg"></div></div>');
            if (_plan) {
                o.push('<div class="geo-recolement-tabs" data-r="tabs">' + _tabsHtml() + '</div>');
                o.push('<div class="geo-recolement-body" data-r="body">' + _bodyHtml() + '</div>');
            }
            o.push('<div class="geo-recolement-foot">' + changelog.linkHtml() + '</div>');
            _panelEl.innerHTML = o.join('');
            _flash(keep);
        }

        function _tabsHtml() {
            var c = _plan.diag.counts, n = c.erreur + c.alerte;
            var tabs = [['layers', 'Couches', ''], ['diag', 'Contrôles', n ? '<span class="geo-recolement-lvl geo-recolement-lvl--' + (c.erreur ? 'erreur' : 'alerte') + '">' + n + '</span>' : ''],
                ['stats', 'Patrimoine', ''], ['object', 'Objet', _selected ? '<span class="geo-recolement-tabdot"></span>' : '']];
            if (_targets.length) { tabs.push(['target', 'Insertion', '']); }
            return tabs.map(function (t) {
                return '<button type="button" class="geo-recolement-tab' + (_tab === t[0] ? ' geo-recolement-tab--on' : '') + '" data-tab="' + t[0] + '">' + t[1] + t[2] + '</button>';
            }).join('');
        }

        function _bodyHtml() {
            switch (_tab) {
                case 'diag': return _diagHtml();
                case 'stats': return _statsHtml();
                case 'target': return _targetHtml();
                case 'object': return (_backTab && _selected ? '<a href="#" class="geo-recolement-back" data-back="1">← Retour aux contrôles</a>' : '') + '<div class="geo-recolement-sheet">' + _sheetHtml() + '</div>';
                default: return _filterHtml();
            }
        }

        function _setTab(tab) {
            _tab = tab;
            _partial('tabs', _tabsHtml());
            _partial('body', _bodyHtml());
        }

        // Ce que dit le cartouche
        function _planHtml() {
            var c = _plan.raw.cartouche;
            if (!c) { return '<div class="geo-recolement-note">Pas de cartouche lisible dans ce plan.</div>'; }
            var bits = [c.TITRE3, c.TITRE1, c.TITRE2].filter(function (x) { return x && x.trim(); }).map(function (x) { return _esc(x.trim()); });
            var meta = [c['DATE-CREA'], c.COORDONNEES, c.NIVELLEMENT, c.ECHELLE ? '1/' + c.ECHELLE : null]
                .filter(function (x) { return x && String(x).trim(); }).map(function (x) { return _esc(String(x).trim()); });
            return '<div class="geo-recolement-cart"><b>' + bits.join(' · ') + '</b><br>' + meta.join(' · ') + '</div>';
        }

        // Ligne de l'arbre : chevron, case, libellé, puis les décomptes alignés en colonnes (points, lignes, surfaces, textes).
        function _treeRow(depth, opts) {
            var c = opts.counts || {}, cells = ['point', 'line', 'polygon', 'text'].map(function (g) {
                return '<span class="geo-recolement-n">' + (c[g] ? _fmtInt(c[g]) : '') + '</span>';
            }).join('');
            var chevron = opts.toggle
                ? '<button type="button" class="geo-recolement-chev' + (_open[opts.toggle] ? ' geo-recolement-chev--open' : '') + '" data-toggle="' + _esc(opts.toggle) + '" aria-label="Déplier"></button>'
                : '<span></span>';
            var box = '<input type="checkbox" ' + opts.attrs + (opts.on ? ' checked' : '') + '>';
            var dot = opts.color ? '<span class="geo-recolement-dot" style="background:' + opts.color + '"></span>' : '';
            var name = '<span class="geo-recolement-name' + (opts.strong ? ' geo-recolement-name--strong' : '') + '" title="' + _esc(opts.title || opts.label) + '">' + dot + _esc(opts.label) + '</span>';
            var open = opts.toggle ? '<div' : '<label', close = opts.toggle ? '</div>' : '</label>';
            return open + ' class="geo-recolement-trow' + (opts.dim ? ' geo-recolement-trow--dim' : '') + '" style="padding-left:' + depth * 16 + 'px">' + chevron + box +
                (opts.toggle ? '<span class="geo-recolement-namewrap" data-toggle="' + _esc(opts.toggle) + '">' + name + '</span>' : name) + cells + close;
        }

        function _sumCounts(layers) {
            var total = { point: 0, line: 0, polygon: 0, text: 0 };
            layers.forEach(function (l) { Object.keys(total).forEach(function (g) { total[g] += l.counts[g]; }); });
            return total;
        }

        // Couches : métier > réseau > calque > type d'ouvrage
        function _filterHtml() {
            var o = ['<div class="geo-recolement-thead"><span></span><span></span><span>Couche</span><span title="Points">●</span><span title="Lignes">╱</span><span title="Surfaces">▱</span><span title="Textes">T</span></div>'];
            _plan.model.tree.forEach(function (t) {
                var tk = 't:' + t.trade, tOn = !_offTrades[t.trade], tTotal = { point: 0, line: 0, polygon: 0, text: 0 };
                t.networks.forEach(function (n) { var c = _sumCounts(n.layers); Object.keys(tTotal).forEach(function (g) { tTotal[g] += c[g]; }); });
                o.push('<div class="geo-recolement-trade">');
                o.push(_treeRow(0, { toggle: tk, attrs: 'data-f="trade" data-t="' + t.trade + '"', on: tOn, label: t.label, strong: true, counts: tTotal }));
                if (_open[tk]) {
                    t.networks.forEach(function (n) {
                        var key = t.trade + '|' + n.network, nk = 'n:' + key, nOn = !_offNets[key], dim = !tOn;
                        o.push(_treeRow(1, { toggle: nk, attrs: 'data-f="net" data-n="' + _esc(key) + '"', on: nOn, label: n.network, color: n.color, counts: _sumCounts(n.layers), dim: dim }));
                        if (!_open[nk]) { return; }
                        var inner = dim || !nOn;
                        if (n.segments) {
                            o.push(_treeRow(2, { attrs: 'data-f="segs" data-p="' + _esc(n.prefix) + '"', on: !_offSegs[n.prefix], label: 'Tronçons reconstitués (tireté)', title: 'Déduits de deux amorces qui se font face : le plan ne les dessine pas', counts: { line: n.segments }, dim: inner }));
                        }
                        if (n.doubtful) {
                            o.push(_treeRow(2, { attrs: 'data-f="doubts" data-p="' + _esc(n.prefix) + '"', on: !!_onDoubts[n.prefix], label: 'Tronçons douteux (tireté gris)', title: 'Le tracé direct traverse un bâtiment ou croise un tronçon plus court', counts: { line: n.doubtful }, dim: inner }));
                        }
                        n.layers.forEach(function (l) {
                            var many = l.blocks.length > 1, bk = 'b:' + l.layer;
                            o.push(_treeRow(2, { toggle: many ? bk : null, attrs: 'data-f="layer" data-l="' + _esc(l.layer) + '"', on: !_offLayers[l.layer], label: l.label, title: l.layer, counts: l.counts, dim: inner }));
                            if (many && _open[bk]) {
                                l.blocks.forEach(function (b) {
                                    var id = l.layer + '|' + b.block;
                                    o.push(_treeRow(3, { attrs: 'data-f="block" data-b="' + _esc(id) + '"', on: !_offBlocks[id], label: b.label ? b.label + ' (' + b.block + ')' : b.block, counts: { point: b.count }, dim: inner }));
                                });
                            }
                        });
                    });
                }
                o.push('</div>');
            });
            return o.join('');
        }

        // Contrôles : par gravité ; les informations sont repliées au départ
        function _diagHtml() {
            var list = _plan.diag.checks;
            if (!list.length) { return '<div class="geo-recolement-empty">Aucune anomalie relevée.</div>'; }
            var o = [];
            ['erreur', 'alerte', 'info'].forEach(function (level) {
                var inLevel = list.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.level === level; });
                if (!inLevel.length) { return; }
                var key = 'lvl:' + level, open = _open[key] === undefined ? level !== 'info' : _open[key];
                o.push('<button type="button" class="geo-recolement-group" data-group="' + key + '"><span class="geo-recolement-chev' + (open ? ' geo-recolement-chev--open' : '') + '"></span>' +
                    '<span class="geo-recolement-lvl geo-recolement-lvl--' + level + '">' + inLevel.length + '</span> ' + LEVELS[level] + '</button>');
                if (!open) { return; }
                inLevel.forEach(function (x) {
                    var c = x.c, i = x.i, sel = _openCheck === i;
                    o.push('<div class="geo-recolement-check' + (sel ? ' geo-recolement-check--open' : '') + '">' +
                        '<div class="geo-recolement-check-h" data-check="' + i + '"><span class="geo-recolement-check-t">' + _esc(c.title) + '</span>' +
                        (c.items.length ? '<span class="geo-recolement-check-n">' + c.items.length + '</span>' : '') +
                        '<span class="geo-recolement-check-net">' + _esc(c.network) + '</span></div>');
                    if (sel) {
                        o.push('<div class="geo-recolement-note">' + _esc(c.detail) + '</div>');
                        if (c.items.length) {
                            o.push('<ul class="geo-recolement-items">');
                            c.items.slice(0, ITEMS_SHOWN).forEach(function (it, j) {
                                o.push('<li><a href="#" class="geo-recolement-go" data-item="' + i + ':' + j + '">' + _esc(it.label) + '</a></li>');
                            });
                            o.push('</ul>');
                            if (c.items.length > ITEMS_SHOWN) { o.push('<div class="geo-recolement-note">… et ' + (c.items.length - ITEMS_SHOWN) + ' autres, surlignés sur la carte.</div>'); }
                        }
                    }
                    o.push('</div>');
                });
            });
            return o.join('');
        }

        function _kpi(value, label) { return '<div class="geo-recolement-kpi"><b>' + value + '</b><span>' + label + '</span></div>'; }

        // Patrimoine : ce que le plan permet de dire de chaque réseau, puis le bilan de lecture
        function _statsHtml() {
            var o = [], m = _plan.model, geo = { point: 0, line: 0, polygon: 0, text: 0 };
            _plan.diag.stats.forEach(function (s) {
                o.push('<div class="geo-recolement-card"><div class="geo-recolement-card-t"><span class="geo-recolement-dot" style="background:' + s.color + '"></span>' + _esc(s.network) + '</div>');
                o.push('<div class="geo-recolement-kpis">' + _kpi(s.regards, 'regards') + _kpi(_fmtInt(s.drawn) + ' m', s.pipes + ' tracés dessinés') +
                    (s.segments ? _kpi(_fmtInt(s.rebuilt) + ' m', s.segments + ' tronçons reconstitués') + _kpi(s.checked + ' / ' + s.segments, 'cotes cohérentes') : '') +
                    (s.doubtful ? _kpi(s.doubtful, 'tronçons douteux écartés') : '') + '</div>');
                if (s.byType.length) {
                    o.push('<table class="geo-recolement-attrs"><tr><th>Matériau</th><th>Diamètre</th><th class="geo-recolement-right">Linéaire</th></tr>');
                    s.byType.forEach(function (x) { o.push('<tr><td>' + _esc(x.mat) + '</td><td>' + (x.diam === 'NR' ? '<i>non relevé</i>' : 'Ø' + _esc(x.diam)) + '</td><td class="geo-recolement-right">' + _fmtInt(x.length) + ' m</td></tr>'); });
                    o.push('</table>');
                }
                o.push('</div>');
            });
            if (_plan.diag.stats.length) { o.push('<div class="geo-recolement-note">Linéaires estimés : tracés dessinés et tronçons reconstitués (amorces comprises), à confirmer.</div>'); }
            m.features.forEach(function (f) { geo[f.geom]++; });
            o.push('<div class="geo-recolement-sub">Bilan de lecture</div><table class="geo-recolement-attrs">');
            o.push('<tr><th>Affichables</th><td>' + _fmtInt(geo.point) + ' points, ' + _fmtInt(geo.line) + ' lignes, ' + _fmtInt(geo.polygon) + ' surfaces, ' + _fmtInt(geo.text) + ' textes</td></tr>');
            o.push('<tr><th>Portés par un autre objet</th><td>' + m.absorbed.arrows + ' flèches d\'écoulement, ' + m.absorbed.characteristics + ' blocs de caractéristiques, ' + m.absorbed.marks + ' symboles de regard</td></tr>');
            if (m.unclassified.length) { o.push('<tr><th>Hors modèle</th><td>' + m.unclassified.map(function (u) { return _esc(u.layer) + ' (' + u.count + ')'; }).join(', ') + '</td></tr>'); }
            var ign = Object.keys(_plan.raw.ignored);
            if (ign.length) { o.push('<tr><th>Non lus</th><td>' + ign.map(function (k) { return k + ' (' + _plan.raw.ignored[k] + ')'; }).join(', ') + '</td></tr>'); }
            o.push('</table>');
            return o.join('');
        }

        function _partial(key, html) {
            if (!_panelEl) { return; }
            var el = _panelEl.querySelector('[data-r="' + key + '"]');
            if (el) { el.innerHTML = html; }
        }

        function _renderFilter() { if (_plan && _tab === 'layers') { _partial('body', _filterHtml()); } }
        function _renderDiag() { if (_plan && _tab === 'diag') { _partial('body', _diagHtml()); } }
        function _renderTarget() { if (_plan && _tab === 'target') { _partial('body', _targetHtml()); } }
        function _renderSheet() {
            if (!_plan) { return; }
            _partial('tabs', _tabsHtml());
            if (_tab === 'object') { _partial('body', _bodyHtml()); }
        }

        function _onPanelClick(e) {
            if (!e.target.closest) { return; }
            if (e.target.closest('[data-changelog]')) { changelog.open(); return; }
            var tab = e.target.closest('[data-tab]');
            if (tab) {
                _backTab = null;
                // Le surlignage d'une vérification n'a de sens que dans les contrôles
                if (tab.getAttribute('data-tab') !== 'diag' && _openCheck !== null) { _openCheck = null; _drawHighlight(); }
                _setTab(tab.getAttribute('data-tab'));
                return;
            }
            var back = e.target.closest('[data-back]');
            if (back) { e.preventDefault(); _backTab = null; _setTab('diag'); return; }
            var toggle = e.target.closest('[data-toggle]');
            if (toggle) {
                var tk = toggle.getAttribute('data-toggle');
                _open[tk] = !_open[tk];
                _renderFilter();
                return;
            }
            var group = e.target.closest('[data-group]');
            if (group) {
                var gk = group.getAttribute('data-group');
                var was = _open[gk] === undefined ? gk !== 'lvl:info' : _open[gk];
                _open[gk] = !was;
                _renderDiag();
                return;
            }
            var go = e.target.closest('[data-go]');
            if (go) { e.preventDefault(); _goKey(go.getAttribute('data-go')); return; }
            var seg = e.target.closest('[data-seg]');
            if (seg) {
                e.preventDefault();
                var sm = /^(\d+)@(.*)$/.exec(seg.getAttribute('data-seg'));
                _goRef(_plan.model.nets[sm[2]].segments[+sm[1]]);
                return;
            }
            var pf = e.target.closest('[data-pf]');
            if (pf) {
                e.preventDefault();
                var pm = /^(\d+)@(.*)$/.exec(pf.getAttribute('data-pf'));
                _goRef(_plan.model.nets[pm[2]].pipes[+pm[1]].ref);
                return;
            }
            var item = e.target.closest('[data-item]');
            if (item) {
                e.preventDefault();
                var im = item.getAttribute('data-item').split(':');
                _goRef(_plan.diag.checks[+im[0]].items[+im[1]].ref);
                return;
            }
            var check = e.target.closest('[data-check]');
            if (check) {
                var i = parseInt(check.getAttribute('data-check'), 10);
                _openCheck = _openCheck === i ? null : i;
                _renderDiag();
                _drawHighlight();
                _fitCheck();
                return;
            }
            var pipe = e.target.closest('[data-pipe]');
            if (pipe) {
                var idx = parseInt(pipe.getAttribute('data-pipe'), 10);
                Array.prototype.forEach.call(_panelEl.querySelectorAll('[data-pipe]'), function (li) { li.classList.toggle('geo-recolement-pipe--sel', li === pipe); });
                _drawHighlight(idx);
                return;
            }
            var b = e.target.closest('[data-act]');
            if (b && b.getAttribute('data-act') === 'insert') { _insert(); }
        }

        // Cadre la carte sur les objets de la vérification ouverte
        function _fitCheck() {
            if (_openCheck === null || !_layers) { return; }
            var ext = _layers.hl.source.getExtent();
            if (ext && !window.ol.extent.isEmpty(ext) && isFinite(ext[0])) {
                _fit(ext, 80, 19, 250);
            }
        }

        function _onPanelChange(e) {
            var t = e.target, f = t.getAttribute('data-f');
            if (f === 'file') {
                _importFile(t.files[0]);
                t.value = '';
                return;
            }
            if (f === 'target') {
                _targetIdx = parseInt(t.value, 10) || 0;
                _target = null;
                _loadTarget();
                _initMapping();
                _renderTarget();
                _renderSheet();
                return;
            }
            if (f === 'map') {
                _mapping[t.getAttribute('data-t')] = t.value;
                var saved = _store(_mappingKey()) || {};
                saved[t.getAttribute('data-t')] = t.value;
                _store(_mappingKey(), saved);
                _renderSheet();
                return;
            }
            if (f === 'trade') { _offTrades[t.getAttribute('data-t')] = !t.checked; _renderFilter(); }
            else if (f === 'net') { _offNets[t.getAttribute('data-n')] = !t.checked; }
            else if (f === 'segs') { _offSegs[t.getAttribute('data-p')] = !t.checked; }
            else if (f === 'doubts') { _onDoubts[t.getAttribute('data-p')] = t.checked; }
            else if (f === 'layer') { _offLayers[t.getAttribute('data-l')] = !t.checked; }
            else if (f === 'block') { _offBlocks[t.getAttribute('data-b')] = !t.checked; }
            else { return; }
            if (_targets.length) { _initMapping(); _renderTarget(); }
            _draw(false);
        }

        // ============================================================
        // Panneau de la barre latérale droite (widget natif GEO)
        // ============================================================
        // GEO recrée le contrôleur à chaque ouverture de l'onglet et le détruit à la fermeture : le plan reste en mémoire,
        // ses calques sont masqués et le clic de sélection suspendu.
        function _registerWidget() {
            acfExtensionService.registerWidgetExtension({
                type:         'rightPanel',
                key:          pluginConf.name,
                extensionKey: pluginConf.name,
                name:         _toolName,
                icon:         'geo-recolement-icon',
                active:       false,
                widthPolicy:  'custom',
                enable:       function () { return true; },
                template:     '<div class="geo-recolement-widget"></div>',
                controller:   ['$scope', function ($scope) {
                    $timeout(function () { _attachPanel(); });
                    $scope.$on('$destroy', _detachPanel);
                }],
                configure:    function (ext) {
                    _widgetId = ext && ext.id ? ext.id : pluginConf.name;
                    _requestPanelWidthSoon();
                }
            });
            $rootScope.$on('activeRightTabChanged', function (event, tabId) {
                if (tabId === pluginConf.name || tabId === _widgetId) { _requestPanelWidthSoon(); }
            });
        }

        // Le panneau natif est étroit par défaut : l'arbre des couches et les fiches ont besoin de place.
        function _requestPanelWidth() {
            $rootScope.$broadcast('EXTENSION_WIDGET_ACTION', { action: 'setPanelSize', widgetId: _widgetId || pluginConf.name, width: _panelWidthPct });
            window.dispatchEvent(new Event('resize'));
        }
        function _requestPanelWidthSoon() {
            [0, 100, 300].forEach(function (delay) { setTimeout(_requestPanelWidth, delay); });
        }

        function _attachPanel() {
            var host = document.querySelector('.geo-recolement-widget');
            if (!host) { return; }
            if (!_panelEl) { _buildPanel(); }
            host.appendChild(_panelEl);
            if (_ensureLayer()) {
                _setVisible(true);
                if (!_clickKey) { _clickKey = _map.on('singleclick', _onMapClick); }
            }
        }

        function _detachPanel() {
            if (_clickKey) { window.ol.Observable.unByKey(_clickKey); _clickKey = null; }
            _setVisible(false);
            if (_panelEl && _panelEl.parentNode) { _panelEl.parentNode.removeChild(_panelEl); }
        }

        // ============================================================
        // Styles
        // ============================================================
        // Icône de l'onglet : Lucide « map-pin » (ISC), en masque pour suivre la couleur du texte comme les icônes natives GEO.
        var _PIN_ICON = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z%22/%3E%3Ccircle cx=%2212%22 cy=%2210%22 r=%223%22/%3E%3C/svg%3E";

        function _injectStyles() {
            if (document.getElementById('geo-recolement-styles')) { return; }
            var style = document.createElement('style');
            style.id = 'geo-recolement-styles';
            style.textContent = [
                '.geo-recolement-icon::before{content:"";display:block;width:1em;height:1em;margin:0 auto;background-color:currentColor;',
                '  -webkit-mask:url("' + _PIN_ICON + '") center/contain no-repeat;mask:url("' + _PIN_ICON + '") center/contain no-repeat}',
                '.geo-recolement-panel{box-sizing:border-box;font:13px/18px "Open Sans",Helvetica,Arial,sans-serif;color:#333;}',
                '.geo-recolement-head{padding:12px 14px 8px;}',
                '.geo-recolement-drop{display:block;padding:22px 12px;border:2px dashed #9fb98a;border-radius:8px;background:#f7faf4;text-align:center;color:#555;cursor:pointer;transition:.15s ease;}',
                '.geo-recolement-drop:hover,.geo-recolement-drop--over{background:#e4ecdd;border-color:#74b03e;}',
                '.geo-recolement-drop u{color:#4e7f24;}',
                '.geo-recolement-drop--bar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 10px;border-width:1px;text-align:left;}',
                '.geo-recolement-file{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#333;}',
                '.geo-recolement-drop--bar u{flex:none;font-size:12px;}',
                '.geo-recolement-cart{margin-top:6px;font-size:12px;line-height:16px;color:#666;}',
                '.geo-recolement-cart b{color:#333;font-weight:600;}',
                '.geo-recolement-msg{margin-top:6px;color:#2f6fb5;font-weight:600;}',
                '.geo-recolement-msg:empty{display:none;}',
                '.geo-recolement-tabs{position:sticky;top:0;z-index:2;display:flex;gap:2px;padding:0 10px;background:#fff;border-bottom:1px solid #d5dbd0;}',
                '.geo-recolement-tab{display:flex;align-items:center;gap:5px;padding:8px 9px;border:0;border-bottom:3px solid transparent;background:none;color:#666;font:600 13px/18px "Open Sans",Helvetica,Arial,sans-serif;cursor:pointer;white-space:nowrap;}',
                '.geo-recolement-tab:hover{color:#333;}',
                '.geo-recolement-tab--on{color:#4e7f24;border-bottom-color:#74b03e;}',
                '.geo-recolement-tabdot{width:7px;height:7px;border-radius:50%;background:#2f81f7;}',
                '.geo-recolement-body{padding:10px 14px;}',
                '.geo-recolement-foot{padding:8px 14px 12px;border-top:1px solid #e3e6e0;text-align:right;}',
                '.geo-recolement-empty{padding:24px 10px;text-align:center;color:#777;}',
                '.geo-recolement-thead,.geo-recolement-trow{display:grid;grid-template-columns:18px 20px minmax(0,1fr) repeat(4,42px);align-items:center;}',
                '.geo-recolement-thead{padding-bottom:4px;border-bottom:1px solid #e3e6e0;color:#777;font-size:11px;}',
                '.geo-recolement-thead span:nth-child(n+4){text-align:right;}',
                '.geo-recolement-trade{padding:3px 0;border-bottom:1px solid #eef0ec;}',
                '.geo-recolement-trow{min-height:26px;border-radius:4px;cursor:pointer;}',
                '.geo-recolement-trow:hover{background:#f4f7f1;}',
                '.geo-recolement-trow--dim{opacity:.45;}',
                '.geo-recolement-trow input{margin:0;}',
                '.geo-recolement-namewrap{min-width:0;display:block;}',
                '.geo-recolement-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
                '.geo-recolement-name--strong{font-weight:700;}',
                '.geo-recolement-n{text-align:right;color:#666;font-size:12px;font-variant-numeric:tabular-nums;}',
                '.geo-recolement-chev{width:16px;height:16px;padding:0;border:0;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
                '.geo-recolement-chev::before{content:"";width:6px;height:6px;border:solid #74b03e;border-width:0 2px 2px 0;transform:rotate(-45deg);transition:transform .15s ease;}',
                '.geo-recolement-chev--open::before{transform:rotate(45deg);}',
                '.geo-recolement-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;}',
                '.geo-recolement-go{color:#2f6fb5;text-decoration:underline;}',
                '.geo-recolement-tags{color:#777;font-size:11px;}',
                '.geo-recolement-sub{margin-top:12px;font-weight:700;color:#4e7f24;}',
                '.geo-recolement-note{margin-top:4px;font-size:12px;line-height:16px;color:#666;}',
                '.geo-recolement-back{display:inline-block;margin-bottom:8px;font-size:12px;color:#2f6fb5;}',
                '.geo-recolement-sheet > .geo-recolement-sub:first-child{margin-top:0;font-size:14px;}',
                '.geo-recolement-attrs{width:100%;margin-top:6px;border-collapse:collapse;font-size:12px;}',
                '.geo-recolement-attrs th,.geo-recolement-attrs td{padding:3px 6px;border-bottom:1px solid #e9ece6;text-align:left;font-weight:normal;vertical-align:top;}',
                '.geo-recolement-attrs th{color:#666;}',
                '.geo-recolement-attrs .geo-recolement-right{text-align:right;font-variant-numeric:tabular-nums;}',
                '.geo-recolement-lvl{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:700;box-sizing:border-box;}',
                '.geo-recolement-lvl--erreur{background:#c5221f;}',
                '.geo-recolement-lvl--alerte{background:#e37400;}',
                '.geo-recolement-lvl--info{background:#5f6b73;}',
                '.geo-recolement-group{display:flex;align-items:center;gap:6px;width:100%;margin-top:8px;padding:5px 0;border:0;border-bottom:1px solid #e3e6e0;background:none;font:700 13px/18px "Open Sans",Helvetica,Arial,sans-serif;color:#333;cursor:pointer;text-align:left;}',
                '.geo-recolement-check{padding:1px 4px;border-bottom:1px solid #f1f3ef;}',
                '.geo-recolement-check--open{background:#fff8ee;padding-bottom:8px;}',
                '.geo-recolement-check-h{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;padding:5px 2px;cursor:pointer;line-height:16px;}',
                '.geo-recolement-check-h:hover .geo-recolement-check-t{text-decoration:underline;}',
                '.geo-recolement-check-n{font-weight:700;font-variant-numeric:tabular-nums;}',
                '.geo-recolement-check-net{grid-column:1 / -1;color:#777;font-size:11px;}',
                '.geo-recolement-items{list-style:none;margin:6px 0 0;padding:0;font-size:12px;max-height:240px;overflow:auto;}',
                '.geo-recolement-items li{padding:2px 0;}',
                '.geo-recolement-card{margin-bottom:10px;padding:8px 10px;border:1px solid #e3e6e0;border-radius:8px;}',
                '.geo-recolement-card-t{font-weight:700;}',
                '.geo-recolement-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin:8px 0;}',
                '.geo-recolement-kpi b{display:block;font-size:15px;line-height:20px;font-variant-numeric:tabular-nums;}',
                '.geo-recolement-kpi span{display:block;font-size:11px;line-height:14px;color:#777;}',
                '.geo-recolement-tree ul{list-style:none;margin:4px 0 0;padding:0;}',
                '.geo-recolement-tree li{margin:4px 0;padding:5px 8px;border:1px solid #e9ece6;border-radius:6px;}',
                '.geo-recolement-pipe{cursor:pointer;}',
                '.geo-recolement-pipe:hover{background:#f4f7f1;}',
                '.geo-recolement-pipe--sel{background:#fce8e6;border-color:#f3c0bb;}',
                '.geo-recolement-lbl{display:block;margin:4px 0 2px;font-weight:600;}',
                '.geo-recolement-in{width:100%;box-sizing:border-box;height:28px;border:1px solid #bbb;border-radius:8px;padding:2px 6px;background:#fff;color:#333;}',
                '.geo-recolement-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0;}',
                '.geo-recolement-row > span{flex:0 0 38%;overflow:hidden;text-overflow:ellipsis;}',
                '.geo-recolement-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
                '.geo-recolement-btn{background:#fff;border:2px solid #74b03e;border-radius:16px;color:#74b03e;cursor:pointer;font:700 12px/16px "Open Sans",Helvetica,Arial,sans-serif;padding:4px 10px;transition:.2s ease;}',
                '.geo-recolement-btn:hover:not(:disabled){background:#74b03e;color:#fff;}',
                '.geo-recolement-btn:disabled{opacity:.4;cursor:default;}',
                '.geo-recolement-r{margin-top:8px;padding:6px 8px;border-radius:8px;}',
                '.geo-recolement-r--ok{background:#e6f4ea;color:#137333;}',
                '.geo-recolement-r--bad{background:#fce8e6;color:#c5221f;}'
            ].join('');
            document.head.appendChild(style);
        }

        // ============================================================
        // Lecture de la configuration GEO Generator + enregistrement
        // ============================================================
        geoApplication.executeWhenInitialized(function () {
            var config = geoApplication.getConfigurationByExtensionKey(pluginConf.name);
            if (config && config.length > 0) {
                var props = config[0].properties;
                _toolName    = props.toolName || _toolName;
                _mappingSpec = M.parseSpec(props.mapping);
                var width    = parseFloat(props.panelWidth);
                _panelWidthPct = width >= 25 && width <= 60 ? width : _panelWidthPct;
                var m = /EPSG:\d+/.exec(props.importCrs || '');
                if (m) { _impCrs = m[0]; }
                _targets = (props.targets || []).map(function (item) {
                    var fn = item.functionality || {};
                    return { id: fn.id || fn.targetId, name: fn.name || 'Table' };
                }).filter(function (t) { return t.id; });
            }
            if (!_registered) {
                _registered = true;
                _injectStyles();
                _registerWidget();
            }
        });
    }]);
