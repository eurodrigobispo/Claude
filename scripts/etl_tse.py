"""
Prepara os dados de apoio do painel a partir do portal de dados abertos do TSE.

  python3 scripts/etl_tse.py locais     # locais de votação 2026 com coordenadas
  python3 scripts/etl_tse.py historico  # votação de 2022 por município e zona

Lê os .zip direto do CDN do TSE por requisições de intervalo (Range), sem
baixar o arquivo inteiro nem extrair nada em disco. Grava em painel/dados/.
"""

import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile

CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele"
SAIDA = os.path.join(os.path.dirname(__file__), "..", "painel", "dados")
UFS = ("ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to zz").split()


class ArquivoHttp(io.RawIOBase):
    """Arquivo remoto somente leitura, com seek, servido por Range."""

    def __init__(self, url):
        self.url = url
        self.pos = 0
        self.tamanho = int(self._pedir(0, 0).headers["Content-Range"].split("/")[-1])

    def _pedir(self, ini, fim):
        for tentativa in range(8):
            try:
                req = urllib.request.Request(self.url, headers={"Range": f"bytes={ini}-{fim}"})
                return urllib.request.urlopen(req, timeout=180)
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    raise
                time.sleep(min(60, 2 ** tentativa))
            except (urllib.error.URLError, TimeoutError):
                time.sleep(min(60, 2 ** tentativa))
        raise RuntimeError("o CDN do TSE recusou repetidamente: " + self.url)

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, desloc, origem=0):
        self.pos = {0: desloc, 1: self.pos + desloc, 2: self.tamanho + desloc}[origem]
        return self.pos

    def readinto(self, buf):
        if self.pos >= self.tamanho:
            return 0
        fim = min(self.tamanho, self.pos + max(len(buf), 1 << 20)) - 1
        dados = self._pedir(self.pos, fim).read()
        n = min(len(buf), len(dados))
        buf[:n] = dados[:n]
        self.pos += n
        return n


def abrir_zip(caminho):
    return zipfile.ZipFile(io.BufferedReader(ArquivoHttp(f"{CDN}/{caminho}"), buffer_size=1 << 23))


def linhas(z, nome):
    with z.open(nome) as f:
        leitor = csv.reader(io.TextIOWrapper(f, encoding="latin1", newline=""), delimiter=";")
        cab = next(leitor)
        idx = {c: i for i, c in enumerate(cab)}
        for row in leitor:
            yield idx, row


def gravar(sub, uf, dados):
    pasta = os.path.join(SAIDA, sub)
    os.makedirs(pasta, exist_ok=True)
    with open(os.path.join(pasta, f"{uf}.json"), "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))


def coord(s):
    try:
        v = round(float(s.replace(",", ".")), 5)
        return v if v != -1 else None
    except ValueError:
        return None


def locais():
    """Por UF: município -> zona -> local -> [nome, bairro, endereço, lat, lon, eleitores, seções]."""
    z = abrir_zip("eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip")
    for uf in UFS:
        nome = f"eleitorado_local_votacao_2026_{uf.upper()}.csv"
        if nome not in z.namelist():
            continue
        out = {}
        for i, r in linhas(z, nome):
            if r[i["NR_TURNO"]] != "1":
                continue
            mun = r[i["CD_MUNICIPIO"]].zfill(5)
            zona = str(int(r[i["NR_ZONA"]]))
            local = str(int(r[i["NR_LOCAL_VOTACAO"]]))
            reg = out.setdefault(mun, {}).setdefault(zona, {}).get(local)
            if reg is None:
                reg = [
                    r[i["NM_LOCAL_VOTACAO"]].strip(),
                    r[i["NM_BAIRRO"]].strip(),
                    r[i["DS_ENDERECO"]].strip(),
                    coord(r[i["NR_LATITUDE"]]),
                    coord(r[i["NR_LONGITUDE"]]),
                    0,
                    0,
                ]
                out[mun][zona][local] = reg
            reg[5] += int(r[i["QT_ELEITOR_SECAO"]] or 0)
            reg[6] += 1
        gravar("locais", uf, out)
        print("locais", uf, len(out), "municípios", flush=True)


def historico():
    """Por UF: cargo -> turno -> {cand: {número: [nome, partido]}, mun: {município: {zona: {número: votos}}}}.

    Presidente sai do arquivo BR; Governador e Senador, dos arquivos de cada UF.
    """
    z = abrir_zip("votacao_candidato_munzona/votacao_candidato_munzona_2022.zip")
    por_uf = {}

    def somar(i, r, cargos):
        cargo = r[i["CD_CARGO"]]
        if cargo not in cargos:
            return
        uf = r[i["SG_UF"]].lower()
        turno = "t" + r[i["NR_TURNO"]]
        bloco = por_uf.setdefault(uf, {"ano": 2022, "cargos": {}})["cargos"].setdefault(cargo, {}).setdefault(
            turno, {"cand": {}, "mun": {}}
        )
        n = r[i["NR_CANDIDATO"]]
        if n not in bloco["cand"]:
            bloco["cand"][n] = [r[i["NM_URNA_CANDIDATO"]].strip(), r[i["SG_PARTIDO"]].strip()]
        votos = int(r[i["QT_VOTOS_NOMINAIS"]] or 0)
        if not votos:
            return
        mun = r[i["CD_MUNICIPIO"]].zfill(5)
        zona = str(int(r[i["NR_ZONA"]]))
        z_ = bloco["mun"].setdefault(mun, {}).setdefault(zona, {})
        z_[n] = z_.get(n, 0) + votos

    for i, r in linhas(z, "votacao_candidato_munzona_2022_BR.csv"):
        somar(i, r, {"1"})
    print("historico presidente lido", flush=True)

    for uf in UFS:
        nome = f"votacao_candidato_munzona_2022_{uf.upper()}.csv"
        if nome in z.namelist():
            for i, r in linhas(z, nome):
                somar(i, r, {"3", "5"})
        if uf in por_uf:
            gravar("2022", uf, por_uf.pop(uf))
            print("historico", uf, flush=True)


if __name__ == "__main__":
    {"locais": locais, "historico": historico}[sys.argv[1]]()
