"""Converte a aba 'Fluxo de caixa' da planilha RMS em SQL de carga para o RMS Finance."""
import sys, datetime as dt, collections, json, openpyxl

ARQ, ANO, SAIDA = sys.argv[1], int(sys.argv[2]), sys.argv[3]
MESES = {m: i+1 for i, m in enumerate(['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'])}
CONTA = {'Gerencianet': 'Efí (Gerencianet)', 'Inter': 'Inter', 'Bradesco': 'Bradesco', 'AF Inter': 'AF Inter', 'AF Bradesco': 'AF Bradesco', 'Caixa': 'Caixa'}
CARTAO = {'CC Itaucard': 'Itaucard', 'CC Porto': 'Porto', 'CC PJ Inter': 'PJ Inter', 'CC Efi': 'Efí'}
VENC = {'Itaucard': 11, 'PJ Inter': 10, 'Efí': 13, 'Porto': 20}
COR = {'FF92D050': 'pago', 'FFFFFF00': 'confirmado'}

wb = openpyxl.load_workbook(ARQ, data_only=True)
ws = wb['Fluxo de caixa']

def q(v):
    if v is None or v == '': return 'null'
    return "'" + str(v).replace("'", "''").strip() + "'"

def texto(v):
    if v is None: return None
    if isinstance(v, dt.datetime): return v.strftime('%m/%Y') if v.day == 1 else v.strftime('%d/%m/%Y')
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip() or None

def data_valida(a, m, d):
    while True:
        try: return dt.date(a, m, d)
        except ValueError: d -= 1

saldos, lanc, compras, pend = {}, [], [], collections.Counter()
for r in range(5, min(ws.max_row, 20000) + 1):
    tipo = ws.cell(r, 3).value
    mes = MESES.get(ws.cell(r, 2).value)
    banco, dia, grupo, docto, sub, trans, desc, valor = (ws.cell(r, k).value for k in (4, 5, 6, 7, 8, 9, 10, 11))
    if tipo == 'Saldo Inicial' and banco:
        saldos[CONTA[banco]] = round(float(valor or 0), 2); continue
    if tipo not in ('Entrada', 'Saída') or not isinstance(valor, (int, float)) or round(valor, 2) == 0 or not mes:
        continue
    valor = round(float(valor), 2)
    fill = ws.cell(r, 11).fill.fgColor
    rgb = fill.rgb if isinstance(fill.rgb, str) else None
    status = COR.get(rgb, 'previsto')
    if rgb not in COR and rgb not in ('00000000', None): pend['cor fora da legenda'] += 1
    conta = CONTA.get(banco)
    obs = []
    if not grupo:
        grupo = 'Administrativas'; obs.append('grupo não informado na planilha'); pend['sem grupo'] += 1
    if grupo == 'Estimativa':
        grupo = 'Honorários'; obs.append('estimativa da planilha'); pend['estimativa'] += 1
    venc = data_valida(ANO, mes, int(dia) if dia else 1)
    sub = texto(sub)
    if sub in CARTAO:
        compras.append(dict(cartao=CARTAO[sub], venc=venc, conta=conta, status=status, grupo=grupo,
                            data=trans.date() if isinstance(trans, dt.datetime) else None,
                            parcela=None if isinstance(trans, dt.datetime) else texto(trans),
                            desc=texto(desc) or '(sem descrição)', valor=-valor, obs=obs, docto=texto(docto)))
        continue
    if status == 'pago' and not conta:
        status = 'confirmado'; obs.append('pago na planilha, sem conta informada'); pend['pago sem conta'] += 1
    if not conta: pend['sem conta'] += 1
    lanc.append(dict(tipo='entrada' if valor > 0 else 'saida', conta=conta, venc=venc, status=status, grupo=grupo,
                     sub=sub, fav=texto(desc) or '', ref=texto(trans), doc=texto(docto), valor=abs(valor), obs=obs))

# Faturas: uma por cartão e mês de vencimento; pagamento por conta usada na planilha
fat = collections.OrderedDict()
for c in compras:
    k = (c['cartao'], c['venc'].month)
    fat.setdefault(k, []).append(c)
pagamentos = []
for (cartao, mes), itens in fat.items():
    porconta = collections.OrderedDict()
    for c in itens: porconta.setdefault(c['conta'], []).append(c)
    for conta, cs in porconta.items():
        total = round(sum(c['valor'] for c in cs), 2)
        sts = [c['status'] for c in cs]
        st = 'pago' if all(s == 'pago' for s in sts) else ('confirmado' if any(s in ('pago', 'confirmado') for s in sts) else 'previsto')
        obs = []
        if conta == 'Caixa': obs.append('revisar conta: planilha indica Caixa (espécie)'); pend['fatura paga pela Caixa'] += 1
        if not conta:
            obs.append('conta a definir'); pend['fatura sem conta'] += 1
            if st == 'pago': st = 'confirmado'
        if total > 0:
            pagamentos.append(dict(cartao=cartao, mes=mes, conta=conta, status=st, valor=total, obs=obs,
                                   venc=data_valida(ANO, mes, VENC[cartao])))

S = []
w = S.append
w(f"-- RMS Finance · Carga da planilha de fluxo de caixa {ANO}")
w("-- Gerado automaticamente. Apaga os lançamentos, faturas e compras de cartão do ano e recarrega.")
w("-- Executar no Supabase: SQL Editor > New query > colar > Run")
w("begin;")
w(f"delete from lancamentos where extract(year from vencimento) = {ANO};")
w(f"delete from compras_cartao where fatura_id in (select id from faturas where extract(year from competencia) = {ANO});")
w(f"delete from faturas where extract(year from competencia) = {ANO};")
for conta, v in saldos.items():
    w(f"update contas set saldo_inicial = {v}, data_saldo_inicial = date '{ANO}-01-01' where nome = {q(conta)};")
# subgrupos novos
subs = sorted({(l['grupo'], l['sub']) for l in lanc if l['sub']})
w("insert into subgrupos (grupo_id, nome) select g.id, v.s from (values")
w(",\n".join(f"({q(g)},{q(s)})" for g, s in subs))
w(") v(g, s) join grupos g on g.nome = v.g on conflict (grupo_id, nome) do nothing;")
# faturas
w("insert into faturas (cartao_id, competencia, data_fechamento, data_vencimento) select c.id, v.comp::date, (v.venc::date - 7), v.venc::date from (values")
w(",\n".join(f"({q(cartao)},'{ANO}-{mes:02d}-01','{data_valida(ANO, mes, VENC[cartao])}')" for (cartao, mes) in fat))
w(") v(cartao, comp, venc) join cartoes c on c.nome = v.cartao;")
# compras
def blocos(lst, n=500):
    for i in range(0, len(lst), n): yield lst[i:i+n]
for b in blocos(compras):
    w("insert into compras_cartao (cartao_id, fatura_id, data_compra, descricao, grupo_id, parcela, valor) "
      "select c.id, f.id, coalesce(v.dc::date, f.data_fechamento - 1), v.d, g.id, v.p, v.val from (values")
    w(",\n".join(f"({q(x['cartao'])},'{ANO}-{x['venc'].month:02d}-01',{q(x['data'])},{q(x['desc'])},{q(x['grupo'])},{q(x['parcela'])},{x['valor']})" for x in b))
    w(") v(cartao, comp, dc, d, gr, p, val) join cartoes c on c.nome = v.cartao "
      "join faturas f on f.cartao_id = c.id and f.competencia = v.comp::date join grupos g on g.nome = v.gr;")
# lançamentos
cols = "(tipo, conta_id, vencimento, data_pagamento, grupo_id, subgrupo_id, favorecido, referencia, documento, valor, status, observacao)"
for b in blocos(lanc):
    w(f"insert into lancamentos {cols} select v.t::tipo_lancamento, ct.id, v.ve::date, case when v.st = 'pago' then v.ve::date end, g.id, s.id, coalesce(v.f, ''), v.r, v.doc, v.val, v.st::status_lancamento, v.o from (values")
    w(",\n".join(f"({q(x['tipo'])},{q(x['conta'])},'{x['venc']}',{q(x['grupo'])},{q(x['sub'])},{q(x['fav'])},{q(x['ref'])},{q(x['doc'])},{x['valor']},{q(x['status'])},{q('; '.join(x['obs']))})" for x in b))
    w(") v(t, ct, ve, gr, sg, f, r, doc, val, st, o) join grupos g on g.nome = v.gr "
      "left join contas ct on ct.nome = v.ct left join subgrupos s on s.grupo_id = g.id and s.nome = v.sg;")
# pagamentos de fatura
w(f"insert into lancamentos {cols[:-1]}, fatura_id) select 'saida', ct.id, v.ve::date, case when v.st = 'pago' then v.ve::date end, g.id, null, 'Fatura ' || v.ca, v.comp, null, v.val, v.st::status_lancamento, v.o, f.id from (values")
w(",\n".join(f"({q(p['cartao'])},'{ANO}-{p['mes']:02d}-01',{q(p['conta'])},'{p['venc']}',{p['valor']},{q(p['status'])},{q('; '.join(p['obs']))})" for p in pagamentos))
w(") v(ca, comp, ct, ve, val, st, o) join cartoes c on c.nome = v.ca join faturas f on f.cartao_id = c.id and f.competencia = v.comp::date "
  "left join contas ct on ct.nome = v.ct join grupos g on g.nome = 'Pagamento de fatura';")
w("commit;")
open(SAIDA, 'w').write("\n".join(S) + "\n")

# Resumo para conferência
esperado = round(sum(saldos.values()) + sum((x['valor'] if x['tipo'] == 'entrada' else -x['valor']) for x in lanc) - sum(c['valor'] for c in compras), 2)
print(json.dumps(dict(saldos_iniciais=len(saldos), lancamentos=len(lanc), compras=len(compras), faturas=len(fat),
                      pagamentos_fatura=len(pagamentos), saldo_final_projetado=esperado, pendencias=pend), ensure_ascii=False, indent=1))
