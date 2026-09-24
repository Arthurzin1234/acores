# Acores no Vercel + Supabase

## Arquitetura recomendada

O Vercel hospeda o painel React/Vite como frontend estatico. O Supabase recebe
o Postgres preparado para a migracao. O conector WhatsApp com Baileys, a fila,
o WebSocket e as chamadas de IA continuam em um worker Node persistente.

Essa separacao evita colocar o bot dentro de funcoes curtas. O painel funciona
mesmo sem WebSocket: quando a conexao ao canal ao vivo falha, ele passa a
atualizar por polling a cada 15 segundos.

Fontes oficiais usadas para a preparacao:

- Vercel documenta Vite como build de frontend com saida estatica `dist` e
  variaveis `VITE_*` expostas ao cliente:
  <https://vercel.com/docs/frameworks/frontend/vite>
- Vercel aplica build command e output directory configuraveis:
  <https://vercel.com/docs/builds>
- Supabase diferencia chaves publicas e chaves secretas/servidor:
  <https://supabase.com/docs/guides/getting-started/api-keys>
- Supabase oferece conexao Postgres direta e pooler:
  <https://supabase.com/docs/guides/database/connecting-to-postgres>

## O que ja ficou pronto

- `vercel.json` com preset Vite, build `npm run build`, output `dist`,
  SPA fallback para `index.html` e cabecalhos basicos.
- `src/App.jsx` com fallback de atualizacao quando WebSocket nao abre.
- `src/api.js` preparado para `VITE_API_URL`, embora o caminho recomendado seja
  usar rewrites e manter `/api` na mesma origem do painel.
- `supabase/schema.sql` com as tabelas, relacionamentos, índices e RLS do sistema.
- Adaptador PostgreSQL em `server/postgres-*.js`; quando `SUPABASE_DB_URL` existe,
  o backend usa o Supabase como fonte de verdade em vez do SQLite.
- `scripts/migrate-sqlite-to-postgres.mjs` idempotente para importar o SQLite.
- `.env.example` com variaveis de Vercel/Supabase.
- `scripts/package-vercel.ps1` para gerar ZIP de codigo sem `data`, `.env`,
  bancos, chaves, logs ou sessao do WhatsApp.

## Configurar Supabase

1. Crie um projeto Supabase novo.
2. No SQL Editor, rode `supabase/schema.sql`.
3. Guarde:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_DB_URL`
4. A chave `anon` pode ser usada pelo navegador somente para recursos publicos.
   Neste painel, ela nao deve acessar tabelas diretamente.
5. A chave `service_role` fica apenas no worker Node persistente. Nunca use
   `VITE_SUPABASE_SERVICE_ROLE_KEY` nem coloque essa chave no Vercel como
   variavel exposta ao cliente. Mantenha `AI_ENCRYPTION_KEY` e
   `WHATSAPP_AUTH_ENCRYPTION_KEY` somente no worker do Render e estáveis entre
   deploys.

O schema ativa RLS nas tabelas principais sem politicas permissivas. Isso e
intencional: o painel atual conversa com a API do worker, e a API aplica as
permissoes ja existentes. O worker usa a chave de conexao PostgreSQL no servidor;
o navegador nao acessa o banco diretamente. O schema tambem ativa RLS em todas
as tabelas publicas internas, sem politicas anon permissivas, incluindo sessoes,
filas, memoria, configuracoes da IA e credenciais criptografadas do WhatsApp.

## Configurar Vercel

1. Suba o codigo para um repositorio privado.
2. No Vercel, importe o projeto como Vite.
3. Use:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm ci`
4. Antes do deploy final, edite `vercel.json` e troque:
   `https://SEU-WORKER-PERSISTENTE.example.com`
   pela URL HTTPS real do worker Node persistente.
5. Deixe `VITE_API_URL` e `VITE_WS_URL` vazios se estiver usando os rewrites
   de `/api` e `/ws`. Assim os cookies continuam na mesma origem do painel.

Se voce preferir usar `VITE_API_URL` apontando para outro dominio, sera
necessario revisar CORS e cookies `SameSite`, porque autenticacao por cookie
entre dominios e mais delicada. O caminho mais simples e economico e manter
o painel chamando `/api` e deixar o Vercel encaminhar para o worker.

## Worker persistente

O worker pode continuar no Render por enquanto, ou ir para outro servico que
rode Node continuamente. Ele precisa:

- manter a sessao do WhatsApp fora do Vercel;
- ter `APP_ORIGIN` apontando para a URL final do painel no Vercel;
- receber `SUPABASE_DB_URL` somente no servidor;
- manter segredos de IA apenas no servidor;
- suportar WebSocket em `/ws`, ou aceitar que o painel use polling.

O worker nao depende de um Disk do Render para pacientes, agenda, autenticação,
fila ou sessão do WhatsApp: esses dados ficam no Supabase. O processo Node ainda
precisa ser um serviço persistente para manter Baileys, WebSocket e reconexão.

## Pacote seguro

Para gerar o pacote para repositorio/Vercel:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-vercel.ps1
```

O ZIP sai em `release/acores-vercel-supabase-*.zip`.
Ele inclui codigo, docs, `vercel.json` e `supabase/schema.sql`; nao inclui
`data`, bancos, chaves, logs, `.env`, backups ou sessao do WhatsApp.

## Ordem pratica

1. Rodar testes locais.
2. Criar Supabase e executar `supabase/schema.sql`.
3. Com `SUPABASE_DB_URL` configurada e o SQLite disponível, executar:
   `npm run migrate:postgres`.
4. Publicar o worker persistente com `SUPABASE_DB_URL` e as variáveis de IA.
5. Editar `vercel.json` com a URL real do worker.
6. Subir o painel no Vercel.
7. Entrar, conectar WhatsApp e testar com numero
   de homologacao.

Nao rode o mesmo numero de WhatsApp em dois ambientes ao mesmo tempo.
