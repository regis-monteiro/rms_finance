import { Cabecalho } from '../components/Layout';

export default function EmBreve({ titulo }: { titulo: string }) {
  return (
    <>
      <Cabecalho titulo={titulo} sub="Em desenvolvimento" />
      <div className="card empty"><h3 style={{ marginBottom: 8 }}>Em construção</h3>Esta tela segue o layout aprovado no protótipo e entra na próxima etapa.</div>
    </>
  );
}
