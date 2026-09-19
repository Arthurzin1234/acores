# Implantação dos Açores

Para hospedagem no Render, siga [RENDER.md](RENDER.md). A aplicação atende somente ao Centro Veterinário dos Açores, com contas individuais para seus operadores. Não há criação de empresas ou painel de administração externo.

## Instalação e acesso inicial
1. Use Node 24 LTS, compatível com `node:sqlite`, instale dependências com `npm ci` e execute `npm run lint`, `npm test`, `npm run security:scan`, `npm audit` e `npm run build`.
2. Configure variáveis a partir de `.env.example` no servidor ou gestor de segredos. Nunca use prefixo `VITE_` para chaves. `.env`, banco, logs, backups e `server/auth` não devem ser publicados.
3. Em uma instalação vazia, `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD` permitem criar o primeiro administrador pelo ambiente privado do servidor. A senha exige 12 caracteres e até 72 bytes; deve ser trocada no primeiro login. Essas variáveis nunca alteram usuários existentes. Sem elas, o primeiro início gera `data/admin-setup.token`, válido por uma hora. Abra esse arquivo privado localmente e informe o código na tela de criação do administrador. O código é descartado após uso; a senha escolhida não é gravada em texto puro. Para renovar antes da criação: `npm run security:admin -- bootstrap`.
4. Provisionar contas: `npm run security:admin -- create`. Recuperar senha localmente: `npm run security:admin -- reset`. Desativar conta: `npm run security:admin -- disable`. Os comandos pedem senha com entrada oculta; não passe senhas em argumentos ou histórico do terminal. O vínculo de usuário comum exige conferência da identidade e ID do tutor.
5. Revise permissões de pastas. Em Windows, `pwsh -File scripts/secure-files.ps1` limita `data` e `server/auth` ao usuário atual e SYSTEM. Verifique a conta do serviço antes de aplicar. Proteja `.env` e credenciais de backup com ACL equivalente, BitLocker e conta não administrativa do serviço.

## Segredos e rotação
- `OPENAI_API_KEY`, `GEMINI_API_KEY`: somente servidor. As variáveis têm prioridade sobre chaves legadas cifradas no SQLite. A API administrativa aceita apenas o catálogo de respostas; não recebe novas chaves.
- A chave compartilhada na conversa deve ser revogada nos controles do respectivo provedor e substituída por outra, com menor privilégio, cotas e alertas. Não foi revogada automaticamente. Não envie a nova chave por chat.
- Confirme o funcionamento da nova credencial e revogue a antiga; audite consumo e acessos. Depois remova a cópia cifrada legada por procedimento administrativo com backup e revisão. Não apague a chave local AES enquanto ainda precisar decifrar configurações antigas.
- Sem `.git` local, não há histórico para limpar aqui. Se código foi publicado em outro repositório, revogue primeiro; use scanner restrito e ferramenta como `git filter-repo` em cópia de segurança, coordene clones/forks e reescrita com os responsáveis. Remover um arquivo de um commit atual não remove seu histórico.

## Domínio e HTTPS
Produção deve usar `NODE_ENV=production`, `APP_ORIGIN=https://dominio-real`, `TRUST_PROXY=loopback`, `ENABLE_SIMULATOR=false` e `SEED_DEMO=false`. O servidor recusa origem de produção sem HTTPS; cookies recebem Secure e cabeçalho HSTS é ativado. O HTTP de desenvolvimento é permitido apenas em loopback.

Use o exemplo `deploy/Caddyfile.example` depois de configurar DNS, portas 80/443 e domínio sob seu controle. Caddy faz TLS e redireciona HTTP; Express continua em `127.0.0.1:3333`. Não exponha as portas 3333 ou 5173 na rede nem execute Vite como servidor público. Encaminhe WebSocket e cabeçalhos pelo proxy local; não confie em proxies arbitrários. Valide certificado, cadeia, renovação, redirecionamento, Secure, HSTS e conteúdo misto no domínio real. Esses itens não foram ativados nesta máquina por falta de domínio/infraestrutura fornecidos.

`WHATSAPP_AUTOSTART=true` reconecta a sessão já vinculada ao iniciar o servidor, sem gerar um QR público. O painel e suas APIs continuam exigindo autenticação. Para início automático local após entrar no Windows, execute `Instalar-Inicio-Automatico.bat`; `Remover-Inicio-Automatico.bat` remove esse início automático. O Render supervisiona o processo hospedado. Não há garantia de plantão operacional.

## Backup e monitoramento
Configure `BACKUP_ENCRYPTION_KEY` como 32 bytes aleatórios em base64 por um gestor de segredos, e `BACKUP_DIR` como pasta privada. Guarde cópia da chave fora do host, nunca junto do arquivo `.enc`.

- Criar: `npm run backup`.
- Validar restauração: `node scripts/restore-backup.mjs ARQUIVO.enc NOVO-ARQUIVO.sqlite`. O destino não pode existir; o banco ativo não é sobrescrito.
- Antes de substituir o banco em produção: pare serviço, faça backup atual, confirme integridade e autoria dos dados restaurados, reavalie dados excluídos e invalide sessões restauradas. Use restauração em ambiente isolado primeiro.
- Proteja e versione separadamente a sessão WhatsApp e as chaves legadas; preferencialmente reconecte o aparelho em vez de restaurar credenciais comprometidas.
- Agendamento de backup, retenção, cópia externa e monitor externo precisam ser configurados pela operação. Registre testes de recuperação reais antes de prometer RTO/RPO.
- Monitore `/api/health` para processo, erros de login, eventos `security_audit`, disponibilidade WhatsApp por conta autorizada, espaço em disco, certificado, execução de backup e gastos dos provedores. Saúde HTTP não comprova funcionamento do WhatsApp ou da IA. Não registre corpos, cookies, QR, tokens ou senhas no proxy/monitor.

## Checklist de liberação
- [ ] Administrador criado, contas individuais provisionadas, usuários antigos desativados.
- [ ] Chaves expostas revogadas e novas chaves configuradas sem prefixo público.
- [ ] Domínio e TLS testados externamente; portas internas fechadas.
- [ ] ACLs, disco cifrado, conta do serviço e cópias externas revisados.
- [ ] Backup cifrado e restauração testados; retenção e responsáveis definidos.
- [ ] Identidade jurídica, canal de privacidade, bases legais, contratos dos provedores e prazos de retenção validados.
- [ ] MFA/SSO e proteção distribuída planejados antes de acesso administrativo externo amplo.
- [ ] Testes com WhatsApp de homologação: pausas, grupos, arquivos, cadastro, emergências e reconexão.
- [ ] Testes automatizados, lint, audit e scanner sem achados não tratados.
- [ ] Dependabot ativado somente quando houver GitHub; atualizações sem automerge e com testes.
- [ ] Capacidade, paginação histórica e alertas de uso validados para o volume real.
- [ ] Apenas uma instância, banco e sessão de WhatsApp no disco persistente; teste de reinício e espaço disponível confirmado.
