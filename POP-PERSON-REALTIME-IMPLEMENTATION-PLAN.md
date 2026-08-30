# Plano de implantação: ações realtime do PopPerson

## 1. Objetivo

Substituir o fluxo híbrido atual por uma arquitetura previsível para ações de
ataque e defesa:

```text
servidor autoriza e registra a ação
        ↓
servidor publica o plano completo da ação
        ↓
cada cliente anima o plano de forma contínua
        ↓
servidor processa os hits e atualiza o banco em paralelo
        ↓
eventos de hit confirmam o estado e corrigem divergências
        ↓
snapshot sincroniza clientes novos ou que ficaram offline
```

O resultado esperado é:

- uma ação não parar porque um evento realtime atrasou;
- projéteis, impactos, percentual e crescimento usarem o mesmo marco visual;
- o servidor continuar sendo a única autoridade sobre valores e progresso;
- um cliente offline por horas, dias ou semanas não reproduzir o histórico inteiro;
- reconexões recuperarem o estado atual sem criar milhares de animações antigas;
- todos os clientes convergirem para o mesmo estado autoritativo.

## 2. Decisões fundamentais

### 2.1 O servidor é a autoridade da ação

O servidor decide e persiste:

- se a ação é válida;
- alvo, modo, elemento e nível;
- quantidade total de hits;
- valor de cada hit;
- horário de início;
- horário previsto de cada hit;
- estado `queued`, `running`, `completed` ou `cancelled`;
- valor final da célula;
- versão do estado da sala.

O cliente nunca informa ao servidor “quanto processou” como fonte de verdade.
O cliente pode enviar telemetria opcional, como “a ação ficou visível”, mas essa
informação não pode alterar células, progresso ou conclusão.

**Por quê:** o navegador pode fechar, perder conexão, atrasar, apresentar erro
ou ser manipulado. Se o cliente fosse responsável por confirmar progresso, uma
ação poderia ficar incompleta ou produzir resultados diferentes para cada
usuário.

### 2.2 A ação deve ser publicada como um plano completo

Depois de criar a ação no banco, o servidor deve publicar todos os dados
necessários para um cliente executar a animação sem depender da chegada de cada
hit:

```ts
{
  type: "action:started",
  serverTime: 1730000000000,
  action: {
    id: "action-id",
    targetName: "Pessoa",
    mode: "atacar",
    element: { ... },
    count: 20,
    executeAt: 1730000001000,
    completesAt: 1730000004500,
    staggerMs: 150,
    durationMs: 500,
    growthPerHit: 2.5,
    shake: true
  }
}
```

O plano precisa ser imutável depois que a ação entra na fila. Alterações de
regra ou configuração posteriores não podem mudar uma ação já criada.

**Por quê:** o cliente precisa de um cronograma estável. Se o cronograma for
reconstruído de snapshots parciais ou de eventos que chegam em velocidades
diferentes, a animação executa, para e executa novamente.

### 2.3 Eventos de hit confirmam; não liberam o próximo projétil

O servidor deve continuar publicando cada hit:

```ts
{
  type: "hit",
  serverTime: 1730000001900,
  event: {
    actionId: "action-id",
    hitIndex: 7,
    hitAt: 1730000001900,
    targetName: "Pessoa",
    direction: "atacar",
    delta: -2.5,
    value: 782.5,
    stateVersion: 1842
  }
}
```

O cliente usa esse evento para:

- confirmar o valor autoritativo;
- confirmar o índice do hit;
- corrigir a célula se o valor local divergir;
- sincronizar o percentual;
- confirmar o impacto correspondente.

O cliente não deve ficar bloqueado esperando esse evento para disparar o
próximo projétil. O horário `hitAt`, combinado com o relógio do servidor, é o
marco da animação.

**Por quê:** o worker do banco pode atrasar alguns milissegundos ou segundos.
Usar a entrega do WebSocket como mecanismo de clock transforma latência em
pausas visíveis.

### 2.4 Snapshot atual não é replay visual

Um snapshot representa o estado atual do servidor, não uma lista de efeitos que
o cliente precisa assistir:

```ts
{
  type: "snapshot",
  serverTime: 1730000100000,
  state: {
    stateVersion: 50000,
    dataset: [
      { name: "Pessoa", value: 782.5 }
    ],
    actions: [
      {
        id: "action-current",
        status: "running",
        executeAt: 1730000099000,
        completesAt: 1730000102000,
        count: 20,
        hitCount: 13
      }
    ]
  }
}
```

Ao receber o snapshot:

1. o cliente aplica o valor atual das células;
2. remove a fila de efeitos históricos;
3. descarta ações já concluídas;
4. mantém apenas ações ainda ativas;
5. anima somente o trecho restante de ações ativas.

Se o cliente ficou offline por uma semana, ele não recebe nem anima a semana
inteira. Ele recebe a verdade atual e continua apenas o que ainda estiver
acontecendo.

**Por quê:** eventos históricos são úteis para auditoria e reconstrução no
servidor, mas não são efeitos visuais pendentes.

## 3. Ciclo de vida de uma ação

### 3.1 Criação

1. O usuário escolhe modo, elemento, nível e alvo.
2. O cliente envia somente os dados de intenção para
   `POST /api/pop-person/actions`.
3. O servidor valida a intenção, calcula regras e cria uma ação idempotente.
4. O servidor persiste o plano completo na ação.
5. O servidor responde `201` sem aguardar o processamento de todos os hits.
6. O servidor publica `action:queued`.

A resposta HTTP deve terminar assim que a criação estiver confirmada. O envio
de notificações ou o worker não pode manter o POST em estado “Enviando...”.

### 3.2 Fila

Uma ação `queued` possui:

- `executeAt`;
- plano visual;
- estado persistido;
- identificador idempotente.

O cliente exibe a contagem regressiva, mas não inicia os projéteis antes de
receber a confirmação `running` do servidor.

### 3.3 Início

Quando `executeAt` chega, o worker:

1. muda a ação para `running`;
2. grava o evento `started`;
3. publica `action:started` com o plano completo;
4. começa a processar os hits de acordo com `hitAt`.

O cliente calcula o deslocamento do relógio usando `serverTime`. Ele não usa
apenas `Date.now()` sem correção, porque relógios locais podem divergir.

### 3.4 Execução

O cliente agenda visualmente cada projétil com base em:

```text
projectileStartAt = executeAt + hitIndex * staggerMs - durationMs
impactAt = executeAt + hitIndex * staggerMs
```

O posicionamento final deve ser resolvido a cada frame pela célula animada
atual. O projétil não pode guardar para sempre as coordenadas do alvo no
momento do disparo.

No servidor, cada hit é processado em uma transação curta:

1. insere o evento de hit de forma idempotente;
2. atualiza o valor da célula;
3. incrementa a versão da sala;
4. grava o novo valor no evento;
5. publica a notificação depois do commit.

### 3.5 Conclusão

O servidor muda a ação para `completed` somente quando:

- todos os hits foram persistidos;
- o horário de conclusão foi atingido;
- a transação de conclusão foi confirmada.

O cliente recebe `action:completed`, deixa impactos já iniciados terminarem e
remove a identidade visual da ação. A conclusão do servidor não deve apagar
projéteis ou impactos que ainda estão em seus últimos frames.

### 3.6 Cancelamento

Uma ação cancelada deixa de gerar novos efeitos. O cliente:

- remove projéteis ainda não disparados;
- pode deixar um impacto já iniciado terminar;
- remove a ação do HUD;
- aplica o snapshot seguinte como autoridade.

## 4. Estado do cliente

O cliente deve separar explicitamente quatro categorias de estado.

### 4.1 Estado autoritativo recebido

```ts
serverState = {
  stateVersion,
  dataset,
  actions
}
```

Representa o que o servidor considera verdadeiro agora.

### 4.2 Plano visual de ação

```ts
visualAction = {
  actionId,
  targetName,
  executeAt,
  completesAt,
  totalHits,
  staggerMs,
  durationMs,
  element,
  mode
}
```

Representa como a ação deve ser animada. Não é um contador de banco.

### 4.3 Progresso visual

```ts
visualProgressByAction = {
  [actionId]: {
    lastRenderedHitIndex,
    lastRenderedAt
  }
}
```

Só deve avançar quando um impacto foi efetivamente apresentado ao usuário.
Não deve ser sobrescrito silenciosamente por `hitCount` de um snapshot.

### 4.4 Objetos efêmeros do Canvas

```ts
projectiles
impacts
animatedCircles
```

Esses objetos não são persistentes e não devem decidir o estado do servidor.
Eles podem ser descartados a qualquer momento ao reconectar ou quando uma ação
deixa de estar ativa.

## 5. Política de sincronização

### 5.1 Cliente conectado sem perda

Fluxo normal:

```text
action:started
  → plano visual é registrado
  → projéteis são agendados pelo relógio do servidor
  → hit chega e confirma value/hitIndex
  → impacto é apresentado
  → percentual avança
```

O evento `hit` deve ser idempotente no cliente usando:

```text
actionId + hitIndex
```

Um hit já renderizado não pode gerar outro impacto.

### 5.2 Cliente reconectado após curto intervalo

Ao reconectar:

1. receber snapshot atual;
2. comparar `stateVersion`;
3. limpar efeitos de ações antigas;
4. registrar as ações ainda `queued` ou `running`;
5. calcular o tempo transcorrido de cada ação;
6. agendar somente projéteis e impactos restantes;
7. aceitar novos eventos realtime normalmente.

Não se deve reproduzir cada evento perdido.

### 5.3 Cliente offline por longo período

Se a ação já terminou:

```text
aplica valor final
não reproduz projéteis antigos
não reproduz impactos antigos
```

Se a ação ainda está em execução:

```text
usa executeAt, completesAt e hitCount atuais
anima apenas o restante
```

Se não há ações ativas, o cliente apenas exibe o snapshot.

### 5.4 Snapshot mais novo que evento visual pendente

Um snapshot pode conter um valor que já inclui hits ainda não exibidos localmente.
A implementação deve manter duas noções diferentes:

- `serverValue`: valor confirmado pelo servidor;
- `displayValue`: valor que está sendo apresentado na transição visual.

Durante uma ação ativa, o snapshot não deve eliminar a fila de eventos visuais
nem marcar hits como renderizados. O evento `hit` correspondente ainda deve
poder produzir o impacto.

Quando o cliente não puder recuperar os eventos visuais de uma ação, ele deve
priorizar a convergência rápida para o snapshot e descartar a animação histórica.
Não pode ficar indefinidamente tentando reconstruir a sequência.

## 6. Contrato realtime recomendado

### 6.1 `snapshot`

Enviado na conexão e após uma recuperação:

```ts
{
  type: "snapshot",
  serverTime: number,
  state: {
    stateVersion: number,
    dataset: Cell[],
    actions: LiveAction[]
  }
}
```

`actions` deve conter apenas ações `queued` e `running`, pois ações concluídas
não precisam ser animadas por um cliente que acabou de chegar.

### 6.2 `action:queued`

```ts
{
  type: "action:queued",
  serverTime: number,
  action: LiveAction
}
```

### 6.3 `action:started`

Deve conter o mesmo plano completo necessário para qualquer cliente começar a
animação sem depender de uma segunda consulta.

### 6.4 `hit`

```ts
{
  type: "hit",
  serverTime: number,
  event: {
    actionId: string,
    hitIndex: number,
    hitAt: number,
    targetName: string,
    direction: "atacar" | "defender",
    delta: number,
    value: number,
    stateVersion: number
  }
}
```

O `value` é o valor da célula imediatamente depois daquele hit. O
`hitIndex` é o progresso daquela ação. Não é necessário enviar um histórico
inteiro para o cliente.

### 6.5 `action:completed` e `action:cancelled`

```ts
{
  type: "action:completed",
  actionId: string,
  serverTime: number
}
```

Esses eventos controlam o fim lógico da ação, não o corte abrupto da animação.

## 7. Ordem e entrega das notificações

O servidor deve processar a fila de notificações de uma conexão de escuta em
ordem. Não deve iniciar uma Promise independente para cada notificação se isso
permitir que `hit` ultrapasse `action:started`.

A ordem mínima esperada para uma ação é:

```text
action:queued
action:started
hit 1
hit 2
...
action:completed
```

Mesmo assim, o cliente deve ser resiliente:

- um `hit` sem o plano da ação deve aguardar brevemente ou ser armazenado;
- o evento deve conter dados suficientes para atualizar a célula;
- a reconexão deve substituir estado antigo por snapshot atual;
- duplicatas devem ser ignoradas por chave idempotente.

## 8. Mudanças previstas no servidor

### Fase S1 — consolidar o plano persistido

- Garantir que a ação armazene todos os parâmetros visuais necessários.
- Garantir que `executeAt`, `completesAt`, `count`, `staggerMs` e `durationMs`
  sejam derivados da mesma versão da regra.
- Manter `ruleSnapshot` imutável.

**Por quê:** o cliente não pode descobrir depois que a ação tinha outro número
de projéteis ou outra duração.

### Fase S2 — separar criação, execução e notificação

- POST cria e responde sem esperar o worker.
- Worker processa ações vencidas independentemente de clientes conectados.
- Notificação é publicada depois do commit da transação.
- Worker usa lock e transações curtas.

**Por quê:** uma aba fechada não pode impedir a conclusão da ação.

### Fase S3 — publicar o plano completo no início

- `action:started` deve trazer todos os dados necessários para animar.
- O cliente não deve precisar buscar novamente a ação para descobrir o plano.
- Manter `hit` como confirmação individual.

**Por quê:** reduz corridas entre consulta de ação e eventos de hit.

### Fase S4 — corrigir ordenação do realtime

- Serializar o tratamento das notificações PostgreSQL.
- Garantir que notificações do mesmo canal sejam enviadas em commit order.
- Registrar logs com `actionId`, tipo, `hitIndex` e `stateVersion`.

**Por quê:** entrega fora de ordem era capaz de iniciar a ação depois que o hit
já havia sido recebido.

### Fase S5 — snapshot como recuperação

- Snapshot sempre retorna estado atual.
- Não retornar ações concluídas para animação.
- Retornar ações ativas com horário e progresso atuais.
- Usar `stateVersion` para rejeitar estados antigos.

**Por quê:** reconexão não pode transformar histórico em fila visual.

## 9. Mudanças previstas no cliente

### Fase C1 — criar a animação pelo plano

- Ao receber `action:started`, criar o plano visual inteiro.
- Agendar projéteis pela linha do tempo do servidor.
- Não bloquear o emissor esperando remoção de projéteis confirmados.
- Substituir limites que geram pausas por controle visual que não dependa do
  worker.

**Por quê:** a latência de banco/WebSocket não pode virar pausa na animação.

### Fase C2 — usar `hitAt` como marco do impacto

- Converter `hitAt` do servidor para o relógio local.
- Mostrar o impacto no horário planejado.
- Se o evento chegar atrasado, aplicar a confirmação imediatamente sem reiniciar
  o projétil.
- Se o evento chegar antes, aguardar o horário planejado.

**Por quê:** o impacto deve acompanhar a linha do tempo da ação, não a latência
da rede.

### Fase C3 — unificar o commit visual de cada hit

Uma função central deve receber um hit confirmado e executar, em conjunto:

```text
aplicar value autoritativo
registrar hitIndex renderizado
atualizar percentual
iniciar impacto
finalizar o projétil correspondente
animar o novo raio
```

Não devem existir caminhos independentes que atualizem somente `dataset`,
somente `hitCount` ou somente `impactsRef`.

**Por quê:** esses caminhos independentes causaram célula crescendo sem
percentual e percentual avançando sem impacto.

### Fase C4 — snapshots não interrompem efeitos

- Não remover projéteis de ações concluídas até seus últimos frames terminarem.
- Não apagar uma ação ativa só porque ela não aparece momentaneamente em um
  snapshot intermediário.
- Ao reconectar, limpar somente efeitos que não pertencem mais a ações ativas
  ou que excederam o prazo visual.

**Por quê:** o snapshot é uma correção de estado, não um comando para cortar o
Canvas no meio de uma animação.

### Fase C5 — célula e alvo sempre dinâmicos

- Resolver posição atual do círculo a cada frame.
- Resolver raio atual a cada frame.
- Manter apenas o ponto inicial e o deslocamento do arco no projétil.
- Fazer impacto acompanhar a célula durante a transição.
- Remover projéteis expirados por segurança.

**Por quê:** o layout reposiciona células quando seus tamanhos mudam. Coordenadas
capturadas no disparo ficam obsoletas imediatamente.

## 10. Banco de dados e idempotência

Os eventos de hit devem continuar sendo idempotentes por ação e sequência:

```text
(actionId, sequence)
```

Regras:

- inserir hit duplicado não pode aplicar o delta duas vezes;
- atualização da célula e inserção do hit devem estar na mesma transação;
- incremento de `stateVersion` deve ocorrer junto da atualização da célula;
- conclusão só pode ocorrer uma vez;
- reprocessamento após deadlock deve ser seguro.

Não é necessário criar uma tabela de “progresso enviado pelo cliente”. O banco
já registra o progresso real por meio dos eventos produzidos pelo servidor.

## 11. Telemetria opcional

Se o produto precisar saber quem realmente viu uma ação, isso deve ser separado
do estado do jogo:

```ts
{
  actionId,
  sessionId,
  visibleAt,
  animationStartedAt,
  disconnectedAt
}
```

Essa telemetria:

- não altera o valor da célula;
- não altera `hitCount`;
- não confirma conclusão;
- pode ser perdida sem afetar o produto;
- deve ter retenção própria e limites de volume.

## 12. Estratégia de implantação

### Etapa 1 — instrumentação

Antes de alterar o comportamento principal, adicionar logs e métricas para:

- criação da ação;
- início;
- cada hit persistido;
- cada hit publicado;
- cada hit recebido;
- cada hit renderizado;
- snapshot aplicado;
- ação removida do HUD;
- quantidade de projéteis ativos;
- idade do projétil mais antigo.

Cada registro deve conter `actionId`, `hitIndex`, `stateVersion` e timestamp.

**Critério:** conseguir distinguir atraso do worker, atraso do WebSocket,
descarte por deduplicação e erro de renderização.

### Etapa 2 — plano completo e ordem realtime

Implementar o contrato completo de `action:started` e a fila sequencial de
notificações no servidor.

**Critério:** todos os clientes recebem o plano antes dos hits da ação.

### Etapa 3 — animação independente do worker

Alterar o Canvas para criar projéteis com base no cronograma da ação, sem
depender do `hit` para liberar o próximo.

**Critério:** atrasar artificialmente a publicação dos hits não pode parar o
fluxo de projéteis.

### Etapa 4 — confirmação centralizada

Criar um único caminho de commit visual do hit e remover atualizações paralelas
que alterem célula, HUD ou impacto separadamente.

**Critério:** cada `actionId + hitIndex` gera no máximo um commit visual.

### Etapa 5 — reconexão e snapshot

Implementar a política de reset:

- snapshot atual substitui estado histórico;
- ações concluídas não são reproduzidas;
- ações ativas continuam apenas do ponto atual;
- fila visual antiga é descartada.

**Critério:** reconectar após 1 minuto, 24 horas ou vários dias nunca gera uma
fila proporcional ao número de eventos históricos.

### Etapa 6 — remoção do comportamento antigo

Depois dos testes, remover:

- dependência do worker para destravar a emissão;
- deduplicação baseada somente em `hitCount` de snapshot;
- limpeza de efeitos por snapshots intermediários;
- qualquer cálculo de conclusão baseado em dados enviados pelo cliente.

## 13. Testes obrigatórios

### Testes do servidor

- criar ação idempotente;
- processar duas ações concorrentes para a mesma célula;
- repetir transação após deadlock;
- impedir delta duplicado;
- concluir ação exatamente uma vez;
- publicar evento somente depois do commit;
- manter ordem de `started`, `hit` e `completed`;
- devolver snapshot consistente após milhares de eventos.

### Testes do cliente

- ação com um hit;
- ação com muitos hits;
- dois clientes simultâneos;
- atraso de 100 ms, 1 s e 5 s no evento `hit`;
- evento duplicado;
- evento fora de ordem;
- snapshot chegando antes do hit;
- hit chegando antes de `action:started`;
- célula mudando de tamanho durante o voo;
- célula sendo reposicionada durante o voo;
- filtro escondendo o alvo;
- ação concluindo enquanto o impacto ainda está visível;
- reconexão durante o primeiro hit;
- reconexão no meio da ação;
- cliente offline quando a ação termina;
- cliente offline por vários dias;
- WebSocket fechado durante uma ação.

### Critérios visuais

Para cada hit renderizado:

```text
1 impacto visual
1 avanço de percentual
1 atualização de valor
1 transição de raio
1 projétil encerrado
```

Não deve existir:

- célula crescendo sem impacto quando o cliente está acompanhando a ação;
- percentual avançando sem hit visual;
- projétil estacionado indefinidamente;
- ação alternando entre parado e executando por atraso de rede;
- replay de ações históricas após reconexão longa.

## 14. Critérios de aceite da implantação

A implantação será considerada concluída quando:

1. o POST retorna sem esperar a execução completa;
2. a ação publicada contém o plano visual inteiro;
3. o cliente anima continuamente mesmo com atraso nos hits;
4. cada hit confirmado atualiza célula, percentual e impacto pelo mesmo caminho;
5. snapshots não cortam efeitos ativos;
6. projéteis e impactos acompanham a célula em movimento;
7. ações antigas não são reproduzidas após períodos offline;
8. ações ainda ativas são retomadas somente no trecho restante;
9. o servidor conclui ações mesmo sem clientes conectados;
10. múltiplos clientes convergem para o mesmo valor e estado;
11. uma notificação duplicada não duplica o efeito;
12. uma perda de WebSocket não deixa efeitos presos;
13. logs permitem identificar qualquer divergência;
14. typecheck, build, testes de integração e testes visuais passam.

## 15. Riscos e respostas

### O cliente anima antes da confirmação do servidor

Isso pode produzir um efeito antecipado se o worker falhar. A resposta é:

- usar o plano persistido pelo servidor;
- cancelar a ação se o servidor publicar `cancelled`;
- corrigir o valor pelo evento ou snapshot;
- nunca permitir que a animação altere a autoridade do servidor.

### O cliente recebe snapshot durante uma ação

O snapshot deve corrigir o estado autoritativo, mas não apagar a identidade
visual da ação. A transição visual deve ser separada da reconciliação.

### O WebSocket fica muito atrasado

Não acumular uma fila infinita. Quando o cliente estiver atrasado além do limite:

1. descartar efeitos efêmeros;
2. reconectar;
3. receber snapshot atual;
4. retomar somente ações ativas.

### Muitos clientes simultâneos

O servidor deve continuar enviando notificações compactas e o worker deve
processar o banco em transações curtas. O cliente nunca deve ser necessário
para o worker continuar.

## 16. Resumo da arquitetura final

```text
                    ┌──────────────────────┐
                    │      Cliente         │
                    │                      │
                    │ plano visual         │
                    │ relógio sincronizado  │
                    │ projéteis/impactos   │
                    └──────────┬───────────┘
                               │
                 realtime: plano, hits, snapshot
                               │
                    ┌──────────▼───────────┐
                    │       Servidor       │
                    │                      │
                    │ valida ação          │
                    │ processa cronograma  │
                    │ atualiza células     │
                    │ grava eventos        │
                    │ conclui ação         │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │      PostgreSQL      │
                    │                      │
                    │ ações                │
                    │ eventos de hit       │
                    │ células              │
                    │ stateVersion         │
                    └──────────────────────┘
```

Regra final:

> O servidor decide o que aconteceu. O cliente decide como desenhar o que está
> acontecendo. O snapshot sincroniza o presente; ele nunca transforma o
> histórico perdido em uma fila infinita de animações.