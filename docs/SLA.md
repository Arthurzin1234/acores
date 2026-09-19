# SLA e plano operacional

Minuta para negociação e revisão jurídica, 12/09/2026. **Não há SLA contratado ou equipe técnica escalada verificados.** Metas abaixo são propostas para aprovação, não promessas já suportadas pela instalação.

## Escopo e disponibilidade
Inclui painel, banco local, conexão WhatsApp via Baileys, classificação por IA e encaminhamento humano. A instalação atual depende de um computador Windows, processos locais, energia e internet. Não há redundância, monitor externo nem medição histórica comprovados. Portanto, **não se assume 99,5% ou 99,9% de disponibilidade**. Uma meta só poderá ser contratada após definição de hospedagem, suporte e medições.

Disponibilidade mensal futura: minutos disponíveis divididos pelos minutos totais do mês, com as exclusões expressamente acordadas. Falhas devem ser registradas por monitor externo. O funcionamento da clínica 24 horas não implica plantão de suporte do software.

## Suporte e severidades
Canais e horários de suporte técnico: **pendentes de definição pelo responsável**. Recepção física: endereço cadastrado da clínica. E-mail, telefone de suporte e escalonamento não foram inventados.

| Severidade | Exemplo | Primeira resposta proposta | Prazo-alvo proposto |
| --- | --- | --- | --- |
| Crítico | Vazamento ou paralisação completa | 30 minutos em cobertura contratada | Contenção em 4 horas; solução após diagnóstico |
| Alto | WhatsApp indisponível ou falha relevante de cadastro | 2 horas em cobertura contratada | 1 dia útil |
| Médio | Função secundária degradada | 1 dia útil | 5 dias úteis |
| Baixo | Ajuste visual ou melhoria sem interrupção | 2 dias úteis | Próxima versão planejada |

Os prazos só começam após recebimento por canal acordado, dependem de cobertura contratada e não substituem obrigações legais. Contenção não equivale a correção definitiva. A empresa deve designar responsáveis e capacidade antes de aprovar a tabela.

## Manutenção, exclusões e incidentes
Proposta: manutenção em janela acordada, aviso com 48 horas para intervenções planejadas; janela concreta a definir. Alterações urgentes de segurança podem exigir aviso imediato. Falhas de terceiros, internet/energia do cliente, uso indevido, força maior e eventos fora do controle razoável devem ser tratados no contrato sem excluir responsabilidades legalmente impostas.

Procedimento: registrar horário/impacto sem copiar segredos; interromper acesso comprometido; preservar evidências; comunicar responsável da empresa; atualizar usuários afetados por canal aprovado; avaliar obrigações legais com assessoria; registrar causa, correção e prevenção. Não há automação de comunicação ou página de status pública configurada.

## Backup e recuperação reais
Foi criado um snapshot consistente local antes da intervenção. Foram adicionados comandos de backup SQLite criptografado e restauração em arquivo novo, com teste automatizado de integridade e chave incorreta. **Não há agendamento recorrente, cópia externa, retenção automática ou responsável operacional configurado.** O backup do banco não inclui automaticamente a sessão `server/auth`, `.env` nem chave de cifragem legada da IA.

RPO/RTO ainda não são garantidos. Proposta após implantação: backup diário, cópia externa cifrada, teste mensal de restauração e RPO de 24 horas; RTO a medir antes de contratar. A chave de backup deve ficar separada do servidor. Uma cópia no mesmo disco não protege contra perda do computador.
