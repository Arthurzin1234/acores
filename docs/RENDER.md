# Acores no Render

## Antes de publicar

Esta preparacao nao cria servicos nem contrata recursos no Render.
O Blueprint usa um Web Service Node pago, plano `1c-2g`, e disco de 1 GB.
Confira o custo no painel antes de confirmar. Nao use plano gratuito:
SQLite, fila, chaves e sessao precisam sobreviver a reinicios e deploys.

Fontes: [discos persistentes](https://render.com/docs/disks),
[Blueprint](https://render.com/docs/blueprint-spec),
[servicos web](https://render.com/docs/web-services).

## Publicacao

1. Publique o codigo em um repositorio Git privado. Use o pacote gerado por
   `powershell -File scripts/package-render.ps1` ou respeite rigorosamente
   `.gitignore`. Nunca envie `data`, `server/auth`, `.env`, arquivos de banco,
   backups, chaves ou logs. O ZIP e codigo-fonte, nao backup de clientes.
2. No Render, escolha **New > Blueprint**, conecte o repositorio e confirme
   `render.yaml`. Preencha `INITIAL_ADMIN_PASSWORD` com uma senha provisoria
   forte e `GEMINI_API_KEY` com uma chave nova no campo privado do Render.
   O e-mail inicial sera `acores@gmail.com` e o usuario `acores`.
3. Confirme o disco em `/var/data/acores` e publique. O build executa
   `npm ci --include=dev && npm run build`; a inicializacao executa `npm start`.
4. Abra a URL HTTPS fornecida pelo Render, aceite os documentos e troque a senha.
   Conecte o WhatsApp em **Configuracoes** somente depois de parar a instancia
   local vinculada ao mesmo numero.
5. Confira **Status do atendimento** e teste com um numero de homologacao.
   Valide recepcao, pausa por humano, emergencia, fila, reconexao e reinicio
   antes de direcionar clientes reais.

Sem restauracao, o Render comeca com um banco vazio. Os dados locais nao sao
transferidos automaticamente. Para continuar os cadastros atuais, execute a
migracao abaixo durante uma janela sem atendimento automatizado.

## Ambiente e persistencia

| Variavel | Configuracao |
| --- | --- |
| NODE_ENV | production |
| BIND_HOST | 0.0.0.0 |
| PORT | Fornecida pelo Render |
| TRUST_PROXY | 1, para o proxy de entrada do Render |
| APP_ORIGIN | Opcional; padrao RENDER_EXTERNAL_URL |
| DATA_DIR | /var/data/acores/data |
| WHATSAPP_AUTH_DIR | /var/data/acores/whatsapp |
| PERSISTENT_ROOT | /var/data/acores |
| AI_PROVIDER | gemini, openai ou rules |
| GEMINI_API_KEY / OPENAI_API_KEY | Somente ambiente privado do servidor |
| GEMINI_MODEL / OPENAI_MODEL | Opcionais; usam os modelos padrao do projeto |
| INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD | Apenas criacao em banco vazio |
| ADMIN_ALERT_WEBHOOK_URL | Opcional, endpoint HTTPS da administracao |

Para OpenAI, troque `AI_PROVIDER` para `openai` e configure `OPENAI_API_KEY`.
Sem chave valida, o sistema transfere novos atendimentos para um humano.
Nao use prefixo `VITE_` para qualquer segredo.

Para dominio proprio, configure-o no Render e ajuste `APP_ORIGIN` para a URL
HTTPS exata, sem barra final ou caminho. Cookies sao Secure, HttpOnly e
SameSite=Strict; API e WebSocket usam a mesma origem do site.

Node 24 LTS e fixado por `engines` em `package.json`. Execute apenas uma
instancia: nao use cluster, replicas, outro worker WhatsApp ou autoscaling
sobre este banco/sessao. O disco nao esta disponivel durante o build, por isso
o servidor cria/migra o banco somente na inicializacao.

O Blueprint deixa deploy automatico desligado. Faca deploy manual depois de
testar mudancas e verificar backups. Com disco persistente, deploys podem ter
uma breve interrupcao; nao ha promessa de zero downtime.

## Migrar dados existentes

1. Desative o inicio local com `Remover-Inicio-Automatico.bat` e pare API e
   supervisor locais. Confirme que nao ha processo escrevendo no banco ou
   utilizando a sessao. Nao execute o mesmo WhatsApp em dois servidores.
2. Gere e verifique um backup consistente, cifrado, do banco com o procedimento
   de [DEPLOYMENT.md](DEPLOYMENT.md). O backup SQLite nao inclui credenciais.
   Preserve separadamente `data/ai-encryption.key`, `data/whatsapp-spool`
   (inclusive sua chave) e a pasta completa `server/auth`, se for reutilizar
   a sessao. Todas essas copias sao privadas e exigem transporte protegido.
3. Planeje uma janela com a aplicacao de destino parada e acesso ao disco pelo
   mecanismo disponibilizado pelo Render. Transfira por SSH/SCP ou outro canal
   autenticado e cifrado suportado pelo servico, nunca pelo repositorio.
4. Restaure o banco como `/var/data/acores/data/petbot.sqlite` somente depois
   de preservar qualquer base existente no destino. Nunca sobrescreva um SQLite
   aberto. Copie a chave legada de IA ao mesmo diretorio e o spool para
   `/var/data/acores/data/whatsapp-spool`. A sessao completa, incluindo
   `storage.key`, fica em `/var/data/acores/whatsapp`.
5. Revogue sessoes de login restauradas e confira integridade, quantidade de
   pacientes e fila antes de iniciar. A senha ja existente e preservada;
   `INITIAL_ADMIN_PASSWORD` nao a substitui. Remova as variaveis iniciais
   do ambiente depois de confirmar o acesso.
6. Reinicie somente o Render e confira a conexao. Sessao comprovadamente
   invalida exige novo QR autenticado; nao apague arquivos para forcar
   reconexao. Envios incertos vao para conferencia, nao reenvio cego.

Dados de antigas empresas/administracao fora do banco dos Acores nao sao
carregados nem incluidos no pacote de publicacao.

## Monitoramento e recuperacao

`/api/health` e publico e devolve apenas saude do armazenamento/processo:
200 para gravacao bem-sucedida e 503 para falha. Nao revela clientes, QR ou
chaves. Nao reinicia o processo apenas porque WhatsApp ou IA estao offline.
Esses estados detalhados ficam no painel autenticado.

O Render supervisiona o processo. No encerramento por SIGTERM, a aplicacao
interrompe o conector, aguarda operacoes ativas e fecha o banco. Mensagens
recebidas e respostas pendentes permanecem na fila duravel.

O webhook opcional recebe apenas servico, codigo de ocorrencia e horario,
com timeout e intervalo minimo entre avisos iguais. Sem endpoint configurado
nao ha notificacao externa. Configure tambem alertas de disponibilidade do
proprio Render, pois o processo parado nao consegue emitir seu proprio aviso.

Disco persistente nao substitui backup externo. Configure retencao, copia
cifrada fora do servico e testes de restauracao. Monitore ocupacao do disco,
memoria e custos de IA. Antes de entrar em producao, revise documentos legais,
fornecedores, regiao de hospedagem e politica de privacidade com o responsavel.
