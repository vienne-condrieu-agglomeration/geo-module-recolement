// Tests de la lecture des blocs DXF et de la correspondance des attributs : node test/recolement.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as B from '../src/js/dxf-blocks.js';
import * as M from '../src/js/mapping.js';
import * as N from '../src/js/network.js';
import * as T from '../src/js/trades.js';
import * as G from '../src/js/model.js';
import * as X from '../src/js/diagnostic.js';

const buf = (s) => { const b = Buffer.from(s, 'utf-8'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const dxf = (...pairs) => pairs.join('\n') + '\n';

// --- DXF synthétique : deux regards, un bloc sans attribut, un bloc en espace papier, une ligne
const sample = dxf(
    '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1032', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '8', '0', '2', 'ASS01_COT1', '0', 'ATTDEF', '8', '0', '2', 'REGARD', '1', 'defaut', '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'Axe', '10', '0', '20', '0', '11', '1', '21', '1',
    '0', 'INSERT', '8', 'TOPO_Eaux-usées_Symboles', '66', '1', '2', 'ASS01_COT1', '10', '1000.5', '20', '2000.25', '30', '0.0', '50', '90.0',
    '0', 'ATTRIB', '8', 'TOPO_Eaux-usées_Symboles', '10', '9', '20', '9', '1', 'RG1', '2', 'REGARD', '70', '0',
    '0', 'ATTRIB', '8', 'TOPO_Eaux-usées_Symboles', '10', '9', '20', '9', '1', '223,15', '2', 'TAMPON', '70', '0',
    '0', 'ATTRIB', '8', 'TOPO_Eaux-usées_Symboles', '10', '9', '20', '9', '1', 'NR', '2', 'RADIER', '70', '0',
    '0', 'SEQEND', '8', 'TOPO_Eaux-usées_Symboles',
    '0', 'INSERT', '8', 'TOPO_Eaux-usées_Symboles', '66', '1', '2', 'ASS01_COT2', '10', '1010', '20', '2010', '30', '0.0',
    '0', 'ATTRIB', '8', 'x', '1', 'RG2', '2', 'REGARD', '0', 'SEQEND', '8', 'x',
    '0', 'INSERT', '8', 'Mobilier', '2', 'MOB01', '10', '5', '20', '5', '30', '0',
    '0', 'LWPOLYLINE', '8', 'Tuyau', '90', '2', '70', '0', '10', '0', '20', '0', '10', '10', '20', '0',
    '0', 'LWPOLYLINE', '8', 'Papier', '67', '1', '90', '2', '70', '0', '10', '0', '20', '0', '10', '1', '20', '1',
    '0', 'INSERT', '8', 'Papier', '67', '1', '66', '1', '2', 'CARTOUCHE', '10', '0', '20', '0',
    '0', 'ATTRIB', '8', 'x', '1', 'plan', '2', 'TITRE', '0', 'SEQEND', '8', 'x',
    '0', 'ENDSEC', '0', 'EOF');
{
    const r = B.parseBlocks(buf(sample));
    assert.equal(r.units, 6);
    assert.equal(r.total, 3);                       // le bloc de l'espace papier n'est pas compté
    assert.equal(r.blocks.length, 2);
    assert.deepEqual(r.symbols, [{ block: 'MOB01', layer: 'Mobilier', x: 5, y: 5, rotation: 0 }]);
    assert.deepEqual(r.lines, [{ layer: 'Axe', pts: [[0, 0], [1, 1]], closed: false }, { layer: 'Tuyau', pts: [[0, 0], [10, 0]], closed: false }]);   // la polyligne de l'espace papier est ignorée
    assert.deepEqual(r.cartouche, { TITRE: 'plan' });                   // le cartouche se lit même dans l'espace papier
    assert.deepEqual(r.blocks[0], { block: 'ASS01_COT1', layer: 'TOPO_Eaux-usées_Symboles', x: 1000.5, y: 2000.25, z: 0, rotation: 90,
        attrs: { REGARD: 'RG1', TAMPON: '223,15', RADIER: 'NR' } });
    assert.equal(r.blocks[1].attrs.REGARD, 'RG2');
    const s = B.summarize(r.blocks);
    assert.equal(s.length, 1);
    assert.equal(s[0].count, 2);
    assert.deepEqual(s[0].blocks.map((b) => b.block).sort(), ['ASS01_COT1', 'ASS01_COT2']);
    assert.deepEqual(s[0].blocks.find((b) => b.block === 'ASS01_COT1').tags, ['RADIER', 'REGARD', 'TAMPON']);
}

// --- Nombres et valeurs vides
assert.equal(M.parseNumber('223,15'), 223.15);
assert.equal(M.parseNumber(' -1.5 '), -1.5);
assert.equal(M.parseNumber('NR'), null);
assert.equal(M.parseNumber('12abc'), null);
assert.ok(M.isBlank('NR') && M.isBlank('') && M.isBlank(' nr ') && !M.isBlank('0'));

// --- Correspondance de configuration et proposition automatique
assert.deepEqual(M.parseSpec('REGARD=idregard; radier=z_radier;;bidon'), { REGARD: 'idregard', RADIER: 'z_radier' });
const fields = ['id_regard', 'z_radier', 'z_tampon', 'profondeur', 'commentaire'];
assert.equal(M.suggestField('RADIER', fields), 'z_radier');
assert.equal(M.suggestField('TAMPON', fields), 'z_tampon');
assert.equal(M.suggestField('PROFOND', fields), 'profondeur');
assert.equal(M.suggestField('REGARD', fields), 'id_regard');
assert.equal(M.suggestField('INCONNU', fields), '');
{
    const map = M.initialMapping(['REGARD', 'RADIER', 'TAMPON', 'PROFOND', 'X'], fields, { RADIER: 'profondeur', TAMPON: 'absent' }, { PROFOND: 'commentaire' });
    // spec prioritaire sur l'automatique ; un champ de la spec absent de la table est ignoré ; la mémoire locale prime sur la spec
    assert.deepEqual(map, { REGARD: 'id_regard', RADIER: 'profondeur', TAMPON: '', PROFOND: 'commentaire', X: '' });
}

// --- Valeurs du formulaire : « NR » omis, nombre converti si le modèle est un nombre
{
    const sample = { id_regard: 'tmp', z_radier: 0, z_tampon: 0 };
    const v = M.formValues({ REGARD: 'RG1', TAMPON: '223,15', RADIER: 'NR' }, { REGARD: 'id_regard', TAMPON: 'z_tampon', RADIER: 'z_radier' }, sample);
    assert.deepEqual(v, { id_regard: 'RG1', z_tampon: 223.15 });
    assert.deepEqual(M.invalidNumbers({ z_tampon: 'abc', id_regard: 'x' }, sample), ['z_tampon']);
}

// --- Rattachements : deux regards reliés par une canalisation, caractéristiques et flèche d'écoulement
{
    const P = 'TOPO_Test';
    const regard = (id, x, rad) => ({ block: 'ASS01_COT1', layer: P + '_Symboles', x, y: 0, z: 0, rotation: 0, attrs: { REGARD: id, RADIER: rad } });
    const dg = (amont, aval) => ({ block: 'ASS01_DG_NAT2', layer: P + '_Symboles', x: 4, y: 0, z: 0, rotation: 180, attrs: { MAT: 'PVC', DIAM: '200', ALTI_AMONT: amont, ALTI_AVAL: aval } });
    const arrow = (rot) => ({ block: 'E_U98', layer: P + '_Infra-sous-sol', x: 5, y: 0.3, rotation: rot });
    const plan = (flowRot, dgBlock) => ({
        blocks: [regard('R1', 0, '10.00'), regard('R2', 10, '9.80'), dgBlock],
        symbols: [{ block: 'E_U03', layer: P + '_Infrastructures', x: 0.1, y: 0 }].concat(flowRot === null ? [] : [arrow(flowRot)]),
        lines: [{ layer: P + '_Tracés-souterrains', pts: [[0, 0], [10, 0]], closed: false },
                { layer: P + '_Tracés-souterrains', pts: [[10, 0], [10, 6]], closed: false }]   // se termine sans regard
    });
    assert.equal(N.prefixOf('TOPO_Eaux-usées_Symboles'), 'TOPO_Eaux-usées');
    assert.equal(N.symbolLabel('E_U03'), 'tampon circulaire plein');
    assert.equal(N.symbolLabel('E_P06'), 'descente d\'eau pluviale');
    assert.equal(N.symbolLabel('MOB01'), 'panneau indicateur');
    assert.equal(N.symbolLabel('ZZZ01'), '');

    // Flèche dans le sens début -> fin : R1 est l'amont, le fil d'eau « amont » du bloc est celui de R1
    let net = N.buildNetwork(plan(0, dg('10.00', 'NR')), P);
    assert.equal(net.regards.length, 2);
    assert.equal(net.regards[0].symbol, 'E_U03');
    assert.equal(net.pipes[0].flow, 'fwd');
    assert.deepEqual(net.pipes[0].dg, { mat: 'PVC', diam: '200', amont: '10.00', aval: 'NR' });
    assert.equal(net.pipes[1].dg, null);
    let t1 = N.treeOf(net, 0), t2 = N.treeOf(net, 1);
    assert.equal(t1.pipes.length, 1);
    assert.deepEqual([t1.pipes[0].role, t1.pipes[0].other, t1.pipes[0].here, t1.pipes[0].there], ['out', { regard: 1 }, '10.00', 'NR']);
    assert.equal(t2.pipes.length, 2);                                   // la canalisation reçue et celle qui s'arrête sans regard
    assert.deepEqual([t2.pipes[0].role, t2.pipes[0].other, t2.pipes[0].here, t2.pipes[0].there], ['in', { regard: 0 }, 'NR', '10.00']);
    assert.equal(t2.pipes[1].other, null);                              // extrémité sans regard

    // Flèche inversée : l'eau va de R2 vers R1, le fil d'eau « aval » du bloc est celui de R1
    net = N.buildNetwork(plan(180, dg('NR', '10.00')), P);
    assert.equal(net.pipes[0].flow, 'rev');
    t1 = N.treeOf(net, 0);
    assert.deepEqual([t1.pipes[0].role, t1.pipes[0].here], ['in', '10.00']);

    // Sans flèche : sens inconnu, aucune valeur attribuée à un regard
    net = N.buildNetwork(plan(null, dg('10.00', 'NR')), P);
    t1 = N.treeOf(net, 0);
    assert.deepEqual([t1.pipes[0].role, t1.pipes[0].here, t1.pipes[0].there], [null, undefined, undefined]);

    // Un bloc de caractéristiques éloigné de la polyligne ne lui est pas rattaché
    const far = dg('10.00', 'NR'); far.y = 2;
    assert.equal(N.buildNetwork(plan(0, far), P).pipes[0].dg, null);
}

// --- Métiers : classement des calques, blocs techniques, objets et regroupement
{
    assert.deepEqual(T.classify('TOPO_Eaux-usées_Symboles'), { trade: 'assainissement', network: 'Eaux usées', color: '#993300', theme: 'Symboles', prefix: 'TOPO_Eaux-usées' });
    assert.equal(T.classify('TOPO_Eau-unitaire_Infrastructures').trade, 'assainissement');
    assert.equal(T.classify('TOPO_Eau-potable_Symboles').trade, 'eau-potable');
    assert.equal(T.classify('TOPO_Eclairage_Infrastructures').trade, 'eclairage');
    assert.equal(T.classify('TOPO_Mobiliers-urbains_Symboles').trade, 'voirie');
    assert.equal(T.classify('TOPO_Voirie_Signalisations-V').trade, 'voirie');
    assert.equal(T.classify('TOPO_Gaz_Infrastructures').trade, 'reseaux-tiers');
    assert.equal(T.classify('TOPO_Téléphone_Infrastructures').network, 'Téléphone');
    assert.equal(T.classify('TOPO_Chauffage_Infrastructures').network, 'Chauffage urbain');
    assert.equal(T.classify('TOPO_Eau-arrosage_Tracés-souterrains').trade, 'eau-potable');
    assert.equal(T.classify('TOPO_Hydrographie_Infrastructures').trade, 'fond-de-plan');
    assert.equal(T.classify('CAD_Numéros').trade, 'fond-de-plan');
    assert.equal(T.classify('TOPO_Présentation_Cadre'), null);            // mise en page : hors du modèle
    ['E_U98', 'E_P98', 'ASS98', 'ASS99', 'E_U96', 'E_P97', 'ECL99', 'ASS01_DG_NAT2'].forEach((b) => assert.ok(T.isTechnical(b), b));
    ['E_U03', 'ASS01_COT1', 'EAU04', 'ECL01', 'MOB12', 'SIH19', 'EAU01_BAC'].forEach((b) => assert.ok(!T.isTechnical(b), b));
    assert.equal(T.blockLabel('ECL01'), 'candélabre mono-branche');
    assert.equal(T.blockLabel('ASS04'), 'avaloir');
    assert.equal(T.blockTitle('INCONNU'), 'INCONNU');

    const P = 'TOPO_Eaux-usées';
    const plan = {
        blocks: [{ block: 'ASS01_COT1', layer: P + '_Symboles', x: 0, y: 0, z: 0, rotation: 0, attrs: { REGARD: 'R1' } },
                 { block: 'ASS01_DG_NAT2', layer: P + '_Symboles', x: 5, y: 0, z: 0, rotation: 0, attrs: { MAT: 'PVC' } },
                 { block: 'EAU01_BAC', layer: 'TOPO_Eau-potable_Symboles', x: 50, y: 50, z: 0, rotation: 0, attrs: { NUMBAC: '' } }],
        symbols: [{ block: 'E_U03', layer: P + '_Infrastructures', x: 0.1, y: 0, rotation: 0 },        // sur le regard : devient son symbole
                  { block: 'E_U04', layer: P + '_Infrastructures', x: 20, y: 0, rotation: 0 },         // avaloir isolé
                  { block: 'E_U98', layer: P + '_Infra-sous-sol', x: 5, y: 0.3, rotation: 0 },         // flèche : technique
                  { block: 'ECL01', layer: 'TOPO_Eclairage_Infrastructures', x: 70, y: 70, rotation: 0 },
                  { block: 'GAZ04', layer: 'TOPO_Gaz_Infrastructures', x: 80, y: 80, rotation: 0 }],
        lines: []
    };
    const objs = T.listObjects(plan);
    assert.equal(objs.length, 5);                                        // regard, bouche à clé, avaloir, candélabre, coffret gaz
    assert.equal(objs.find((o) => o.attrs && o.attrs.REGARD).symbol, 'E_U03');
    assert.equal(objs.find((o) => o.block === 'E_U04').attrs, null);
    assert.equal(objs.find((o) => o.block === 'E_U04').ref, plan.symbols[1]);   // identité du plan conservée
    const model = G.buildModel(Object.assign({ hatches: [], texts: [] }, plan));
    assert.deepEqual(model.tree.map((t) => t.trade), ['assainissement', 'eau-potable', 'eclairage', 'reseaux-tiers']);
    assert.deepEqual(model.tree[0].networks[0].layers.find((l) => l.theme === 'Infrastructures').blocks.map((b) => b.block), ['E_U04']);
}

// --- Sens inverse : un symbole sans attribut (avaloir) est un nœud, la canalisation donne ses deux extrémités
{
    const P = 'TOPO_Test';
    const plan = {
        blocks: [{ block: 'ASS01_COT1', layer: P + '_Symboles', x: 0, y: 0, z: 0, rotation: 0, attrs: { REGARD: 'R1', RADIER: '10.00' } },
                 { block: 'ASS01_DG_NAT2', layer: P + '_Symboles', x: 4, y: 0, z: 0, rotation: 0, attrs: { MAT: 'PVC', DIAM: '200', ALTI_AMONT: '10.00', ALTI_AVAL: 'NR' } }],
        symbols: [{ block: 'E_U04', layer: P + '_Infrastructures', x: 10, y: 0.1, rotation: 0 },
                  { block: 'E_U98', layer: P + '_Infra-sous-sol', x: 5, y: 0.3, rotation: 0 }],
        lines: [{ layer: P + '_Tracés-souterrains', pts: [[0, 0], [10, 0]], closed: false }]
    };
    const net = N.buildNetwork(plan, P);
    assert.equal(net.symbols.length, 1);
    assert.deepEqual(net.pipes[0].to, { symbol: 'E_U04', sym: 0 });
    const ts = N.treeOfNode(net, { sym: 0 });                            // de l'avaloir vers sa canalisation
    assert.equal(ts.regard, null);
    assert.equal(ts.symbol, 'E_U04');
    assert.equal(ts.pipes.length, 1);
    assert.deepEqual([ts.pipes[0].role, ts.pipes[0].other, ts.pipes[0].here, ts.pipes[0].there], ['in', { regard: 0 }, 'NR', '10.00']);
    const sh = N.pipeSheet(net, 0);                                      // de la canalisation vers ses extrémités
    assert.deepEqual(sh.ends.map((e) => [e.end, e.ref, e.fil]), [['from', { regard: 0 }, '10.00'], ['to', { symbol: 'E_U04', sym: 0 }, 'NR']]);
}

// --- Lecture complète : arcs, polyligne fermée, ancienne POLYLINE, cercle, textes, hachure, entité non lue
{
    const pts = B.arcPoints([0, 0], [2, 0], 1);                         // demi-cercle, renflement positif : passe sous la corde
    assert.ok(pts.length > 3 && pts.every((p) => p[1] < 0.0001));
    assert.ok(pts.some((p) => Math.abs(p[0] - 1) < 0.01 && Math.abs(p[1] + 1) < 0.01));
    assert.equal(B.cleanText('{\\fArial|b0;Tampon\\Pplein}'), 'Tampon plein');
    assert.equal(B.cleanText('%%c200'), 'Ø200');
    const r = B.parseBlocks(buf(dxf(
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'LWPOLYLINE', '8', 'A', '70', '1', '10', '0', '20', '0', '10', '4', '20', '0', '10', '4', '20', '3',
        '0', 'LWPOLYLINE', '8', 'B', '70', '0', '10', '0', '20', '0', '42', '1', '10', '2', '20', '0',
        '0', 'POLYLINE', '8', 'C', '70', '0', '0', 'VERTEX', '8', 'C', '10', '1', '20', '1', '0', 'VERTEX', '8', 'C', '10', '2', '20', '2', '0', 'SEQEND',
        '0', 'CIRCLE', '8', 'D', '10', '0', '20', '0', '40', '1',
        '0', 'TEXT', '8', 'E', '10', '5', '20', '6', '40', '1', '1', 'regard plein', '50', '30',
        '0', 'MTEXT', '8', 'F', '10', '7', '20', '8', '40', '1', '3', 'Lotissement ', '1', 'Les Jardins',
        '0', 'HATCH', '8', 'G', '10', '99', '20', '99', '91', '1', '92', '2', '72', '0', '73', '1', '93', '3', '10', '0', '20', '0', '10', '1', '20', '0', '10', '1', '20', '1', '97', '0', '75', '0', '98', '1', '10', '50', '20', '50',
        '0', 'HATCH', '8', 'G', '91', '1', '92', '1', '93', '1', '72', '2', '10', '0', '20', '0', '40', '1', '75', '0',
        '0', 'SPLINE', '8', 'H', '10', '0', '20', '0',
        '0', 'ENDSEC', '0', 'EOF')));
    const line = (l) => r.lines.find((x) => x.layer === l);
    assert.equal(line('A').closed, true);
    assert.ok(line('B').pts.length > 3 && !line('B').closed);
    assert.deepEqual(line('B').pts[line('B').pts.length - 1], [2, 0]);
    assert.deepEqual(line('C').pts, [[1, 1], [2, 2]]);
    assert.equal(line('D').closed, true);
    assert.deepEqual(r.texts.map((t) => t.text), ['regard plein', 'Lotissement Les Jardins']);
    assert.equal(r.texts[0].rotation, 30);
    assert.deepEqual(r.hatches, [{ layer: 'G', rings: [[[0, 0], [1, 0], [1, 1]]] }]);   // ni le point d'élévation, ni le point d'amorce
    assert.deepEqual(r.ignored, { HATCH: 1, SPLINE: 1 });              // comptés, pas perdus en silence
    assert.equal(G.area([[[0, 0], [4, 0], [4, 3], [0, 3]]]), 12);
}

// --- Tronçon reconstitué : deux amorces face à face, avec contrôle par les cotes
{
    const P = 'TOPO_Eaux-usées';
    const reg = (id, x, rad) => ({ block: 'ASS01_COT1', layer: P + '_Symboles', x, y: 0, z: 0, rotation: 0, attrs: { REGARD: id, RADIER: rad, TAMPON: '20.00', PROFOND: '1.00' } });
    const dg = (x, diam, am, av) => ({ block: 'ASS01_DG_NAT2', layer: P + '_Symboles', x, y: 0, z: 0, rotation: 0, attrs: { MAT: 'PVC', DIAM: diam, ALTI_AMONT: am, ALTI_AVAL: av } });
    const arrow = (x, rot) => ({ block: 'E_U98', layer: P + '_Infra-sous-sol', x, y: 0.3, rotation: rot });
    const make = (radUp, radDown, diam2) => ({
        blocks: [reg('A', 0, radUp), reg('B', 50, radDown), dg(1, '200', 'NR', 'NR'), dg(49, diam2, 'NR', 'NR')],
        symbols: [arrow(1, 0), arrow(49, 0)],
        lines: [{ layer: P + '_Tracés-souterrains', pts: [[0, 0], [3, 0]], closed: false },
                { layer: P + '_Tracés-souterrains', pts: [[47, 0], [50, 0]], closed: false },
                // Amorce en biais : elle ne regarde pas l'autre regard
                { layer: P + '_Tracés-souterrains', pts: [[50, 0], [50, 4]], closed: false }]
    });
    let net = N.buildNetwork(make('10.00', '9.50', '200'), P);
    assert.equal(net.segments.length, 1);
    let s = net.segments[0];
    assert.deepEqual([s.up, s.down, s.oriented, s.status], [{ regard: 0 }, { regard: 1 }, true, 'ok']);
    assert.equal(s.gap, 44);
    assert.equal(s.length, 50);
    assert.ok(Math.abs(s.slope - 0.01) < 1e-9);
    assert.equal(net.pipes[0].seg, s);
    assert.equal(net.pipes[2].seg, null);
    assert.deepEqual(s.doubts, []);
    // Un bâtiment sur le tracé direct : le tronçon reste, mais douteux
    const walled = make('10.00', '9.50', '200');
    walled.lines.push({ layer: 'TOPO_Bâtiments_Contours', pts: [[20, -5], [20, 5]], closed: false });
    assert.deepEqual(N.buildNetwork(walled, P).segments[0].doubts, ['traverse un bâtiment']);
    // Le bâti d'un autre calque ne compte pas ; une clôture se franchit
    const fenced = make('10.00', '9.50', '200');
    fenced.lines.push({ layer: 'TOPO_Clôtures_Légères', pts: [[20, -5], [20, 5]], closed: false });
    assert.deepEqual(N.buildNetwork(fenced, P).segments[0].doubts, []);
    // Deux tronçons qui se croisent : le plus long est douteux, le plus court reste
    const cross = (p) => ({ block: 'ASS01_COT1', layer: P + '_Symboles', x: p[0], y: p[1], z: 0, rotation: 0, attrs: { REGARD: 'R' + p, RADIER: 'NR' } });
    const stub = (a, b) => ({ layer: P + '_Tracés-souterrains', pts: [a, b], closed: false });
    const xnet = N.buildNetwork({
        blocks: [cross([0, 0]), cross([100, 0]), cross([50, -20]), cross([50, 20])], symbols: [],
        lines: [stub([0, 0], [2, 0]), stub([100, 0], [98, 0]), stub([50, -20], [50, -18]), stub([50, 20], [50, 18])]
    }, P);
    assert.equal(xnet.segments.length, 2);
    const longest = xnet.segments.slice().sort((x, y) => y.gap - x.gap);
    assert.deepEqual(longest[0].doubts, ['croise un tronçon plus court du même réseau']);
    assert.deepEqual(longest[1].doubts, []);
    // Les cotes contredisent la flèche
    assert.equal(N.buildNetwork(make('9.00', '9.50', '200'), P).segments[0].status, 'contre-pente');
    // Cote manquante : pas de verdict
    assert.equal(N.buildNetwork(make('NR', '9.50', '200'), P).segments[0].status, 'inconnu');
    // Diamètres différents : apparié mais signalé
    assert.equal(N.buildNetwork(make('10.00', '9.50', '300'), P).segments[0].diamDiff, true);
    // Deux écoulements qui se font face sans se rejoindre : pas de tronçon
    const opposed = make('10.00', '9.50', '200');
    opposed.symbols[1] = arrow(49, 180);
    assert.equal(N.buildNetwork(opposed, P).segments.length, 0);
    // Réseau non assainissement : un tracé d'eau potable se raccorde aux ouvrages à attributs
    const A = 'TOPO_Eau-potable';
    const aep = N.buildNetwork({
        blocks: [{ block: 'EAU01_BAC', layer: A + '_Symboles', x: 0, y: 0, z: 0, rotation: 0, attrs: { NUMBAC: '' } }], symbols: [],
        lines: [{ layer: A + '_Tracés-souterrains', pts: [[0, 0], [5, 0]], closed: false }]
    }, A);
    assert.deepEqual(aep.pipes[0].from, { symbol: 'EAU01_BAC', sym: 0 });
    assert.equal(N.treeOfNode(aep, { sym: 0 }).pipes.length, 1);
    // Tracés aériens : même logique
    assert.equal(N.buildNetwork({ blocks: [], symbols: [], lines: [{ layer: 'TOPO_Eclairage_Tracés-aériens', pts: [[0, 0], [5, 0]], closed: false }] }, 'TOPO_Eclairage').pipes.length, 1);
}

// --- Diagnostic : règles et normalisation
{
    assert.equal(X.crsOfCartouche('RGF93 - CC45'), 'EPSG:3945');
    assert.equal(X.crsOfCartouche('Lambert 93'), 'EPSG:2154');
    assert.equal(X.crsOfCartouche('inconnu'), null);
    assert.equal(X.normMaterial('béton'), 'Béton');
    assert.equal(X.normMaterial('BETON'), 'Béton');
    assert.equal(X.normMaterial('pvc'), 'PVC');
    assert.equal(X.normMaterial('NR'), 'Non relevé');
    const P = 'TOPO_Eaux-usées', reg = (id, x, t, r, p) => ({ block: 'ASS01_COT1', layer: P + '_Symboles', x, y: 0, z: 0, rotation: 0, attrs: { REGARD: id, TAMPON: t, RADIER: r, PROFOND: p } });
    const plan = { blocks: [reg('R1', 0, '10.00', '8.00', '2.00'), reg('R1', 100, '10.00', '11.00', '1.00'), reg('R3', 200, '10.00', '8.00', '1.50'), reg('R4', 300, 'NR', '8.00', '1.00'),
                            { block: 'ZZ', layer: 'CALQUE_LIBRE', x: 0, y: 0, z: 0, rotation: 0, attrs: { A: '1' } }],
        symbols: [], lines: [], hatches: [], texts: [], ignored: { SPLINE: 2 }, cartouche: null };
    const d = X.diagnose(G.buildModel(plan), {});
    const ids = d.checks.map((c) => c.id);
    assert.equal(d.checks.find((c) => c.id === P + ':dup').items.length, 2);
    assert.equal(d.checks.find((c) => c.id === P + ':radier').items.length, 1);
    assert.equal(d.checks.find((c) => c.id === P + ':depth').items.length, 1);
    assert.equal(d.checks.find((c) => c.id === P + ':uncoted').items.length, 1);
    assert.equal(d.checks.find((c) => c.id === P + ':alone').items.length, 4);
    assert.ok(ids.includes('ignored') && ids.includes('charte'));
    assert.equal(d.checks[0].level, 'erreur');                          // les erreurs d'abord
}

// --- Plan réel du marché de topographie, jamais versionné : son chemin est donné par GEO_RECOLEMENT_PLAN (voir GUIDE-DEV.md)
const real = process.env.GEO_RECOLEMENT_PLAN;
if (real && fs.existsSync(real)) {
    const b = fs.readFileSync(real);
    const t0 = Date.now();
    const r = B.parseBlocks(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const s = B.summarize(r.blocks);
    const eu = s.find((l) => l.layer === 'TOPO_Eaux-usées_Symboles');
    assert.ok(eu, 'calque des regards EU');
    const regards = eu.blocks.filter((x) => x.tags.indexOf('REGARD') >= 0);
    assert.deepEqual(regards.map((x) => x.count).sort(), [58, 58]);
    assert.deepEqual(regards[0].tags, ['PROFOND', 'RADIER', 'REGARD', 'TAMPON']);
    const net = N.buildNetwork(r, 'TOPO_Eaux-usées');
    assert.equal(net.regards.length, 116);
    assert.equal(net.pipes.length, 255);
    assert.equal(net.pipes.filter((p) => p.dg).length, 254);            // un bloc de caractéristiques par canalisation
    assert.equal(net.pipes.filter((p) => p.flow).length, 221);
    const i7 = net.regards.findIndex((x, i) => { const t = N.treeOf(net, i); return t.symbol === 'E_U03' && t.pipes.length === 4; });
    assert.ok(i7 >= 0, 'regard à tampon circulaire plein et à quatre canalisations');
    const t7 = N.treeOf(net, i7);
    assert.equal(t7.symbol, 'E_U03');
    assert.equal(t7.pipes.length, 4);
    const out = t7.pipes.filter((p) => p.role === 'out')[0];
    assert.equal(M.parseNumber(out.here), M.parseNumber(net.regards[i7].attrs.RADIER));                                   // fil d'eau amont = radier du regard
    // Canalisation sortante : son fil d'eau amont égale le radier du regard. Canalisation entrante : son fil d'eau aval est
    // au-dessus du radier (à quelques centimètres ou décimètres près). Le sens vaut même quand l'autre bout n'a pas de regard.
    let outSame = 0, outTotal = 0, inAbove = 0, inTotal = 0;
    net.regards.forEach((rg, i) => N.treeOf(net, i).pipes.forEach((p) => {
        const v = M.parseNumber(p.here), rad = M.parseNumber(rg.attrs.RADIER);
        if (v === null || rad === null) { return; }
        if (p.role === 'out') { outTotal++; if (Math.abs(v - rad) < 0.005) { outSame++; } }
        else if (p.role === 'in') { inTotal++; if (v - rad > -0.05) { inAbove++; } }
    }));
    assert.ok(outTotal > 80 && outSame / outTotal > 0.9, 'sortantes : fil d\'eau = radier : ' + outSame + '/' + outTotal);
    assert.ok(inTotal > 100 && inAbove / inTotal > 0.95, 'entrantes : fil d\'eau >= radier : ' + inAbove + '/' + inTotal);
    // Métiers : tout le réseau d'assainissement, l'eau potable, l'éclairage et la voirie sont repris
    const model = G.buildModel(r), byGeom = {};
    model.features.forEach((f) => { byGeom[f.trade + '/' + f.geom] = (byGeom[f.trade + '/' + f.geom] || 0) + 1; });
    assert.deepEqual(model.tree.map((t) => t.trade), ['assainissement', 'eau-potable', 'eclairage', 'voirie', 'reseaux-tiers', 'fond-de-plan']);
    assert.equal(byGeom['assainissement/point'], 318);
    assert.equal(byGeom['assainissement/line'], 557);                   // 255 + 297 + 5 tracés
    assert.ok(byGeom['voirie/line'] > 2000 && byGeom['voirie/polygon'] > 200, 'la voirie est surtout linéaire et surfacique');
    assert.ok(byGeom['fond-de-plan/polygon'] > 100, 'hachures et contours fermés');
    assert.deepEqual(Object.keys(r.ignored), ['HATCH']);                // 3 hachures à contour courbe, comptées et signalées
    assert.deepEqual(model.unclassified.map((u) => u.layer), ['TOPO_Présentation_Cadre']);
    assert.equal(r.cartouche.COORDONNEES, 'RGF93 - CC45');
    // Rien ne disparaît sans être compté : INSERT lus = points affichés + portés par un autre objet + hors modèle
    const pts = model.features.filter((f) => f.geom === 'point').length, ab = model.absorbed;
    const outInserts = r.blocks.concat(r.symbols).filter((b) => !T.classify(b.layer)).length;
    assert.equal(pts + ab.arrows + ab.characteristics + ab.marks + ab.letters + outInserts, r.blocks.length + r.symbols.length);

    // Tronçons reconstitués : les cotes, qui n'entrent pas dans l'appariement, confirment le sens dans la très grande majorité
    const euNet = model.nets['TOPO_Eaux-usées'], epNet = model.nets['TOPO_Eaux-pluviales'];
    [[euNet, 36], [epNet, 39]].forEach(([n, seg]) => assert.equal(n.segments.length, seg));
    // Le plus long tronçon apparié traverse des bâtiments : les cotes le disent cohérent, la géométrie le récuse
    const far = euNet.segments.slice().sort((a, b) => b.gap - a.gap)[0];
    assert.ok(far.gap > 190 && far.status === 'ok' && far.doubts.includes('traverse un bâtiment'));
    [euNet, epNet].forEach((n) => {
        const ok = n.segments.filter((s) => !s.doubts.length);
        // Parmi les tronçons probables, aucun croisement ne subsiste
        ok.forEach((s, i) => ok.slice(i + 1).forEach((t) => {
            const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
            assert.ok(!(o(s.span[0], s.span[1], t.span[0]) * o(s.span[0], s.span[1], t.span[1]) < 0 && o(t.span[0], t.span[1], s.span[0]) * o(t.span[0], t.span[1], s.span[1]) < 0));
        }));
        console.log(n.prefix + ' : ' + ok.length + ' tronçons probables, ' + (n.segments.length - ok.length) + ' douteux, cotes cohérentes ' + ok.filter((s) => s.status === 'ok').length + ', contre-pentes ' + ok.filter((s) => s.status === 'contre-pente').length + ', écart max ' + Math.round(Math.max(...ok.map((s) => s.gap))) + ' m');
    });
    euNet.segments.forEach((s) => { assert.ok(s.a.seg === s && s.b.seg === s); assert.ok(s.gap <= 200); });

    // Diagnostic : les anomalies réelles du plan de test
    const diag = X.diagnose(model, { crs: 'EPSG:3945' });
    const check = (id) => diag.checks.find((c) => c.id === id);
    assert.equal(check('TOPO_Eaux-pluviales:dup').items.length, 3);
    assert.equal(check('TOPO_Eaux-usées:radier').items.length, 2);
    assert.equal(check('TOPO_Eaux-usées:uncoted').items.length, 8);
    assert.equal(check('empty:Eau potable|EAU01_BAC').items.length, 91);
    assert.ok(check('charte').detail.includes('TOPO_Repères_Chainages'));
    assert.ok(check('layout'));
    assert.ok(check('notrace:TOPO_Eclairage'));
    assert.equal(check('crs'), undefined);                              // cartouche en CC45 = projection configurée
    assert.ok(X.diagnose(model, { crs: 'EPSG:2154' }).checks.find((c) => c.id === 'crs'));
    assert.ok(model.features.some((f) => f.notes && f.notes.includes('regard plein')), 'annotation rattachée à un regard');
    const pluvial = N.buildNetwork(r, 'TOPO_Eaux-pluviales');
    // Sens inverse sur le réseau pluvial : tout symbole raccordé est un nœud, et ses canalisations le désignent comme extrémité
    pluvial.pipes.forEach((pp) => ['from', 'to'].forEach((k) => {
        if (pp[k] && pp[k].sym !== undefined) { assert.ok(N.treeOfNode(pluvial, { sym: pp[k].sym }).pipes.some((x) => x.pipe === pp)); }
    }));
    assert.ok(pluvial.pipes.some((pp) => pp.from && pp.from.sym !== undefined || pp.to && pp.to.sym !== undefined), 'canalisations sur un symbole');
    console.log('plan réel : ' + r.blocks.length + ' blocs à attributs sur ' + r.total + ' INSERT, lus en ' + (Date.now() - t0) + ' ms');
} else {
    console.log('plan réel absent : test ignoré');
}
console.log('recolement.test.mjs : OK');
