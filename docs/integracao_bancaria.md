# Integração bancária (Inter e Efí)

A tela **Conciliação bancária** busca o extrato direto no banco, sem arquivo OFX:

- **Inter:** extrato completo e saldo, em tempo real.
- **Efí:** extrato CNAB 240, gerado no dia seguinte (D+1), mais os Pix recebidos depois do último extrato.

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

## 2. Criar a aplicação no Efí

1. Na conta Efí Empresas, abra **API** > **Introdução** > **Criar aplicação**.
2. Marque os escopos:
   - **API Extratos:** todos os itens, que são só de consulta e de agendamento do arquivo de extrato.
   - **API Pix:** apenas **Consultar Pix** (pix.read).
3. Não marque envio de Pix, pagamentos ou cobranças.
4. Anote o **Client ID** e o **Client Secret** de **Produção**.
5. Em **Meus certificados**, crie um certificado de **Produção** e baixe o arquivo `.p12`.
6. Converta o `.p12` para texto. No Windows, abra o PowerShell e rode o comando abaixo, trocando o caminho pelo do seu arquivo. O resultado vai para a área de transferência:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\certificado.p12")) | Set-Clipboard
   ```

## 3. Cadastrar as credenciais na Vercel

1. Abra o projeto em Vercel > **Settings** > **Environment Variables**.
2. Crie cada variável abaixo, com ambiente **Production** e a opção **Sensitive** marcada:

| Variável | Conteúdo |
|---|---|
| `INTER_CLIENT_ID` | Client ID do Inter |
| `INTER_CLIENT_SECRET` | Client Secret do Inter |
| `INTER_CERT` | Todo o conteúdo do arquivo `.crt`, aberto no Bloco de Notas |
| `INTER_KEY` | Todo o conteúdo do arquivo `.key`, aberto no Bloco de Notas |
| `INTER_CONTA` | Opcional: número da conta corrente, só se houver mais de uma conta no mesmo CNPJ |
| `EFI_CLIENT_ID` | Client ID de produção do Efí |
| `EFI_CLIENT_SECRET` | Client Secret de produção do Efí |
| `EFI_CERT_P12` | O texto gerado pelo comando do PowerShell |
| `EFI_CERT_SENHA` | Opcional: senha do certificado, se houver |

3. Em **Deployments**, abra o último deploy e clique em **Redeploy**. As variáveis só passam a valer em um novo deploy.
4. Apague do computador os arquivos baixados (ZIP, `.crt`, `.key` e `.p12`), ou guarde-os em local protegido.

## 4. No app

1. Rode `supabase/011_integracao_bancaria.sql` no Supabase. O script já liga as contas **Inter** e **Efí (Gerencianet)** às integrações.
2. Para conferir ou alterar esse vínculo, use **Cadastros > Contas > Integração bancária**.
3. Abra **Conciliação bancária** e escolha a conta. O extrato dos últimos 30 dias é buscado automaticamente, e você pode mudar o período e clicar em **Buscar** para outro intervalo de até 90 dias.
4. No Efí, a primeira busca ativa a geração diária do arquivo de extrato. O primeiro arquivo fica disponível no dia seguinte.

## Troca ou revogação

- **Suspeita de vazamento:** revogue a integração no Inter ou o certificado no Efí. O acesso é cortado na hora.
- **Para voltar a usar:** crie novas credenciais, atualize as variáveis na Vercel e faça um novo deploy.
