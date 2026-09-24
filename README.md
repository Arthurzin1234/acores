# Central dos Acores

Aplicacao exclusiva do Centro Veterinario dos Acores: atendimento WhatsApp,
recepcao humana, pacientes, agenda, cirurgias, checklist e neonatos.

## Deploy

Para subir o painel no Vercel e preparar Supabase, leia
[VERCEL-SUPABASE.md](docs/VERCEL-SUPABASE.md). O painel Vite pode ir para o
Vercel como site estatico, mas o WhatsApp/Baileys precisa de um worker Node
persistente. O arquivo `render.yaml` continua disponivel como opcao economica
para esse worker persistente; veja [RENDER.md](docs/RENDER.md).

Banco, chaves, conversas e sessao WhatsApp nao fazem parte do codigo nem do
pacote de publicacao.

## Supabase PostgreSQL

O backend seleciona o armazenamento PostgreSQL quando `SUPABASE_DB_URL` está
configurada. Execute `npm run verify:postgres` para criar/verificar o schema e
`npm run migrate:postgres` para importar o SQLite existente de forma idempotente.
Depois da importação, reinicie o serviço: as tabelas clínicas, autenticação,
configurações de IA, notificações e filas passam a usar o Supabase. O URL direto
do Postgres, `SUPABASE_SERVICE_ROLE_KEY` e `AI_ENCRYPTION_KEY` são segredos do
servidor e não devem ser colocados no Vercel como variáveis `VITE_*`.

Variáveis mínimas no Render: `SUPABASE_DB_URL`, `INITIAL_ADMIN_EMAIL`,
`INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_USERNAME`, `APP_ORIGIN` e as chaves da
IA escolhida. `SUPABASE_URL` e `SUPABASE_ANON_KEY` podem continuar configuradas
para integrações, mas o backend usa a conexão direta `SUPABASE_DB_URL`.

## Desenvolvimento local

Use Node 24 LTS:

```sh
npm ci
npm run dev
```

Abra http://127.0.0.1:5173. Para usar a compilacao local:

```sh
npm run build
```

Depois execute `START.bat`. Ele inicia API e site sem duplicar processos.
`Instalar-Inicio-Automatico.bat` instala o inicio apos login no Windows.
Desative esse inicio local antes de vincular o mesmo WhatsApp ao Render.

## Acesso

Na instalacao local existente, e-mail `acores@gmail.com` ou usuario `acores`,
com a senha ja cadastrada. Nenhuma senha existente e redefinida automaticamente.

Em um banco novo, configure `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD`
privadamente no servidor. A senha deve ter 10 caracteres ou mais, ate 72 bytes.
O primeiro login exige apenas o aceite dos documentos; a senha existente nao e
redefinida automaticamente. Sem essas variaveis, existe instalacao com token
privado de uso unico.
Outros acessos da clinica sao criados pelo administrador em **Acessos**.

## Verificacao

```sh
npm run lint
npm test
npm run build
npm run security:scan
npm audit --omit=dev
```

Testes usam bases temporarias, nao os clientes reais. Incluem pausas por humano,
grupos e arquivados, indisponibilidade da IA, fila duravel, quedas, reinicios,
permissoes e configuracao de producao.

Documentos: [seguranca e backup](docs/DEPLOYMENT.md),
[operacao do WhatsApp](docs/WHATSAPP-OPERATIONS.md),
[Vercel + Supabase](docs/VERCEL-SUPABASE.md).
