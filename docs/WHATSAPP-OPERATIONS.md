# Conexão, Fila e Recuperação

## Operação

- Inicie com `npm run start:supervised`. O supervisor observa o processo da API e o arquivo privado de saúde. O comando `npm run server` continua disponível, mas não reinicia um processo encerrado.
- Ao iniciar, a API restaura a sessão salva, exceto se `WHATSAPP_AUTOSTART=false` ou houver intervenção pendente. As tentativas e os motivos de parada sobrevivem ao reinício.
- O menu **Status do atendimento**, restrito a administrador e técnico, mostra conexão, IA, fila, banco, memória, credenciais, último erro e última reconexão. O técnico não recebe contatos ou contexto clínico nessa tela.
- Os termos e a política de privacidade ficam disponíveis antes de entrar. O aceite explícito é validado pelo servidor e registrado por usuário e versão. Os documentos atuais ainda são minutas para revisão jurídica.

## Sessão Protegida

A sessão e as chaves Signal são gravadas em `server/auth/session.sqlite`, com transações SQLite, `synchronous=FULL` e valores criptografados com AES-256-GCM. A chave fica separada em `server/auth/storage.key`, sob as permissões privadas do diretório. Não é proteção contra comprometimento da própria conta do Windows ou de um administrador do sistema.

A primeira execução importa integralmente a sessão legada em uma transação. Arquivos ilegíveis interrompem a importação: não são convertidos silenciosamente em uma sessão nova. Os arquivos legados permanecem preservados, sujeitos às ACLs privadas já aplicadas. Não há exclusão automática de credenciais.

Logout (401) e sessão inválida (500) suspendem reconexões e exigem ação **Gerar novo QR Code**, com confirmação. Essa ação inicia outra geração de credenciais e preserva a anterior. Acesso recusado (403), conexão substituída (440) e incompatibilidade (411) exigem intervenção, não limpeza automática. Os códigos são os da versão instalada do Baileys.

A serialização preserva buffers usando `BufferJSON`, conforme a [documentação de sessões do Baileys](https://github.com/WhiskeySockets/docs/blob/main/authentication/session-management.mdx). A implementação local usa armazenamento transacional próprio em vez do exemplo baseado em múltiplos arquivos.

## Filas e Idempotência

1. Mensagens são persistidas antes da espera de cinco segundos. Digitação estende a espera para dez segundos. Grupos, broadcasts e canais não entram no processamento.
2. O recebimento usa identificador de mensagem e conta para deduplicação. O lote recebe uma identidade persistente e mantém a ordem por conversa. Mensagens recebidas antes do reinício não são descartadas pela idade.
3. Cadastro, chamado, mensagens, notificação, conclusão do lote e resposta pendente são confirmados na mesma transação do banco principal. A IA não é chamada dentro de uma transação aberta.
4. Se SQLite falhar ao receber uma mensagem, um arquivo de contingência criptografado e sincronizado em disco a preserva. A conexão para de processar até a recuperação segura. Falha simultânea do banco e do disco exige intervenção: nenhum software pode garantir persistência quando não há armazenamento gravável.
5. Após reconectar, a fila só avança depois de confirmar o estado de arquivamento. Mensagens humanas recebidas durante a desconexão são recuperadas antes das respostas automáticas.
6. Cada resposta tem um ID de envio estável. Quando o transporte confirma o envio, o histórico é registrado apenas uma vez. Confirmações ou ecos posteriores também reconciliam esse ID.
7. Um processo que morre durante um envio deixa uma situação ambígua: o WhatsApp pode ter recebido a mensagem sem o banco registrar a confirmação. Esse envio fica **para conferência**, bloqueando envios posteriores daquela conversa. Não há reenvio automático nesse estado. O administrador confere no WhatsApp e marca **Já foi enviada** ou **Cancelar envio**.

Não se promete entrega exatamente uma vez na rede: o Baileys não oferece uma transação distribuída com SQLite. A política escolhida impede reenvios cegos, preserva o item para conferência e torna a incerteza visível. "Enviado" significa confirmação do transporte, não leitura pelo cliente.

## IA Indisponível

Timeout padrão: 12 segundos, incluindo a espera da resposta. Falhas temporárias abrem uma pausa de 30 segundos no acesso ao provedor. Falhas de credenciais, permissões, configuração ou resposta inválida não são repetidas automaticamente; **Verificar assistente** permite uma tentativa explícita após corrigir a causa. As sondagens usam uma saudação fixa, sem dados de clientes, no máximo a cada cinco minutos quando não há uso recente. Podem gerar cobrança do provedor.

O bot envia uma vez: “Olá! No momento vou chamar um atendente humano para continuar seu atendimento 😉”. O chamado contém o contato, horário, histórico necessário e motivo **IA indisponível**; a recepção recebe uma notificação. A conversa fica com a IA pausada. A recuperação do provedor não remove essa pausa. O atendente deve reativá-la explicitamente no site.

## Limites e Alertas

Os valores configuráveis estão em `.env.example`. Reconexões usam 2, 5, 10 e 30 segundos, com variação de 20%, limitadas por `WHATSAPP_MAX_RECONNECTS` (padrão 6). Uma conexão que permanece estável por um minuto zera o contador. O supervisor limita reinícios do processo separadamente, com estabilidade mínima de cinco minutos.

Health checks rodam a cada 30 segundos: processo, conexão, sincronização, leitura/escrita no banco, estado da IA, fila, memória, erros repetidos e configuração. Segredos, QR Codes, mensagens e números de clientes não entram nos logs estruturados ou no arquivo de saúde.

Alertas internos são deduplicados no painel. Para alertas fora do site, configure `ADMIN_ALERT_WEBHOOK_URL` com um endpoint HTTPS sob controle da administração e execute o supervisor. O webhook recebe apenas nome do serviço, código de ocorrência e horário. Sem esse destino, não há envio de e-mail, SMS ou mensagem externa. Falhas no próprio canal não provocam tentativas ilimitadas.

Se o computador, a internet inteira ou o supervisor desligarem, é necessário monitoramento externo independente. O supervisor local não liga o Windows nem mantém um computador suspenso acessível. Configure a inicialização automática e a hospedagem adequada antes de oferecer atendimento contínuo.

## Testes e Recuperação Manual

Execute `npm test`, `npm run lint`, `npm run build`, `npm run security:scan` e `npm audit --omit=dev`.

Os testes encerram processos reais em quatro momentos: recebimento, transação não confirmada, transação concluída e envio iniciado. Também simulam conexão instável, SQLite indisponível, timeout da IA, credenciais recusadas, sessão inválida, fila offline, intervenção humana e arquivamento. Nenhuma simulação envia mensagens a clientes reais ou invalida a sessão real.

O backup do banco principal inclui as filas. A sessão criptografada e sua chave separada também precisam de backup privado consistente; a rotina `npm run backup` do banco principal não inclui automaticamente `server/auth`. Não misture uma sessão antiga com chaves de outra geração. Conserve cópias seguras antes de qualquer restauração.
