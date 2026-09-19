# Relatório de segurança

Data: 12/09/2026. Escopo: código local da central Açores em React/Vite, Express, SQLite, WebSocket, Baileys e provedores de IA. Não é certificação, pentest externo ou declaração de segurança absoluta.

## Diagnóstico antes das alterações

| Prioridade | Risco e impacto | Local encontrado | Correção | Verificação |
| --- | --- | --- | --- | --- |
| Crítico | APIs sem identidade: leitura, edição e exclusão de dados por qualquer processo com acesso à porta | `server/index.js`, `server/deletions.js` | Sessões obrigatórias, RBAC e propriedade do cadastro no servidor | `tests/security.test.mjs`: visitante 401, usuário cruzado 404/403, atendente sem exclusão |
| Crítico | WebSocket sem autenticação/origem: exposição contínua do dashboard | `server/index.js` | Upgrade autenticado, origem exata, visão por função, revogação e até 5 conexões por conta | Testes reais de handshake sem cookie e leitura limitada ao próprio tutor |
| Alto | Ausência de RLS/isolamento entre titulares | SQLite e rotas de consulta | Política de acesso por registro no servidor, vínculo de usuário a `client_id` feito por operador local confiável | Leitura, alteração, exclusão e WebSocket com duas contas independentes |
| Alto | Chave de IA compartilhada na conversa; possibilidade de uso indevido e custos | Histórico desta conversa, fora do Git | Variáveis de ambiente no servidor têm prioridade; HTTP não aceita chaves ou modelos; chave legada segue cifrada e não foi apagada | Testes de não exposição, scanner; **revogação externa ainda obrigatória** |
| Alto | Sem sessão, cookies ou CSRF | Todas as alterações via API | Cookie HttpOnly, SameSite=Strict, Secure em produção, token CSRF e Origin; sessão aleatória com hash no banco | Login, logout, expiração, desativação, CSRF inválido |
| Alto | Campos extras, IDs e tipos inconsistentes | Rotas CRUD | Esquemas estritos com Zod; campos permitidos por rota/função; SQL parametrizado | Mass assignment, IDOR, formatos maliciosos e payload grande |
| Médio | Força bruta, abuso de IA e exclusões em massa | Rotas de autenticação e APIs | Limites por IP, conta, sessão e rotas sensíveis, respostas 429 | Tentativas repetidas de login |
| Médio | Sem CSP, HSTS ou proteção de enquadramento | Respostas HTTP | Helmet, CSP, frame-ancestors, no-sniff, Permissions-Policy, no-store; produção exige origem HTTPS | Cabeçalhos locais e validação de configuração; TLS externo pendente |
| Médio | Erros internos, logs técnicos e caminhos de arquivos | Express, Baileys | Erros genéricos; auditoria sem corpo/senha/token; logger de protocolo silencioso; bloqueio de caminhos privados | Testes e scanner redigido |
| Médio | Simulador disponível mesmo removido da interface | `/api/simulate-message` | Desabilitado por padrão e sempre em produção; só administrador no ambiente de testes autorizado | Rota retorna 403 |
| Médio | `.env.*`, backups e variantes de arquivos privados sem exclusões amplas | `.gitignore` | Padrões ampliados e proteção de ACL fornecida | Scanner de fonte, build, logs e variáveis públicas |
| Baixo | Ausência de processo verificável de manutenção | Scripts e documentação | Lint, testes, scanner, auditoria npm, atualização semanal proposta e checklist | Comandos documentados e executados |

## Matriz de acesso e RLS

- Usuário: somente o cadastro do tutor vinculado e suas conversas/agendamentos/acompanhamentos; edição limitada do próprio cadastro, sem alterar telefone/vínculo. Sem acesso a notificações internas, resumos de IA, credenciais ou configurações.
- Atendente: dados clínicos e operação da clínica única; não exclui registros, não configura IA nem administra contas.
- Técnico: diagnóstico/conexão WhatsApp e teste de integração; não recebe dados clínicos no dashboard. QR de vinculação é sensível e restrito a técnico/administrador.
- Administrador: operação e configurações; exclusões exigem confirmação e CSRF. Contas são provisionadas/recuperadas pelo utilitário local, não por cadastro público.

SQLite não oferece `ENABLE ROW LEVEL SECURITY`, papéis SQL e políticas de PostgreSQL. **Não foi ativado RLS nativo.** Há controle compensatório em `server/security.js`, aplicado a HTTP e WebSocket. Acesso direto ao arquivo SQLite por administrador do sistema operacional contorna esse controle. `clients` e `tickets` têm propriedade por tutor; `appointments` e `neonatal_care` são filtrados pelo mesmo vínculo; `notifications` e `checklist_items` são internos; tabelas de autenticação, sessões, auditoria, IA e Baileys não têm rotas de leitura pública. Atendentes e administradores compartilham dados da mesma empresa por necessidade funcional. Não existe isolamento multiempresa. RLS nativo exige migração planejada para PostgreSQL antes de oferecer multiempresa ou acesso direto ao banco.

## Integrações

**WhatsApp:** Baileys usa sessão de aparelho vinculado, não a API oficial do WhatsApp Business. A pasta `server/auth` equivale a uma credencial de acesso e não pode ser publicada. Persistem bloqueios de grupos/arquivadas, debounce e pausa humana. Há riscos de desconexão, mudança de protocolo e políticas do fornecedor. Histórico já copiado para backups antigos deve receber a mesma proteção do banco.

**IA:** chamadas saem apenas do servidor para endpoints fixos HTTPS da OpenAI/Google. A resposta é montada com modelos de texto e catálogo aprovado, sem texto livre irrestrito do provedor. O provedor recebe mensagem atual e parte do histórico; ainda pode conter nomes e informações pessoais. Isso exige decisão/documentação da empresa sobre finalidade, minimização, transferência internacional e termos contratuais. Não há promessa de anonimização total nem controle sobre a retenção dos fornecedores. A credencial compartilhada no chat deve ser substituída e revogada pelo titular da conta; este agente não consegue revogar nem limpar o histórico do provedor.

**Banco:** SQLite local não usa chave pública/service role de serviço hospedado. Dados clínicos ficam em texto legível no arquivo protegido pelo sistema operacional; senhas usam bcrypt custo 12; tokens de sessão são armazenados como hash; chaves legadas da IA usam AES-256-GCM. Disco cifrado/SQLCipher/SEE não foram ativados nesta tarefa.

**Uploads:** não existe fluxo de upload de arquivos pelo site. Multipart é rejeitado com 415, corpo JSON limitado a 64 KiB; não se criou armazenamento público, conversor ou antivírus fictício. Mídia no WhatsApp não é executada nem recebida como upload no site. Qualquer implementação futura exige allowlist, assinatura MIME, armazenamento privado, antivírus e autorização de download.

**Pagamentos:** não foram encontrados pagamentos, cobrança ou armazenamento de cartões. Nenhuma conformidade PCI é afirmada.

## Resultado e limitações

Verificação final local: `npm run lint` aprovado; `npm test` com 32 testes aprovados; `npm run build` aprovado; `npm run security:scan` sem achados heurísticos; `npm audit --json` com 0 vulnerabilidades conhecidas reportadas. Os cenários incluem backup/restauração, cabeçalhos/cookies de produção sob proxy simulado, acesso anônimo e por funções, duas contas de titulares, WebSocket, validação, CSRF e rate limit. Não foram usados clientes reais para ataques, exclusões ou mensagens de teste.

Após ativação local: `/api/dashboard` sem sessão retornou 401; `/api/auth/session` indicou necessidade de criação do primeiro administrador. ACLs de `data` e `server/auth` foram aplicadas para a conta atual do Windows e SYSTEM; permissões herdadas de um arquivo de log foram verificadas e leitura local continuou funcionando. A primeira conta não foi criada pelo agente, nem uma senha padrão foi definida. Código de instalação em arquivo privado expira em uma hora.

O primeiro `npm audit` não apontou CVEs conhecidos; isso não prova ausência de vulnerabilidades. `npm outdated` encontrou novas versões principais de Vite, plugin React, lucide, concurrently e pino, sem CVE reportado no conjunto instalado. Não foram aplicadas migrações principais sem testes. Baileys continua versão de pré-lançamento; revisar antes de operação crítica. Lockfile é mantido e `npm ci` é o caminho de implantação.

O scanner local é heurístico, mostra somente nomes de arquivos/variáveis e não prova ausência de segredos. Não existe `.git` neste diretório: histórico Git não pôde ser examinado nem reescrito. Uma ocorrência do scanner era a credencial fictícia do teste e foi renomeada, não ignorada globalmente.

Riscos externos pendentes: domínio/DNS/certificado TLS e firewall; MFA/SSO para acesso administrativo externo; rotação/revogação das chaves expostas; chave de backup fora do host; criptografia de disco; política definitiva de retenção; operação de monitoramento; revisão jurídica; homologação com aparelho WhatsApp real depois das mudanças. Limites são locais em memória por processo, não distribuídos. Os testes não enviam mensagens para clientes reais.

O dashboard transmite no máximo 200 registros por coleção; listagens HTTP aceitam `limit` até 200 e `offset` até 100000. A interface operacional existente ainda usa a visão resumida; navegação completa de arquivos históricos volumosos e paginação das coleções clínicas precisam de evolução antes de grande volume. Consultas internas ainda podem carregar coleções inteiras do SQLite; testar carga e limites de armazenamento.

## Fontes de referência

- [LGPD, texto compilado oficial](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).
- [OWASP: autenticação](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) e [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- [SQLite Encryption Extension](https://www.sqlite.org/see/doc/trunk/www/readme.wiki), alternativa que não foi instalada.
