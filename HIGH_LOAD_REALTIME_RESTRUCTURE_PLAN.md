# Plano de reestruturação realtime para alta carga

## Status

- **Tipo:** plano técnico, sem implementação nesta etapa
- **Escopo:** InstaPop / um único jogo global compartilhado
- **Objetivo:** suportar crescimento de usuários conectados e alto volume de ações simultâneas sem perder consistência do estado nem tornar a interface inutilizável
- **Premissa principal:** não existem salas de gameplay. Todos os usuários participam do mesmo jogo global; categorias, localizações e demais filtros alteram somente a visualização local de cada navegador.

---

## 1. Resumo executivo

A arquitetura atual funciona para uma carga pequena ou moderada, mas possui quatro limites importantes:

1. O processamento de ações acontece dentro do processo da API, em polling periódico.
2. Uma trava advisory global serializa o worker de ações.
3. Eventos realtime são publicados por `LISTEN/NOTIFY` e transmitidos por broadcast para todos os WebSockets.
4. Cada navegador reconstrói e desenha os efeitos visuais individualmente.

A arquitetura proposta mantém o PostgreSQL como fonte autoritativa do estado, mas separa:

```text
Entrada de ações
        ↓
Fila durável de resolução
        ↓
Worker(s) de ações
        ↓
Estado + outbox na mesma transação
        ↓
Broker realtime
        ↓
Gateway(s) WebSocket
        ↓
Clientes do jogo global
        ↓
Estado autoritativo + animação local
```

O resultado esperado é:

- ações aceitas sem bloquear a API web;
- processamento paralelo entre alvos diferentes;
- ordem determinística para ações que atingem o mesmo alvo;
- entrega realtime com sequência, batching e recuperação após reconexão;
- filtros preservados como comportamento visual local;
- degradação controlada dos efeitos decorativos quando a carga exceder a capacidade de um navegador;
- nenhum descarte silencioso de ações ou alterações do estado do jogo.

---

## 2. Modelo correto do produto

### 2.1 Um único jogo global

Todos os usuários entram no mesmo ambiente e podem executar ações uns contra os outros. O estado das células é compartilhado globalmente.

```text
Jogo global
├── todos os usuários
├── todas as pessoas/células
├── todas as ações
└── um estado autoritativo
```

O conceito técnico de `rooms` que já existe no banco representa atualmente o estado global ativo do tabuleiro. Ele não deve ser apresentado ao usuário como uma sala, partida ou grupo isolado.

### 2.2 Filtros não isolam jogadores

Filtros de:

- país;
- estado;
- cidade;
- categoria;
- outras variáveis de visualização;

devem continuar sendo aplicados no cliente.

O filtro determina o que o navegador desenha, mas não deve alterar:

- a participação do usuário no jogo;
- o estado autoritativo recebido;
- a ordem das ações;
- a resolução das ações;
- a sincronização da conta.

### 2.3 Consistência versus fidelidade visual

O sistema precisa distinguir dois níveis:

#### Obrigatório e nunca descartável

- criação da ação;
- identidade da ação;
- ordem da ação;
- valor final da célula;
- contagem de hits;
- status da ação;
- versão/sequência do estado;
- eventos necessários para recuperar o cliente.

#### Visual e sujeito a agregação

- cada projétil individual;
- trilhas;
- partículas;
- ondas;
- tremores;
- efeitos repetidos em alta frequência.

Em carga normal, os efeitos podem ser detalhados. Em carga extrema, a ação deve continuar visível e correta, mas seus efeitos cosméticos podem ser agrupados.

---

## 3. Diagnóstico da arquitetura atual

### 3.1 Entrada de ações

O endpoint atual é:

```text
POST /api/pop-person/actions
```

Ele:

1. valida o payload;
2. localiza alvo, item, nível e regra;
3. calcula os valores;
4. grava a ação como `queued`;
5. retorna a ação criada.

Pontos positivos já existentes:

- idempotência por sessão e chave da ação;
- cálculo de regra no backend;
- persistência do horário programado;
- persistência da célula de origem;
- transação na criação.

Limites atuais:

- rate limit mantido em memória;
- o contador não é compartilhado entre instâncias;
- a API web também inicializa e executa o worker;
- a criação não entra em uma fila externa/durável explicitamente.

### 3.2 Worker atual

O worker:

- roda a cada 500 ms;
- procura ações vencidas;
- usa uma trava advisory global;
- processa até 100 ações encontradas;
- atualiza as células;
- atualiza o status das ações;
- grava evento de ação;
- envia `pg_notify`.

A trava global protege a consistência, mas limita a capacidade de processamento paralelo. Além disso, o processamento da ação e a entrega realtime estão ligados ao ciclo do processo da API.

### 3.3 Realtime atual

O servidor:

1. escuta o canal PostgreSQL;
2. busca novamente a ação resolvida;
3. transmite o evento para todos os sockets conectados.

O padrão atual é equivalente a:

```text
cada evento × todos os clientes conectados
```

Não há ainda:

- outbox durável como fonte de entrega;
- sequência global de eventos para replay;
- batching;
- gateway realtime separado;
- broker compartilhado;
- controle de assinatura por tipo de evento;
- métrica de atraso por cliente.

### 3.4 Cliente atual

O cliente:

- recebe snapshots e eventos;
- sincroniza o relógio com o servidor;
- reconstrói a linha do tempo da ação;
- usa `requestAnimationFrame`;
- desenha projéteis e impactos no canvas;
- possui limite global de projéteis;
- distribui o orçamento visual entre emissores;
- só desenha células que estão visíveis no filtro atual.

Pontos positivos já existentes:

- ações independentes;
- origem e alvo dinâmicos;
- progressão visual baseada em horário do servidor;
- preservação de efeitos em reconciliações normais;
- proteção contra conexões WebSocket muito lentas;
- HUD com múltiplas ações.

Limites atuais:

- cada navegador processa todos os eventos recebidos;
- snapshots podem conter o estado completo;
- o canvas não pode desenhar milhares de projéteis individuais de forma sustentável;
- efeitos de alvos filtrados não aparecem naquele cliente;
- a recuperação após desconexão não possui replay durável completo.

---

## 4. Arquitetura-alvo

## 4.1 Componentes

### A. API de comandos

Responsável por:

- autenticação;
- autorização;
- validação;
- idempotência;
- rate limit;
- criação de ações;
- consulta de snapshots;
- consulta de ações recentes.

Não deve resolver ações em loop contínuo.

### B. Fila durável

Responsável por armazenar ações pendentes até que um worker as processe.

Opções possíveis:

1. **PostgreSQL com tabela de fila e `FOR UPDATE SKIP LOCKED`**
   - menor mudança de infraestrutura;
   - aproveita a base atual;
   - adequado para a primeira fase;
   - exige cuidado com polling e contenção.

2. **Redis Streams/BullMQ ou fila equivalente**
   - melhor distribuição entre workers;
   - backpressure explícito;
   - retry e observabilidade mais naturais;
   - adiciona uma dependência operacional.

3. **Serviço de fila gerenciado**
   - reduz operação própria;
   - precisa ser escolhido conforme o ambiente de produção;
   - deve preservar ordenação por alvo.

Recomendação inicial: implementar a abstração de fila e começar com PostgreSQL/outbox se a carga ainda não justificar um serviço adicional. O contrato deve permitir trocar o backend da fila sem alterar a regra do jogo.

### C. Workers de resolução

Workers independentes da API web.

Responsabilidades:

- consumir ações pendentes;
- respeitar `scheduledFor`;
- garantir ordem por célula-alvo;
- calcular resultado autoritativo;
- atualizar célula e ação em transação;
- gravar evento de estado e evento visual;
- confirmar o item processado;
- reenfileirar em caso de falha recuperável.

### D. Outbox de eventos

Alterações de estado e eventos realtime devem ser gravados na mesma transação que atualiza a célula.

Exemplo conceitual:

```text
transação:
  update cells
  update actions
  insert game_events
  insert realtime_outbox
commit
```

Se a transação confirmar, o evento existe. Se falhar, nem o estado nem o evento são publicados.

### E. Publicador de eventos

Processo responsável por:

- ler a outbox;
- publicar no broker;
- marcar o evento como publicado;
- repetir eventos que falharem;
- medir atraso entre criação e publicação.

`LISTEN/NOTIFY` pode continuar sendo usado como um sinal de “há trabalho novo”, mas não deve ser a única forma de entrega.

### F. Broker realtime

O broker distribui eventos entre workers, gateways e instâncias do servidor.

Canais conceituais:

```text
game:global:state
game:global:effects
game:global:control
```

Esses canais representam o jogo global, não salas de usuários.

### G. Gateway WebSocket

Responsável por:

- aceitar e manter conexões WebSocket;
- autenticar ou associar a sessão;
- enviar snapshot inicial;
- receber a última sequência do cliente;
- entregar eventos em lote;
- controlar backpressure;
- fechar conexões lentas de forma recuperável;
- solicitar ressincronização quando necessário.

A API web e o gateway podem continuar no mesmo processo na primeira fase, desde que a interface entre eles seja definida. Em escala maior, o gateway deve ser escalável independentemente da API e dos workers.

---

## 5. Ordenação e concorrência das ações

### 5.1 Mesmo alvo

Duas ações que atingem a mesma célula precisam ter uma ordem determinística.

Exemplo:

```text
Ação A → célula X
Ação B → célula X
Ação C → célula Y
```

O processamento deve garantir:

```text
A antes de B para a célula X
C pode ser processada em paralelo
```

Isso pode ser implementado por:

- partição por `targetCellId`;
- fila por chave de ordenação;
- lock por célula;
- número de versão/compare-and-swap;
- combinação de claim em lote com atualização condicional.

### 5.2 Alvos diferentes

Ações em células diferentes devem poder ser processadas em paralelo para aproveitar várias CPUs e reduzir a fila global.

### 5.3 Ação com muitos hits

A regra autoritativa deve continuar sendo definida no servidor. Há duas estratégias possíveis:

#### Estratégia recomendada: resolução agregada

O worker atualiza o valor final da ação em uma transação e grava uma linha do tempo visual:

```text
valor inicial
valor final
quantidade de hits
primeiro impacto
intervalo
duração
```

Vantagens:

- menos escritas no banco;
- menos eventos;
- melhor throughput;
- animação ainda pode ser reconstruída no cliente.

#### Estratégia alternativa: hits autoritativos individuais

Cada hit vira um evento persistido e pode atualizar a célula individualmente.

Vantagens:

- auditoria mais detalhada;
- reconciliação por hit.

Desvantagens:

- muito mais escritas;
- mais eventos;
- maior custo de replay;
- não é necessária para efeitos visuais comuns.

Recomendação: usar resolução agregada como padrão e só adotar hits individuais se houver uma regra de negócio que realmente exija o valor intermediário no servidor.

---

## 6. Modelo de eventos realtime

## 6.1 Sequência global

Cada evento deve possuir uma sequência monotônica do jogo global:

```text
sequence: 1001
sequence: 1002
sequence: 1003
```

A sequência permite:

- detectar lacunas;
- ignorar eventos antigos;
- recuperar após reconexão;
- medir atraso;
- aplicar eventos na ordem correta.

### 6.2 Tipos de mensagem

#### Snapshot

Usado na entrada e na ressincronização:

```json
{
  "type": "snapshot",
  "sequence": 1000,
  "serverTime": 1788398200000,
  "dataset": [],
  "actions": []
}
```

#### Delta de estado

Usado para alterações pequenas:

```json
{
  "type": "state.delta",
  "sequence": 1001,
  "changes": [
    {
      "cellId": "...",
      "value": 127,
      "stateVersion": 45
    }
  ]
}
```

#### Lote de efeitos

Usado para ações que devem ser animadas:

```json
{
  "type": "effects.batch",
  "sequence": 1002,
  "serverTime": 1788398200000,
  "actions": [
    {
      "actionId": "...",
      "targetName": "...",
      "hitCount": 20,
      "previousValue": 100,
      "finalValue": 120,
      "firstImpactAt": 1788398200100,
      "intervalMs": 80,
      "durationMs": 600
    }
  ]
}
```

#### Ressincronização

```json
{
  "type": "resync.required",
  "reason": "sequence_gap"
}
```

O cliente então solicita um snapshot atual.

### 6.3 Batching

Eventos produzidos em uma pequena janela, por exemplo de 16 a 50 ms, podem ser agrupados.

O batching reduz:

- número de mensagens;
- número de `JSON.stringify`;
- número de callbacks;
- custo de parsing;
- overhead por conexão.

O batching não deve alterar a sequência lógica nem os horários da ação.

---

## 7. Entrega para todos os usuários

Como o jogo é global, todos os usuários continuam recebendo o estado necessário para permanecer sincronizados.

Entretanto, é importante separar:

### Estado

Deve ser sincronizado globalmente:

- valores das células;
- status das ações;
- sequências;
- contadores;
- informações de recuperação.

### Efeitos visuais

Podem ser tratados com diferentes níveis:

1. efeito detalhado em carga normal;
2. efeito agrupado em carga alta;
3. snapshot e contador em carga extrema;
4. recuperação automática quando o cliente voltar a acompanhar o fluxo.

O filtro local não deve impedir a atualização do estado. Ele somente decide quais células e efeitos são desenhados.

---

## 8. Cliente e renderização em alta carga

### 8.1 Armazenamento separado

O frontend deve manter duas estruturas separadas:

#### Store autoritativo

- dataset atual;
- células;
- ações;
- sequência recebida;
- estado de conexão;
- necessidade de ressincronização.

#### Scheduler visual

- timelines de ações;
- emissores;
- projéteis;
- impactos;
- partículas;
- budget visual;
- prioridade e agregação.

Uma atualização visual não deve substituir nem apagar o estado autoritativo.

### 8.2 Renderização frame a frame

O canvas continuará renderizando localmente via `requestAnimationFrame`. O servidor não deve enviar coordenadas a cada frame.

Cada ação visual deve possuir:

- horário de início baseado no servidor;
- horário de impacto;
- duração;
- intervalo;
- identidade própria;
- alvo;
- origem;
- progresso independente.

### 8.3 Budget visual

O cliente deve ter limites configuráveis para:

- projéteis simultâneos;
- impactos simultâneos;
- partículas;
- efeitos por frame;
- efeitos por alvo;
- ações exibidas no HUD.

O escalonamento deve ser justo entre ações. Uma ação longa não pode ocupar todos os slots e fazer as outras desaparecerem.

### 8.4 Agregação visual

Quando o budget for excedido:

```text
20 hits do mesmo alvo em uma janela curta
→ uma rajada visual
→ contador de 20 hits
→ uma onda de impacto agregada
```

Isso preserva a percepção de atividade sem obrigar o navegador a criar milhares de objetos visuais.

### 8.5 Clientes lentos

Se o cliente não acompanhar:

1. efeitos cosméticos antigos podem ser descartados;
2. estado autoritativo não pode ser descartado;
3. o gateway pode enviar `resync.required`;
4. o cliente baixa um snapshot atual;
5. o cliente retoma os efeitos novos.

Não é necessário reproduzir todos os efeitos históricos depois de uma desconexão longa.

---

## 9. Persistência e esquema proposto

As tabelas atuais podem ser preservadas. A evolução deve ser incremental.

### 9.1 Ações

Manter ou reforçar:

- `id`;
- `roomId` técnico do jogo global;
- `cellId`;
- `sourceCellId`;
- `status`;
- `scheduledFor`;
- `completesAt`;
- `idempotencyKey`;
- `ruleSnapshot`;
- `createdAt`;
- `updatedAt`.

Possíveis campos adicionais:

- `claimedAt`;
- `claimedBy`;
- `attemptCount`;
- `lastError`;
- `processingPartition`;
- `resolvedSequence`.

### 9.2 Eventos do jogo

A tabela de eventos deve suportar:

- `sequence`;
- `eventType`;
- `actionId`;
- `cellId`;
- `payload`;
- `occurredAt`;
- `publishedAt`;
- `retentionUntil`.

A sequência precisa ser monotônica dentro do jogo global.

### 9.3 Outbox

Uma tabela outbox deve registrar eventos prontos para publicação:

- `id`;
- `sequence`;
- `topic`;
- `payload`;
- `createdAt`;
- `publishedAt`;
- `attemptCount`;
- `lastError`.

Índices essenciais:

- eventos não publicados;
- sequência;
- data de retenção;
- ação;
- célula.

### 9.4 Retenção

Eventos antigos não precisam ficar indefinidamente disponíveis para efeitos visuais.

Política sugerida:

- manter eventos recentes para replay;
- manter snapshots periódicos;
- remover eventos antigos após um período configurável;
- sempre permitir ressincronização por snapshot.

---

## 10. Rate limit, abuso e proteção da fila

O rate limit atual é local ao processo. Para múltiplas instâncias, deve ser compartilhado.

Devem existir limites independentes para:

- ações por usuário;
- ações por sessão;
- ações por IP;
- ações por alvo;
- custo ou saldo;
- tamanho de payload;
- conexões WebSocket por origem;
- reconexões por período.

O rate limit deve retornar:

- código estável;
- limite;
- restante;
- horário de reset;
- `Retry-After`.

A fila também precisa de proteção contra explosões legítimas ou abusivas:

- limite de ações pendentes por usuário;
- limite global de backlog;
- prioridade justa;
- rejeição explícita quando o sistema não puder aceitar mais carga;
- métricas de saturação.

---

## 11. Observabilidade

Antes de alterar a infraestrutura, devem ser adicionadas métricas estruturadas.

### 11.1 API

- ações recebidas por segundo;
- latência do `POST`;
- erros de validação;
- respostas `429`;
- ações duplicadas por idempotência;
- conexões abertas;
- conexões encerradas;
- latência de snapshot.

### 11.2 Fila e workers

- profundidade da fila;
- idade da ação mais antiga;
- ações processadas por segundo;
- tempo de espera;
- tempo de processamento;
- tentativas;
- falhas;
- ações por partição;
- contenção por célula;
- ações com o mesmo alvo.

### 11.3 Realtime

- eventos publicados por segundo;
- atraso outbox → broker;
- atraso broker → gateway;
- atraso gateway → cliente;
- mensagens por conexão;
- bytes por conexão;
- `bufferedAmount`;
- conexões lentas;
- lacunas de sequência;
- pedidos de ressincronização.

### 11.4 Frontend

- FPS;
- projéteis ativos;
- impactos ativos;
- ações visuais ativas;
- efeitos agregados;
- efeitos descartados por budget;
- tempo entre `action:resolved` e início visual;
- quantidade de snapshots;
- reconexões;
- lacunas de sequência.

### 11.5 Logs correlacionados

Todos os componentes devem registrar:

- `actionId`;
- `cellId`;
- `sequence`;
- `stateVersion`;
- timestamp do servidor;
- timestamp de publicação;
- timestamp de recebimento;
- timestamp de início visual.

Isso permite diferenciar:

```text
ação não processada
ação processada mas não publicada
evento publicado mas atrasado
evento recebido mas não renderizado
efeito agregado por excesso de carga
```

---

## 12. Plano de migração

## Fase 0 — Instrumentação e linha de base

### Objetivo

Medir o sistema atual antes de introduzir mudanças estruturais.

### Entregas

- métricas de fila;
- tempo de processamento;
- atraso realtime;
- contagem de conexões;
- bytes enviados;
- FPS e budget visual;
- logs correlacionados por ação;
- dashboard mínimo de operação.

### Critério de saída

Conseguir responder, para qualquer ação, em que momento ela:

1. foi recebida;
2. foi persistida;
3. foi resolvida;
4. foi publicada;
5. foi recebida no cliente;
6. começou visualmente.

---

## Fase 1 — Separar API e worker

### Objetivo

Evitar que o processamento da fila concorra diretamente com o processo que atende HTTP e WebSocket.

### Entregas

- processo worker dedicado;
- contrato explícito de consumo;
- retry;
- claim seguro;
- manutenção temporária do PostgreSQL como fila;
- remoção gradual do `setInterval` de dentro da API;
- compatibilidade com uma única instância inicialmente.

### Critério de saída

Reiniciar a API não deve interromper permanentemente as ações. O worker deve retomar as pendentes.

---

## Fase 2 — Ordenação por alvo e paralelismo

### Objetivo

Permitir processamento paralelo sem alterar o resultado do jogo.

### Entregas

- partição por `targetCellId` ou chave equivalente;
- ordem determinística para o mesmo alvo;
- workers paralelos para alvos diferentes;
- remoção da dependência de uma trava advisory global única;
- testes de concorrência para ações no mesmo alvo.

### Critério de saída

Executar ações em centenas de alvos diferentes em paralelo, mantendo o mesmo resultado de uma execução serial de referência.

---

## Fase 3 — Outbox e sequência de eventos

### Objetivo

Tornar a entrega realtime durável e recuperável.

### Entregas

- tabela outbox;
- sequência global do jogo;
- gravação de estado e evento na mesma transação;
- publicador idempotente;
- replay após reconexão;
- snapshot com sequência.

### Critério de saída

Um cliente que perder conexão deve conseguir voltar ao estado correto sem depender de reproduzir todos os efeitos visuais antigos.

---

## Fase 4 — Gateway realtime e batching

### Objetivo

Separar distribuição realtime do processamento de ações e reduzir overhead de mensagens.

### Entregas

- camada de gateway WebSocket;
- broker compartilhado;
- batching de eventos;
- mensagens de delta;
- controle de backpressure;
- suporte a múltiplas instâncias do gateway;
- broadcast do jogo global sem conceito de salas de gameplay.

### Critério de saída

Adicionar uma instância do gateway não cria mensagens duplicadas nem eventos fora de ordem.

---

## Fase 5 — Cliente resiliente em alta carga

### Objetivo

Garantir que cada navegador mantenha o estado correto mesmo quando não consegue desenhar todos os efeitos individualmente.

### Entregas

- store autoritativo separado do scheduler visual;
- aplicação monotônica de sequências;
- agregação visual;
- pool de objetos;
- budget configurável;
- prioridade justa por ação;
- recuperação automática por snapshot;
- HUD que mantém todas as ações ou uma representação agregada explícita.

### Critério de saída

O cliente nunca deve interpretar “efeito visual descartado” como “ação perdida”.

---

## Fase 6 — Escala horizontal e operação

### Objetivo

Executar API, workers e gateways em múltiplas instâncias.

### Entregas

- rate limit compartilhado;
- broker compartilhado;
- health checks;
- readiness para dependências;
- shutdown gracioso;
- autoscaling baseado em métricas;
- alertas de backlog;
- retenção e limpeza de eventos;
- runbook de incidentes.

### Critério de saída

Uma instância pode ser removida ou reiniciada sem perder ações confirmadas nem deixar o jogo em estado divergente.

---

## 13. Testes de carga

Os testes devem representar o jogo global e não uma coleção de salas.

### Cenários

| Cenário | Conexões | Ações | Objetivo |
|---|---:|---:|---|
| Base | 100 | 1/s | comportamento normal |
| Crescimento | 500 | 10/s | estabilidade do fluxo |
| Alta atividade | 1.000 | 100/s | capacidade de ingestão |
| Rajada | 1.000 | 1.000 em poucos segundos | fila e backpressure |
| Mesmo alvo | 500 | muitas no mesmo alvo | ordenação e contenção |
| Alvos diversos | 1.000 | distribuídas | paralelismo |
| Reconexão | 1.000 | durante pico | replay/snapshot |
| Cliente lento | 100 | alta | encerramento e recuperação |
| Filtro visual | 1.000 | alta | estado global e desenho local |
| Dispositivo móvel | amostra real | alta | FPS e agregação |

### Métricas de aprovação

Os valores finais devem ser definidos após a linha de base, mas o teste deve medir:

- p50, p95 e p99 de aceitação da ação;
- p50, p95 e p99 de resolução;
- idade máxima da ação pendente;
- atraso de entrega realtime;
- taxa de reconexão;
- erros e duplicidades;
- percentual de eventos agregados;
- FPS por classe de dispositivo;
- uso de CPU e memória;
- bytes enviados por conexão;
- divergência entre snapshot e estado esperado.

### Teste de referência

Para cada carga, manter um modelo serial de referência:

```text
mesmas ações
mesma ordem por alvo
mesmas regras
resultado serial
resultado dos workers paralelos
```

Os estados finais devem ser idênticos.

---

## 14. Regras de falha e recuperação

### API reiniciada

- ações já confirmadas permanecem no banco;
- o worker retoma pendências;
- clientes continuam recebendo por outro gateway ou reconectam.

### Worker reiniciado

- item não confirmado volta a ser processável;
- idempotência impede duplicação;
- eventos já publicados não são publicados como nova ação lógica;
- transações incompletas fazem rollback.

### Broker indisponível

- a outbox acumula eventos;
- o estado do banco continua autoritativo;
- o atraso fica visível em métrica;
- o publicador retoma depois.

### Cliente desconectado

- não é necessário replayar todos os efeitos;
- cliente baixa snapshot;
- cliente retoma eventos novos;
- estado final permanece correto.

### Cliente lento

- efeitos cosméticos podem ser agregados ou descartados;
- estado e sequências não podem ser silenciosamente descartados;
- conexão pode ser encerrada com motivo recuperável.

### Evento duplicado

- o cliente usa `sequence` e `actionId`;
- eventos repetidos não criam segunda animação;
- o resultado autoritativo continua idempotente.

---

## 15. Decisões que devem ser mantidas

1. O jogo continua sendo global.
2. Não criar salas de gameplay para resolver o problema de escala.
3. Filtros continuam sendo locais e visuais.
4. PostgreSQL continua sendo autoridade do estado.
5. O cliente não pode ser autoridade dos valores das células.
6. Ações no mesmo alvo precisam de ordem determinística.
7. Ações em alvos diferentes devem poder ser processadas em paralelo.
8. Efeitos visuais podem ser agregados, mas ações e estado não podem desaparecer.
9. O servidor não deve transmitir coordenadas frame a frame.
10. O cliente deve interpolar animações usando timestamps do servidor.
11. `LISTEN/NOTIFY` não deve ser a única garantia de entrega.
12. Reconexão deve terminar em snapshot consistente.

---

## 16. Riscos e trade-offs

### Broker adicional

Melhora a distribuição e a escala horizontal, mas aumenta o custo operacional.

### Batching

Reduz overhead, mas acrescenta alguns milissegundos de espera deliberada.

### Agregação visual

Protege o navegador, mas em carga extrema nem todo projétil individual será desenhado.

### Paralelismo

Aumenta throughput, mas exige ordenação rigorosa por alvo.

### Outbox

Melhora confiabilidade, mas introduz retenção, limpeza e operação de eventos.

### Snapshot versus replay

Replay detalhado oferece mais fidelidade, mas é mais caro. Para efeitos visuais, snapshot mais eventos recentes é suficiente.

### Estado global para todos

Preserva a dinâmica original do game, mas o custo de distribuição cresce com o número de clientes. Não há como transmitir todos os detalhes individuais para todos os usuários em escala ilimitada sem custo proporcional.

---

## 17. O que não deve ser feito

- Não criar uma sala por categoria.
- Não criar uma sala por filtro.
- Não separar jogadores só porque eles estão vendo subconjuntos diferentes.
- Não confiar em dados calculados pelo cliente para atualizar valores.
- Não usar somente memória local para rate limit em múltiplas instâncias.
- Não usar `LISTEN/NOTIFY` como histórico de eventos.
- Não enviar um snapshot completo para cada cliente a cada hit se um delta for suficiente.
- Não permitir que uma ação consuma indefinidamente todo o budget visual.
- Não interpretar ausência de animação como ausência de ação.
- Não tentar reproduzir milhares de partículas individuais em todos os dispositivos.

---

## 18. Critérios finais de aceite

A reestruturação será considerada concluída quando:

1. Todos os usuários continuarem no mesmo jogo global.
2. Filtros alterarem apenas o que cada navegador desenha.
3. Ações no mesmo alvo mantiverem ordem determinística.
4. Ações em alvos diferentes puderem ser processadas em paralelo.
5. Reiniciar API, worker ou gateway não perder ações confirmadas.
6. O cliente detectar lacunas de sequência.
7. O cliente conseguir recuperar o estado por snapshot.
8. O rate limit funcionar de forma consistente entre instâncias.
9. O sistema medir backlog e atraso realtime.
10. Eventos poderem ser agrupados sem alterar a linha do tempo lógica.
11. Todas as ações permanecerem representadas no estado/HUD, mesmo quando efeitos visuais forem agregados.
12. A interface continuar responsiva em dispositivos de baixa capacidade.
13. Os resultados dos workers paralelos coincidirem com o modelo serial de referência.
14. Os testes de carga definidos forem executados e os limites operacionais forem documentados.

---

## 19. Ordem recomendada de implementação

```text
1. Instrumentação
2. Abstração da fila
3. Worker separado
4. Ordenação por alvo
5. Outbox e sequência
6. Replay/snapshot
7. Broker
8. Gateway WebSocket escalável
9. Batching
10. Store autoritativo no cliente
11. Agregação visual
12. Rate limit compartilhado
13. Testes de carga
14. Autoscaling e operação
```

Nenhuma etapa deve remover a persistência atual ou substituir o banco sem uma migração validada. A prioridade é preservar os registros existentes e introduzir cada camada com compatibilidade temporária.
