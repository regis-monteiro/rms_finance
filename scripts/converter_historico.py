"""
Converte as planilhas de fluxo de caixa de anos encerrados (2017 a 2025) em SQL de carga para o RMS Finance.
As regras seguem docs/importacao_historico.md.

Uso: python3 converter_historico.py ARQUIVO ANO SAIDA.sql [--senha SENHA]
Aceita .xlsx, .xlsm e .xlsb; planilhas com senha são abertas em memória e a senha não é gravada.
"""
import sys, io, json, datetime as dt, collections, argparse

MESES = {m: i + 1 for i, m in enumerate(['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'])}
MESES['marco'] = 3

def conta_para(banco, ano):
    b = (banco or '').strip().lower()
    if not b: return None
    fixo = {'gerencianet': 'Efí (Gerencianet)', 'inter': 'Inter', 'caixa': 'Caixa', 'af inter': 'AF Inter', 'af bradesco': 'AF Bradesco',
            'rms bradesco': 'Bradesco', 'cef': 'CEF', 'poupança': 'Poupança CEF', 'itaú': 'Itaú', 'oportunit': 'Oportunit', 'rms': 'Oportunit',
            'omiecash': 'Omiecash', 'cheques': 'Cheques'}
    if b == 'bradesco': return 'Bradesco' if ano >= 2025 else 'Bradesco (antiga)'
    if b in ('reginaldo', 'bloqueio judicial', 'outros', 'vanessa'): return ''   # não importar
    return fixo.get(b, '?' + banco)

CARTAO = {'cc itaucard': 'Itaucard', 'cc porto': 'Porto', 'cc pj inter': 'PJ Inter', 'cc inter': 'PJ Inter', 'cc efi': 'Efí',
          'cc pj bradesco': 'PJ Bradesco', 'cc bradesco': 'PJ Bradesco', 'cc rms bradesco': 'PJ Bradesco'}
VENC = {'Itaucard': 11, 'PJ Inter': 10, 'Efí': 13, 'Porto': 20, 'PJ Bradesco': 20}
GRUPOS = ['Honorários', 'IRPF', 'Certificação', 'Comissões', 'Operação', 'Clientes', 'VGP', 'Funcionários', 'Treinamentos', 'Endomarketing',
          'Administrativas', 'Alimentação', 'Informática', 'Imóveis', 'Locomoção', 'Manut Equipamentos', 'Manut. Instalações', 'Manutenção Predial',
          'Material Escritório', 'Material Limpeza/Copa', 'Marketing', 'Não previstas', 'Impostos', 'Rendimentos', 'Juros Bancários',
          'Tarifas Bancárias', 'Tarifas Diversas', 'Pró-labore', 'Equipamentos', 'Mobiliário', 'Investimento', 'Distribuição de lucros', 'Sócios',
          'Empréstimos', 'Transferências', 'Brasil Canadá']
CANON = {g.lower(): g for g in GRUPOS}
CANON.update({'osasco': 'Não previstas', 'quickfy': 'Informática', 'elaine': 'Administrativas', 'nota fiscal paulista': 'Sócios',
              'fornecedores': 'Operação', 'factoring': 'Empréstimos', 'pró-labore sócios': 'Pró-labore', 'estimativa': 'Honorários'})

def abrir(arq, senha):
    dados = open(arq, 'rb').read()
    try:
        import msoffcrypto
        of = msoffcrypto.OfficeFile(io.BytesIO(dados))
        if of.is_encrypted():
            if not senha: sys.exit('Planilha protegida: informe --senha')
            of.load_key(password=senha); out = io.BytesIO(); of.decrypt(out); dados = out.getvalue()
    except ImportError: pass
    except Exception as e:
        if 'not' not in str(e).lower(): raise
    return io.BytesIO(dados)

def linhas(arq, senha, limite=40000):
    buf = abrir(arq, senha)
    alvo = lambda nomes: next(n for n in nomes if n.lower().replace(' de ', ' ') == 'fluxo caixa')
    if arq.lower().endswith('.xlsb'):
        import tempfile, os
        from pyxlsb import open_workbook
        tmp = tempfile.NamedTemporaryFile(suffix='.xlsb', delete=False); tmp.write(buf.getvalue()); tmp.close()
        try:
            return _ler_xlsb(open_workbook, tmp.name, alvo, limite)
        finally:
            os.unlink(tmp.name)
    import openpyxl
    wb = openpyxl.load_workbook(buf, data_only=True, read_only=True)
    return [list(r[:14]) + [None] * (14 - len(r[:14])) for r in wb[alvo(wb.sheetnames)].iter_rows(max_row=limite, values_only=True)]

def _ler_xlsb(open_workbook, caminho, alvo, limite):
    with open_workbook(caminho) as wb, wb.get_sheet(alvo(wb.sheets)) as sh:
        out = []
        for i, row in enumerate(sh.rows()):
            if i >= limite: break
            v = [None] * 14
            for c in row:
                if c.c < 14: v[c.c] = c.v
            out.append(v)
        return out

def como_data(v):
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    if isinstance(v, (int, float)) and 30000 < v < 60000: return (dt.datetime(1899, 12, 30) + dt.timedelta(days=int(v))).date()
    return None

def texto(v):
    if v is None: return None
    d = como_data(v) if not isinstance(v, (int, float)) or 30000 < v < 60000 else None
    if d: return d.strftime('%m/%Y') if d.day == 1 else d.strftime('%d/%m/%Y')
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip() or None

def data_valida(a, m, d):
    d = max(1, min(31, int(d or 1)))
    while True:
        try: return dt.date(a, m, d)
        except ValueError: d -= 1

def q(v):
    return 'null' if v is None or v == '' else "'" + str(v).replace("'", "''").strip() + "'"

def converter(arq, ano, saida, senha=None, nome=None):
    L = linhas(arq, senha)
    h = next(i for i, r in enumerate(L) if 'Lançamento' in [str(x).strip() for x in r if x])
    H = {str(x).strip(): i for i, x in enumerate(L[h]) if x}
    col = lambda r, k: r[H[k]] if k in H else None
    lanc, compras, problemas, ignorados = [], [], collections.Counter(), collections.Counter()
    saldo_ini = collections.defaultdict(float); saldo_fim = collections.defaultdict(float)
    tot = collections.defaultdict(lambda: [0.0, 0.0])
    for r in L[h + 1:]:
        tipo, valor, banco = col(r, 'Tipo'), col(r, 'Lançamento'), col(r, 'Banco')
        if not isinstance(valor, (int, float)) or tipo in ('Saldo final', 'Saldo Final', 'Saldo'): continue
        conta = conta_para(banco, ano)
        if tipo == 'Saldo Inicial':
            if conta: saldo_ini[conta] += valor; saldo_fim[conta] += valor
            continue
        valor = round(float(valor), 2)
        if valor == 0: continue
        if conta == '': ignorados['conta não importada: ' + str(banco).strip()] += 1; continue
        if conta is None: ignorados['linha sem banco'] += 1; continue
        if conta.startswith('?'): problemas['banco desconhecido: ' + conta[1:]] += 1; continue
        mes = MESES.get(str(col(r, 'Mês') or '').strip().lower())
        if not mes: problemas['mês inválido: ' + str(col(r, 'Mês'))] += 1; continue
        g = str(col(r, 'Grupo') or '').strip()
        obs = []
        if not g: grupo = 'Administrativas'; obs.append('grupo não informado na planilha')
        else:
            grupo = CANON.get(g.lower())
            if not grupo: problemas['grupo desconhecido: ' + g] += 1; continue
        if g.lower() == 'estimativa': obs.append('estimativa da planilha')
        saldo_fim[conta] += valor
        tot[mes][0 if valor > 0 else 1] += abs(valor)
        venc = data_valida(ano, mes, col(r, 'Dia do Mês'))
        sub = texto(col(r, 'Sub-Grupo')); trans = col(r, 'Transação')
        cartao = CARTAO.get((sub or '').lower())
        if cartao:
            compras.append(dict(cartao=cartao, mes=mes, conta=conta, grupo=grupo, data=como_data(trans),
                                parcela=None if como_data(trans) else texto(trans), desc=texto(col(r, 'Descrição')) or '(sem descrição)',
                                valor=-valor, obs=obs))
            continue
        lanc.append(dict(tipo='entrada' if valor > 0 else 'saida', conta=conta, venc=venc, grupo=grupo, sub=sub,
                         fav=texto(col(r, 'Descrição')) or '', ref=texto(trans), doc=texto(col(r, 'Docto')), valor=abs(valor), obs=obs))
    if problemas:
        print(json.dumps(dict(ano=ano, problemas=problemas), ensure_ascii=False, indent=1)); sys.exit(1)

    fat = collections.OrderedDict()
    for c in compras: fat.setdefault((c['cartao'], c['mes']), []).append(c)
    pagamentos = []
    for (cartao, mes), itens in fat.items():
        porconta = collections.OrderedDict()
        for c in itens: porconta.setdefault(c['conta'], []).append(c)
        for conta, cs in porconta.items():
            total = round(sum(c['valor'] for c in cs), 2)
            if total != 0:
                pagamentos.append(dict(cartao=cartao, mes=mes, conta=conta, valor=total, venc=data_valida(ano, mes, VENC[cartao])))

    S = []; w = S.append
    w(f"-- RMS Finance · Carga do histórico {ano} (gerado automaticamente; pode ser executado de novo sem duplicar)")
    w("-- Pré-requisito: supabase/005_importacao.sql. Executar no Supabase: SQL Editor > New query > colar > Run")
    w("begin;")
    w(f"delete from lancamentos where lote_id in (select id from lotes_importacao where ano = {ano});")
    w(f"delete from compras_cartao where lote_id in (select id from lotes_importacao where ano = {ano});")
    w(f"delete from faturas where lote_id in (select id from lotes_importacao where ano = {ano});")
    w(f"delete from lotes_importacao where ano = {ano};")
    totais = [dict(mes=m, entradas=round(tot[m][0], 2), saidas=round(tot[m][1], 2)) for m in range(1, 13) if m in tot]
    w("insert into lotes_importacao (ano, arquivo, lancamentos, compras, saldo_inicial, saldo_final, totais_planilha, observacoes) values "
      f"({ano}, {q(nome or arq.split('/')[-1])}, {len(lanc)}, {len(compras)}, {round(sum(saldo_ini.values()), 2)}, {round(sum(saldo_fim.values()), 2)}, "
      f"{q(json.dumps(totais))}::jsonb, {q('; '.join(f'{k}: {v}' for k, v in ignorados.items()))});")
    lote = f"(select id from lotes_importacao where ano = {ano})"
    subs = sorted({(l['grupo'], l['sub']) for l in lanc if l['sub']})
    if subs:
        w("insert into subgrupos (grupo_id, nome) select g.id, v.s from (values")
        w(",\n".join(f"({q(g)},{q(s)})" for g, s in subs))
        w(") v(g, s) join grupos g on g.nome = v.g on conflict (grupo_id, nome) do nothing;")
    if fat:
        w(f"insert into faturas (cartao_id, competencia, data_fechamento, data_vencimento, lote_id) select c.id, v.comp::date, v.venc::date - 7, v.venc::date, {lote} from (values")
        w(",\n".join(f"({q(c)},'{ano}-{m:02d}-01','{data_valida(ano, m, VENC[c])}')" for (c, m) in fat))
        w(") v(cartao, comp, venc) join cartoes c on c.nome = v.cartao on conflict (cartao_id, competencia) do nothing;")
    blocos = lambda lst, n=500: (lst[i:i + n] for i in range(0, len(lst), n))
    for b in blocos(compras):
        w(f"insert into compras_cartao (cartao_id, fatura_id, data_compra, descricao, grupo_id, parcela, valor, lote_id) "
          f"select c.id, f.id, coalesce(v.dc::date, f.data_fechamento - 1), v.d, g.id, v.p, v.val, {lote} from (values")
        w(",\n".join(f"({q(x['cartao'])},'{ano}-{x['mes']:02d}-01',{q(x['data'])},{q(x['desc'])},{q(x['grupo'])},{q(x['parcela'])},{x['valor']})" for x in b))
        w(") v(cartao, comp, dc, d, gr, p, val) join cartoes c on c.nome = v.cartao join faturas f on f.cartao_id = c.id and f.competencia = v.comp::date "
          "join grupos g on g.nome = v.gr;")
    cols = "(tipo, conta_id, vencimento, data_pagamento, grupo_id, subgrupo_id, favorecido, referencia, documento, valor, status, observacao, lote_id)"
    for b in blocos(lanc):
        w(f"insert into lancamentos {cols} select v.t::tipo_lancamento, ct.id, v.ve::date, v.ve::date, g.id, s.id, coalesce(v.f, ''), v.r, v.doc, v.val, 'pago', v.o, {lote} from (values")
        w(",\n".join(f"({q(x['tipo'])},{q(x['conta'])},'{x['venc']}',{q(x['grupo'])},{q(x['sub'])},{q(x['fav'])},{q(x['ref'])},{q(x['doc'])},{x['valor']},{q('; '.join(x['obs']))})" for x in b))
        w(") v(t, ct, ve, gr, sg, f, r, doc, val, o) join grupos g on g.nome = v.gr join contas ct on ct.nome = v.ct "
          "left join subgrupos s on s.grupo_id = g.id and s.nome = v.sg;")
    if pagamentos:
        w(f"insert into lancamentos {cols[:-1]}, fatura_id) select case when v.val > 0 then 'saida' else 'entrada' end::tipo_lancamento, ct.id, v.ve::date, v.ve::date, g.id, null, "
          f"'Fatura ' || v.ca, v.comp, null, abs(v.val), 'pago', null, {lote}, f.id from (values")
        w(",\n".join(f"({q(p['cartao'])},'{ano}-{p['mes']:02d}-01',{q(p['conta'])},'{p['venc']}',{p['valor']})" for p in pagamentos))
        w(") v(ca, comp, ct, ve, val) join cartoes c on c.nome = v.ca join faturas f on f.cartao_id = c.id and f.competencia = v.comp::date "
          "join contas ct on ct.nome = v.ct join grupos g on g.nome = 'Pagamento de fatura';")
    w("commit;")
    open(saida, 'w').write("\n".join(S) + "\n")
    return dict(ano=ano, lancamentos=len(lanc), compras=len(compras), faturas=len(fat), pagamentos=len(pagamentos),
                saldo_inicial=round(sum(saldo_ini.values()), 2), saldo_final=round(sum(saldo_fim.values()), 2),
                saldo_final_por_conta={k: round(v, 2) for k, v in saldo_fim.items()}, ignorados=ignorados)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('arquivo'); ap.add_argument('ano', type=int); ap.add_argument('saida'); ap.add_argument('--senha'); ap.add_argument('--nome')
    a = ap.parse_args()
    print(json.dumps(converter(a.arquivo, a.ano, a.saida, a.senha, a.nome), ensure_ascii=False, indent=1, default=str))
