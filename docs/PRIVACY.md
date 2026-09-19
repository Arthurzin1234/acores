# Política de Privacidade

## Responsável

Esta central é operada exclusivamente pelo Centro Veterinário dos Açores, R. Raul Cabral de Menezes, 467 - Centro, Viamão - RS, 94415-610.

A empresa responsável pelo tratamento dos dados deverá disponibilizar canais adequados para atendimento de solicitações relacionadas à privacidade e aos direitos dos titulares. Enquanto esses canais não forem definidos, pedidos relativos a essa central poderão ser apresentados à recepção no endereço indicado, com confirmação de identidade proporcional ao pedido.

## Dados e finalidade

Coletamos nome e telefone do tutor, e-mail quando fornecido, mensagens de atendimento, nome, espécie, raça, idade e peso do pet quando informados, observações, agendamentos, chamados e acompanhamentos.

Para acesso ao painel, tratamos e-mail, função, vínculo de cadastro, hash de senha e sessão. A auditoria registra identificador de usuário, ação, recurso e horário, sem conteúdo de mensagens ou senha. O endereço IP é utilizado temporariamente pelo limitador de requisições em memória.

Esses dados são utilizados para atender solicitações, organizar a recepção, manter cadastros, encaminhar casos aos profissionais responsáveis, realizar agendamentos, acompanhar atendimentos e proteger a plataforma.

Informações sobre animais podem identificar seus tutores quando vinculadas a eles. Recomenda-se que não sejam enviados dados pessoais sensíveis que não sejam necessários para o atendimento.

No acesso ao painel, registramos a confirmação dos Termos de Uso e a ciência desta Política de Privacidade, associadas ao identificador da conta, à versão exata dos documentos e à data. Não coletamos IP nem identificação de dispositivo especificamente para esse registro. As versões dos textos são preservadas para conferência.

Esse aceite não equivale a consentimento genérico para tratamentos de dados não informados.

## Bases legais e escolhas

O tratamento de dados pessoais será realizado conforme as bases legais previstas na Lei Geral de Proteção de Dados Pessoais (LGPD), incluindo, conforme aplicável, a execução de contrato ou de procedimentos preliminares relacionados ao atendimento solicitado pelo titular e o cumprimento de obrigações legais ou regulatórias.

O consentimento, quando necessário, será solicitado de forma específica, informada e poderá ser revogado pelo titular, observadas as limitações legais aplicáveis.

O tratamento fundamentado em legítimo interesse será realizado somente quando presentes os requisitos legais aplicáveis e mediante avaliação adequada da finalidade, necessidade e equilíbrio entre os interesses envolvidos.

Referência: LGPD, arts. 7º e seguintes.

## Armazenamento, proteção e retenção

O banco de dados é armazenado em SQLite no servidor utilizado pela clínica. Em uma implantação com Vercel + Supabase, o painel pode ser servido pelo Vercel e o banco preparado no Supabase/Postgres, enquanto o conector WhatsApp permanece em worker persistente. A plataforma utiliza autenticação, perfis de acesso, controle por cadastro, proteção de sessão e armazenamento de senhas mediante hash.

Os dados clínicos não são integralmente criptografados dentro do arquivo do banco de dados. A utilização de criptografia de disco e HTTPS em acesso público depende da configuração e infraestrutura adotadas para a operação.

A conexão local de desenvolvimento utiliza HTTP somente em loopback.

Cadastros, mensagens e agendamentos são mantidos enquanto forem necessários para as finalidades de atendimento e operação, observadas as obrigações legais aplicáveis e os procedimentos de exclusão autorizados.

A auditoria técnica realiza a limpeza de registros com mais de 90 dias durante o registro de novas ações.

As sessões expiram após 8 horas ou após 30 minutos sem requisições autenticadas. Cookies não são utilizados para publicidade.

A exclusão de um cadastro poderá remover pet, mensagens, chamados, agendamentos e acompanhamentos vinculados. Antes da exclusão, serão avaliadas eventuais obrigações legais de conservação.

Cópias de segurança podem permanecer por determinado período após a exclusão realizada na aplicação, de acordo com a política de backup e infraestrutura utilizada. Dados excluídos não deverão ser reintroduzidos deliberadamente em restaurações, salvo quando necessário para cumprimento de obrigação legal ou técnica devidamente justificada.

## Terceiros e transferências

O WhatsApp/Meta é utilizado para o transporte das mensagens entre os usuários e a central de atendimento.

A conexão da sessão do WhatsApp é realizada por meio da biblioteca Baileys, executada no servidor para comunicação com o WhatsApp Web.

Quando houver utilização de serviços externos para processamento ou classificação de mensagens, poderão ocorrer operações de tratamento por fornecedores contratados. Esses fornecedores poderão estar localizados fora do Brasil, conforme sua infraestrutura e condições de serviço.

As transferências internacionais de dados serão realizadas observando os requisitos previstos na legislação aplicável e as garantias contratuais e técnicas adotadas pela empresa.

Links do Google Maps somente são abertos quando acionados pelo usuário.

Fontes da interface podem ser baixadas dos servidores do Google Fonts, podendo ocorrer o recebimento de metadados técnicos da conexão.

Não há integração de pagamentos nem upload de arquivos no site neste escopo.

## Direitos dos titulares

Os titulares de dados pessoais poderão solicitar, conforme aplicável:

* confirmação da existência de tratamento;
* acesso aos dados pessoais;
* correção de dados incompletos, inexatos ou desatualizados;
* anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;
* portabilidade, quando aplicável;
* eliminação dos dados tratados com base no consentimento, observadas as exceções legais;
* informação sobre entidades públicas e privadas com as quais os dados tenham sido compartilhados;
* informação sobre a possibilidade de não fornecer consentimento e suas consequências;
* revogação do consentimento, quando essa for a base legal utilizada;
* demais direitos previstos na legislação aplicável.

O atendimento dos pedidos poderá exigir confirmação da identidade do solicitante, utilizando procedimentos proporcionais e necessários para proteger os dados pessoais.

Nem toda solicitação de exclusão poderá ser atendida quando houver obrigação legal ou outra hipótese que autorize ou exija a conservação dos dados.

Reclamações poderão ser apresentadas à Autoridade Nacional de Proteção de Dados (ANPD), nos termos da legislação aplicável.

Referência: LGPD, art. 18.

## Incidentes de segurança

Em caso de incidente de segurança envolvendo dados pessoais, serão adotadas medidas para avaliar o ocorrido, conter ou reduzir seus efeitos, registrar as providências tomadas e realizar as comunicações exigidas pela legislação aplicável.

Quando necessário, os titulares e a Autoridade Nacional de Proteção de Dados serão comunicados conforme os requisitos legais aplicáveis.

Alterações relevantes desta Política de Privacidade serão comunicadas pelos canais oficiais utilizados pela empresa.
