/**
 * Motor de relatórios do RMS Finance (PDF e Excel) no padrão do MIV da RMS:
 * marinho #0B162C, dourado #D9A73B, marfim #F5F1E6; logotipo, título, período,
 * data e hora da emissão, usuário que solicitou e, quando pedido, bloco de assinatura.
 */
import type { Signatario } from '../components/Signatarios';

export type TipoColuna = 'texto' | 'moeda' | 'data' | 'numero' | 'pct';
export interface Coluna { titulo: string; chave: string; tipo?: TipoColuna; largura?: number }
export type Linha = Record<string, unknown> & { _estilo?: 'sub' | 'total' | 'grupo' };
export interface Secao { titulo?: string; colunas: Coluna[]; linhas: Linha[] }
export interface Relatorio {
  titulo: string; periodo: string; filtros?: string; usuario: string; arquivo: string;
  resumo?: { rotulo: string; valor: string }[]; secoes: Secao[]; assinaturas?: Signatario[]; paisagem?: boolean; observacao?: string;
}

const NAVY: [number, number, number] = [11, 22, 44], GOLD: [number, number, number] = [217, 167, 59], IVORY: [number, number, number] = [245, 241, 230];
const MUTED: [number, number, number] = [107, 113, 132];
const agora = () => new Date();
const fmtEmissao = (d: Date) => d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const moeda = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBR = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : String(v ?? ''));
const texto = (c: Coluna, v: unknown) => c.tipo === 'moeda' ? moeda(v) : c.tipo === 'data' ? dataBR(v)
  : c.tipo === 'pct' ? (v === null || v === undefined || v === '' ? '' : (Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%')
  : c.tipo === 'numero' ? (v === null || v === undefined || v === '' ? '' : Math.round(Number(v)).toLocaleString('pt-BR')) : String(v ?? '');
const limpa = (s: string) => s.replace(/−/g, '-');

let logoCache: string | null = null;
async function logo() {
  if (logoCache) return logoCache;
  const b = await (await fetch('/logo-rms-marfim.png')).blob();
  logoCache = await new Promise<string>(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); });
  return logoCache;
}
function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const carimbo = () => { const d = agora(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; };

/* ======================= PDF ======================= */
export async function gerarPDF(r: Relatorio) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: r.paisagem ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const img = await logo(); const emissao = fmtEmissao(agora());

  const cabecalho = () => {
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 24, 'F');
    doc.addImage(img, 'PNG', M, 3.2, 39, 14, 'logo-rms', 'FAST');
    doc.setTextColor(...GOLD); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.text('F I N A N C E', M + 0.5, 21.6);
    doc.setTextColor(...IVORY); doc.setFont('times', 'bold'); doc.setFontSize(15); doc.text(limpa(r.titulo), W - M, 11, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(limpa(/^Posição/.test(r.periodo) ? r.periodo : 'Período: ' + r.periodo), W - M, 17, { align: 'right' });
    doc.setFillColor(...GOLD); doc.rect(0, 24, W, 0.8, 'F');
    doc.setTextColor(...MUTED); doc.setFontSize(7.5);
    doc.text(limpa(`Emitido em ${emissao} por ${r.usuario}${r.filtros ? '  ·  ' + r.filtros : ''}`), M, 29.5, { maxWidth: W - 2 * M });
  };
  const rodape = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(...GOLD); doc.setLineWidth(0.3); doc.line(M, H - 10, W - M, H - 10);
      doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text('RMS Organização Contábil · Relatório emitido pelo RMS Finance', M, H - 6);
      doc.text(`Página ${i} de ${n}`, W - M, H - 6, { align: 'right' });
    }
  };

  cabecalho();
  let y = 34;
  if (r.resumo?.length) {
    const n = r.resumo.length, gap = 3, w = (W - 2 * M - gap * (n - 1)) / n;
    r.resumo.forEach((k, i) => {
      const x = M + i * (w + gap);
      doc.setFillColor(...(i === 0 ? NAVY : IVORY)); doc.roundedRect(x, y, w, 15, 1.5, 1.5, 'F');
      doc.setTextColor(...(i === 0 ? [185, 192, 208] as [number, number, number] : MUTED)); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(limpa(k.rotulo), x + 3, y + 5);
      doc.setTextColor(...(i === 0 ? GOLD : NAVY)); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(limpa(k.valor), x + 3, y + 11.5);
    });
    y += 20;
  }

  for (const s of r.secoes) {
    if (s.titulo) {
      if (y > H - 40) { doc.addPage(); cabecalho(); y = 34; }
      doc.setTextColor(...NAVY); doc.setFont('times', 'bold'); doc.setFontSize(11.5); doc.text(limpa(s.titulo), M, y + 3); y += 5;
    }
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, top: 34, bottom: 14 },
      head: [s.colunas.map(c => c.titulo)],
      body: s.linhas.map(l => s.colunas.map(c => limpa(texto(c, l[c.chave])))),
      styles: { font: 'helvetica', fontSize: s.colunas.length > 9 ? 6.5 : 8, cellPadding: 1.6, textColor: [28, 34, 51], lineColor: [228, 222, 208], lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: IVORY, fontStyle: 'bold', halign: 'left' },
      alternateRowStyles: { fillColor: [251, 249, 243] },
      columnStyles: Object.fromEntries(s.colunas.map((c, i) => [i, { halign: c.tipo && c.tipo !== 'texto' && c.tipo !== 'data' ? 'right' : 'left', cellWidth: c.largura ?? 'auto' }])),
      didParseCell: d => {
        if (d.section === 'head') { const c = s.colunas[d.column.index]; if (c.tipo && c.tipo !== 'texto' && c.tipo !== 'data') d.cell.styles.halign = 'right'; return; }
        const l = s.linhas[d.row.index]; const c = s.colunas[d.column.index];
        if (l?._estilo === 'total') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [243, 227, 188]; }
        if (l?._estilo === 'sub') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = IVORY; }
        if (l?._estilo === 'grupo') { d.cell.styles.textColor = MUTED; if (d.column.index === 0) d.cell.styles.cellPadding = { left: 5, top: 1.6, bottom: 1.6, right: 1.6 }; }
        if ((c?.tipo === 'moeda' || c?.tipo === 'numero') && Number(l?.[c.chave]) < 0) d.cell.styles.textColor = [178, 58, 58];
      },
      didDrawPage: () => cabecalho(),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (r.observacao) { doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); const t = doc.splitTextToSize(limpa(r.observacao), W - 2 * M); if (y + t.length * 4 > H - 16) { doc.addPage(); cabecalho(); y = 38; } doc.text(t, M, y); y += t.length * 3.5 + 4; }

  if (r.assinaturas?.length) {
    const porLinha = r.paisagem ? 3 : 2, w = (W - 2 * M - 10 * (porLinha - 1)) / porLinha, alt = 34;
    const linhas = Math.ceil(r.assinaturas.length / porLinha);
    if (y + 12 + linhas * alt > H - 14) { doc.addPage(); cabecalho(); y = 38; }
    doc.setTextColor(...NAVY); doc.setFont('times', 'bold'); doc.setFontSize(11.5); doc.text('Assinaturas', M, y + 3);
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text('Documento preparado para assinatura eletrônica (gov.br ou certificado digital ICP-Brasil).', M, y + 8); y += 22;
    r.assinaturas.forEach((s, i) => {
      const x = M + (i % porLinha) * (w + 10), yy = y + Math.floor(i / porLinha) * alt;
      doc.setDrawColor(...NAVY); doc.setLineWidth(0.3); doc.line(x, yy, x + w, yy);
      doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(limpa(s.nome), x, yy + 5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(limpa(s.cargo + (s.registro ? ' · ' + s.registro : '')), x, yy + 9.5);
      doc.text('Data: ____/____/________', x, yy + 14);
    });
  }
  rodape();
  baixar(doc.output('blob'), `${r.arquivo}_${carimbo()}.pdf`);
}

/* ======================= Excel ======================= */
export async function gerarExcel(r: Relatorio) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'RMS Finance'; wb.created = agora();
  const ws = wb.addWorksheet(r.titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, ''), { views: [{ showGridLines: false }], pageSetup: { orientation: r.paisagem ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const nCol = Math.max(4, ...r.secoes.map(s => s.colunas.length));
  const hex = (c: [number, number, number]) => 'FF' + c.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  const preencher = (lin: number, cor: [number, number, number]) => { for (let c = 1; c <= nCol; c++) ws.getCell(lin, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex(cor) } }; };

  [1, 2, 3].forEach(l => { preencher(l, NAVY); ws.getRow(l).height = 20; });
  const img = await logo();
  ws.addImage(wb.addImage({ base64: img, extension: 'png' }), { tl: { col: 0.15, row: 0.25 }, ext: { width: 175, height: 63 } });
  ws.mergeCells(1, Math.max(3, nCol - 3), 2, nCol);
  const t = ws.getCell(1, Math.max(3, nCol - 3)); t.value = r.titulo; t.font = { name: 'Georgia', bold: true, size: 15, color: { argb: hex(IVORY) } }; t.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.mergeCells(3, Math.max(3, nCol - 3), 3, nCol);
  const p = ws.getCell(3, Math.max(3, nCol - 3)); p.value = /^Posição/.test(r.periodo) ? r.periodo : 'Período: ' + r.periodo; p.font = { name: 'Calibri', size: 10, color: { argb: hex(GOLD) } }; p.alignment = { horizontal: 'right' };
  preencher(4, GOLD); ws.getRow(4).height = 3;
  ws.mergeCells(5, 1, 5, nCol);
  const e = ws.getCell(5, 1); e.value = `Emitido em ${fmtEmissao(agora())} por ${r.usuario}${r.filtros ? '  ·  ' + r.filtros : ''}`; e.font = { size: 9, italic: true, color: { argb: hex(MUTED) } };
  let lin = 7;

  if (r.resumo?.length) {
    r.resumo.forEach((k, i) => {
      const c1 = ws.getCell(lin, i + 1), c2 = ws.getCell(lin + 1, i + 1);
      c1.value = k.rotulo; c1.font = { size: 8, color: { argb: hex(MUTED) } };
      c2.value = k.valor; c2.font = { bold: true, size: 11, color: { argb: hex(NAVY) } };
      [c1, c2].forEach(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex(IVORY) } }; });
    });
    lin += 3;
  }
  const larguras = Array(nCol).fill(12) as number[];
  for (const s of r.secoes) {
    if (s.titulo) { const c = ws.getCell(lin, 1); c.value = s.titulo; c.font = { name: 'Georgia', bold: true, size: 12, color: { argb: hex(NAVY) } }; lin++; }
    s.colunas.forEach((c, i) => {
      const cel = ws.getCell(lin, i + 1); cel.value = c.titulo;
      cel.font = { bold: true, color: { argb: hex(IVORY) }, size: 10 }; cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex(NAVY) } };
      cel.alignment = { horizontal: c.tipo && c.tipo !== 'texto' && c.tipo !== 'data' ? 'right' : 'left', vertical: 'middle', wrapText: true };
      larguras[i] = Math.max(larguras[i], Math.min(45, c.titulo.length + 2));
    });
    ws.getRow(lin).height = 18; lin++;
    s.linhas.forEach((l, idx) => {
      s.colunas.forEach((c, i) => {
        const v = l[c.chave]; const cel = ws.getCell(lin, i + 1);
        if (c.tipo === 'moeda' || c.tipo === 'numero' || c.tipo === 'pct') { cel.value = v === null || v === undefined || v === '' ? null : Number(v); cel.numFmt = c.tipo === 'moeda' ? '#,##0.00;[Red]-#,##0.00' : c.tipo === 'pct' ? '0.0%' : '#,##0;[Red]-#,##0'; }
        else if (c.tipo === 'data' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const [a, m, d] = v.slice(0, 10).split('-').map(Number); cel.value = new Date(Date.UTC(a, m - 1, d)); cel.numFmt = 'dd/mm/yyyy'; }
        else cel.value = v === null || v === undefined ? '' : String(v);
        cel.font = { size: 10, bold: l._estilo === 'sub' || l._estilo === 'total', color: { argb: l._estilo === 'grupo' ? hex(MUTED) : 'FF1C2233' } };
        if (l._estilo === 'grupo' && i === 0) cel.alignment = { indent: 2 };
        const fundo = l._estilo === 'total' ? 'FFF3E3BC' : l._estilo === 'sub' ? hex(IVORY) : idx % 2 ? 'FFFBF9F3' : null;
        if (fundo) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fundo } };
        cel.border = { bottom: { style: 'thin', color: { argb: 'FFE4DED0' } } };
        larguras[i] = Math.max(larguras[i], Math.min(45, texto(c, v).length + 2));
      });
      lin++;
    });
    lin += 1;
  }
  larguras.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  if (r.observacao) { ws.mergeCells(lin, 1, lin, nCol); const c = ws.getCell(lin, 1); c.value = r.observacao; c.font = { size: 9, italic: true, color: { argb: hex(MUTED) } }; c.alignment = { wrapText: true }; ws.getRow(lin).height = 30; lin += 2; }
  if (r.assinaturas?.length) {
    const c = ws.getCell(lin, 1); c.value = 'Assinaturas'; c.font = { name: 'Georgia', bold: true, size: 12, color: { argb: hex(NAVY) } }; lin += 2;
    r.assinaturas.forEach((s, i) => {
      const col = (i % 2) * 3 + 1, l0 = lin + Math.floor(i / 2) * 5;
      ws.getCell(l0, col).border = { top: { style: 'thin', color: { argb: hex(NAVY) } } };
      ws.getCell(l0, col).value = s.nome; ws.getCell(l0, col).font = { bold: true, color: { argb: hex(NAVY) } };
      ws.getCell(l0 + 1, col).value = s.cargo + (s.registro ? ' · ' + s.registro : ''); ws.getCell(l0 + 1, col).font = { size: 9, color: { argb: hex(MUTED) } };
      ws.getCell(l0 + 2, col).value = 'Data: ____/____/________'; ws.getCell(l0 + 2, col).font = { size: 9, color: { argb: hex(MUTED) } };
    });
  }
  ws.headerFooter.oddFooter = '&L&8RMS Organização Contábil · RMS Finance&R&8Página &P de &N';
  const buf = await wb.xlsx.writeBuffer();
  baixar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${r.arquivo}_${carimbo()}.xlsx`);
}
