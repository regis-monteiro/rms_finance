import { rotuloCadastro, soDigitos } from '../lib/documento';

/** Lista de escolha de cadastros: o CPF/CNPJ sem pontuação vai como rótulo, para a busca achar digitando só os números */
export default function OpcoesCadastro({ id, lista }: { id: string; lista: { id: number; nome: string; documento: string; ativo: boolean; nome_fantasia?: string | null }[] }) {
  return <datalist id={id}>{lista.filter(b => b.ativo).map(b => <option key={b.id} value={rotuloCadastro(b)} label={[soDigitos(b.documento), b.nome_fantasia].filter(Boolean).join(' · ')} />)}</datalist>;
}
