# Integração bancária (Inter)

A tela **Conciliação bancária** busca o extrato do Inter direto no banco (extrato completo e saldo, em tempo real), sem arquivo OFX.

A integração por API com o Efí foi retirada em 04/11/2026 porque o banco cobra pelos extratos via API. A conta Efí é conciliada por arquivo OFX.

## Como funciona e por que é seguro

- O app chama a função `app/api/extrato.js`, que roda no servidor da Vercel.
- A função só responde a usuários logados com perfil Diretor ou Financeiro.
- As credenciais dos bancos ficam em variáveis de ambiente da Vercel. Elas não ficam no GitHub, no banco de dados nem no navegador.
- As integrações são criadas no banco **somente com permissões de consulta**. Mesmo que uma credencial vaze, ela não permite pagamentos nem Pix.
- Itens com o mesmo valor e a mesma data de um lançamento já pago são conciliados automaticamente. Baixas de previsões e lançamentos novos continuam com aprovação manual.

## 1. Criar a integração no Inter

1. No Internet Banking PJ do Inter, abra a área de integrações e clique em **Nova integração**.
2. Em **API Banking**, marque apenas **Consultar extrato e saldo**. Não marque pagamentos, Pix ou cobrança.
3. Confirme a criação. Anote o **Client ID** e o **Client Secret** e baixe o arquivo ZIP.
4. O ZIP contém `Inter_API_Certificado.crt` e `Inter_API_Chave.key`.
5. Aguarde a integração ficar **Ativa**.

## 2. Cadastrar as credenciais na Vercel

1. Abra o projeto em Vercel > **Settings** > **Environment Variables**.
2. Crie cada variável abaixo, com ambiente **Production** e a opção **Sensitive** marcada:

| Variável | Conteúdo |
|---|---|
| `INTER_CLIENT_ID` | Client ID do Inter |
| `INTER_CLIENT_SECRET` | Client Secret do Inter |
| `INTER_CERT` | Todo o conteúdo do arquivo `.crt`, aberto no Bloco de Notas |
| `INTER_KEY` | Todo o conteúdo do arquivo `.key`, aberto no Bloco de Notas |
| `INTER_CONTA` | Opcional: número da conta corrente, só se houver mais de uma conta no mesmo CNPJ |

3. Em **Deployments**, abra o último deploy e clique em **Redeploy**. As variáveis só passam a valer em um novo deploy.
4. Apague do computador os arquivos baixados (ZIP, `.crt` e `.key`), ou guarde-os em local protegido.

## 3. No app

1. Rode `supabase/011_integracao_bancaria.sql` no Supabase. O script liga a conta **Inter** à integração (e o `013_remover_integracao_efi.sql` desliga o Efí).
2. Para conferir ou alterar esse vínculo, use **Cadastros > Contas > Integração bancária**.
3. Abra **Conciliação bancária** e escolha a conta. O extrato dos últimos 30 dias é buscado automaticamente, e você pode mudar o período e clicar em **Buscar** para outro intervalo de até 90 dias.

## Troca ou revogação

- **Suspeita de vazamento:** revogue a integração no Inter. O acesso é cortado na hora.
- **Para voltar a usar:** crie novas credenciais, atualize as variáveis na Vercel e faça um novo deploy.
