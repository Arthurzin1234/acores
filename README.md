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
privadamente no servidor. A senha provisoria deve ter 12 caracteres ou mais,
ate 72 bytes. O primeiro login exige aceite dos documentos e troca de senha.
Sem essas variaveis, existe instalacao com token privado de uso unico.
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
