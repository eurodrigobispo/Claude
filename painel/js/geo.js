// Malhas do IBGE (TopoJSON, qualidade mínima) decodificadas e projetadas em SVG.

const IBGE = "https://servicodados.ibge.gov.br/api/v3/malhas";
const cache = new Map();

// As malhas salvas em dados/malhas/ (estados.json, municipios-br.json e
// uf/<código IBGE>.json) vêm primeiro, para o painel não depender do IBGE na
// noite da apuração; a API do IBGE fica de reserva. PAINEL_CONFIG.malhas troca
// a pasta.
export function urlMalha(nivel, ibgeUf, { ibge = false } = {}) {
  const local = (globalThis.PAINEL_CONFIG && globalThis.PAINEL_CONFIG.malhas) || "dados/malhas/";
  if (!ibge) return local + (nivel === "estados" ? "estados.json" : nivel === "municipios-br" ? "municipios-br.json" : `uf/${ibgeUf}.json`);
  const q = "formato=application/json&qualidade=minima";
  if (nivel === "estados") return `${IBGE}/paises/BR?intrarregiao=UF&${q}`;
  if (nivel === "municipios-br") return `${IBGE}/paises/BR?intrarregiao=municipio&${q}`;
  return `${IBGE}/estados/${ibgeUf}?intrarregiao=municipio&${q}`;
}

export function malha(nivel, ibgeUf) {
  const k = `${nivel}/${ibgeUf || ""}`;
  if (!cache.has(k)) {
    const ler = (u) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`malha ${r.status}`);
      return r.json();
    });
    const p = ler(urlMalha(nivel, ibgeUf)).catch(() => ler(urlMalha(nivel, ibgeUf, { ibge: true }))).then(decodificar);
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k);
}

// TopoJSON -> [{id, poligonos: [[anel [lon,lat]...]...]}]
export function decodificar(topo) {
  const [sx, sy] = topo.transform ? topo.transform.scale : [1, 1];
  const [tx, ty] = topo.transform ? topo.transform.translate : [0, 0];
  const arcos = topo.arcs.map((arco) => {
    let x = 0, y = 0;
    return arco.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  const anel = (idx) => {
    const pts = [];
    for (const i of idx) {
      const a = i < 0 ? arcos[~i].slice().reverse() : arcos[i];
      for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
    }
    return pts;
  };
  const obj = Object.values(topo.objects)[0];
  return obj.geometries.map((g) => {
    const poligonos = g.type === "Polygon" ? [g.arcs.map(anel)]
      : g.type === "MultiPolygon" ? g.arcs.map((p) => p.map(anel))
      : [];
    return { id: String((g.properties && g.properties.codarea) || g.id), poligonos };
  });
}

/**
 * Projeta as feições dentro da caixa [x0, y0, x1, y1] (equiretangular com
 * correção de latitude, suficiente para recortes do tamanho de um estado ou do
 * país). Devolve { feicoes: [{id, d, caixa, centro}], projetar(lon, lat) }.
 */
export function projetar(feicoes, [bx0, by0, bx1, by1]) {
  let lon0 = Infinity, lon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity;
  for (const f of feicoes) for (const p of f.poligonos) for (const [lon, lat] of p[0]) {
    if (lon < lon0) lon0 = lon;
    if (lon > lon1) lon1 = lon;
    if (lat < lat0) lat0 = lat;
    if (lat > lat1) lat1 = lat;
  }
  const k = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const larg = (lon1 - lon0) * k, alt = lat1 - lat0;
  const esc = Math.min((bx1 - bx0) / larg, (by1 - by0) / alt);
  const ox = bx0 + (bx1 - bx0 - larg * esc) / 2, oy = by0 + (by1 - by0 - alt * esc) / 2;
  const projetarPt = (lon, lat) => [ox + (lon - lon0) * k * esc, oy + (lat1 - lat) * esc];

  const saida = feicoes.map((f) => {
    let d = "", x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let maior = 0, centro = null;
    for (const p of f.poligonos) {
      for (let r = 0; r < p.length; r++) {
        const anel = p[r];
        let area = 0, cx = 0, cy = 0, ant = null;
        for (let i = 0; i < anel.length; i++) {
          const [x, y] = projetarPt(anel[i][0], anel[i][1]);
          d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
          if (r === 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            if (ant) {
              const cr = ant[0] * y - x * ant[1];
              area += cr; cx += (ant[0] + x) * cr; cy += (ant[1] + y) * cr;
            }
          }
          ant = [x, y];
        }
        d += "Z";
        if (r === 0 && Math.abs(area) > maior) {
          maior = Math.abs(area);
          centro = area ? [cx / (3 * area), cy / (3 * area)] : null;
        }
      }
    }
    return { id: f.id, d, caixa: [x0, y0, x1, y1], centro: centro || [(x0 + x1) / 2, (y0 + y1) / 2] };
  });
  return { feicoes: saida, projetar: projetarPt };
}

/**
 * Zoom com a roda e arraste no SVG, mexendo no viewBox. O SVG cobre a tela
 * inteira; `area()` devolve o retângulo útil (entre os painéis) onde os
 * enquadramentos devem cair. Devolve { focar(caixa), reiniciar(), escala(), arrastou() }.
 */
export function zoomavel(svg, dims) {
  let { w, h } = dims();
  let vb = [0, 0, w, h];
  const aplicar = () => {
    svg.setAttribute("viewBox", vb.map((v) => v.toFixed(2)).join(" "));
    svg.dispatchEvent(new CustomEvent("zoom", { detail: w / vb[2] }));
  };
  const ponto = (ev) => {
    const r = svg.getBoundingClientRect();
    return [vb[0] + (ev.clientX - r.left) / r.width * vb[2], vb[1] + (ev.clientY - r.top) / r.height * vb[3]];
  };
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const [px, py] = ponto(ev);
    const f = Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0022));
    const nw = Math.min(w * 1.5, Math.max(w / 80, vb[2] * f));
    const nh = nw * h / w;
    vb = [px - (px - vb[0]) * nw / vb[2], py - (py - vb[1]) * nh / vb[3], nw, nh];
    aplicar();
  }, { passive: false });

  let arraste = null, arrastou = false;
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    arrastou = false;
    arraste = { x: ev.clientX, y: ev.clientY, vb: vb.slice(), moveu: false };
  });
  window.addEventListener("pointermove", (ev) => {
    if (!arraste) return;
    const r = svg.getBoundingClientRect();
    if (Math.abs(ev.clientX - arraste.x) + Math.abs(ev.clientY - arraste.y) > 5) arraste.moveu = true;
    if (!arraste.moveu) return;
    const dx = (ev.clientX - arraste.x) / r.width * vb[2];
    const dy = (ev.clientY - arraste.y) / r.height * vb[3];
    vb = [arraste.vb[0] - dx, arraste.vb[1] - dy, vb[2], vb[3]];
    aplicar();
  });
  window.addEventListener("pointerup", () => {
    arrastou = !!(arraste && arraste.moveu);
    arraste = null;
  });

  return {
    // enquadra a caixa (em coordenadas do SVG sem zoom) no centro da área útil
    focar([x0, y0, x1, y1], folga = 1.25) {
      const [ax0, ay0, ax1, ay1] = dims().area;
      const cw = Math.max(x1 - x0, 4) * folga, ch = Math.max(y1 - y0, 4) * folga;
      const s = Math.min((ax1 - ax0) / cw, (ay1 - ay0) / ch, 80);
      const nw = w / s, nh = h / s;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const acx = (ax0 + ax1) / 2, acy = (ay0 + ay1) / 2;
      vb = [cx - acx / s, cy - acy / s, nw, nh];
      aplicar();
    },
    reiniciar() {
      ({ w, h } = dims());
      vb = [0, 0, w, h];
      aplicar();
    },
    escala: () => w / vb[2],
    // o clique que encerra um arraste não deve selecionar nada
    arrastou: () => arrastou
  };
}
