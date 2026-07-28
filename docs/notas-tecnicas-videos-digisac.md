# Notas técnicas das aulas Digisac

> Este documento é uma síntese técnica, não uma transcrição literal. Os quatro
> vídeos indicados não disponibilizam legendas no YouTube. Os campos e rotas
> abaixo foram conferidos na coleção pública da API Digisac associada às aulas.

## Referências

| Aula | Duração | Foco |
| --- | ---: | --- |
| [Envio de arquivos](https://www.youtube.com/watch?v=zAtg8CgBAAA) | 11:11 | imagem, PDF e áudio pelo endpoint de mensagens |
| [Envio de mensagens](https://www.youtube.com/watch?v=Tauj8Rm3phE) | 8:57 | texto para contato existente ou número novo |
| [Envio de HSM](https://www.youtube.com/watch?v=ZOymWVLef2U) | 15:33 | templates WhatsApp e parâmetros |
| [Webhook](https://www.youtube.com/watch?v=CWbqX2r97oQ) | 12:32 | cadastro de eventos e acionamento de bot |

Documentação usada: [coleção Digisac](https://documenter.getpostman.com/view/24605757/2sA3BhfaDg).

## 1. Autenticação e instância de atendimento

As requisições da coleção usam autenticação `Bearer` com token da conta. A
linha/conexão Digisac é identificada por `serviceId`. No CRM, o mapeamento é:

```text
Digisac serviceId  →  whatsapp_instances.id
Digisac token      →  segredo de servidor da instância (não expor ao navegador)
```

Antes de enviar ou importar qualquer conversa, listar as conexões em
`GET /api/v1/services` e relacionar cada uma a uma instância Digisac no CRM.
Não usar o mesmo token como se fosse uma credencial Meta oficial.

## 2. Envio de mensagens

O endpoint de saída é `POST /api/v1/messages`.

### Contato já existente no Digisac

O payload usa `contactId`, texto, `type: "chat"`, opcionalmente `userId`, e
origem (`bot` ou `user`).

```json
{
  "text": "Olá, Maria!",
  "type": "chat",
  "contactId": "<id-do-contato-digisac>",
  "userId": "<id-do-atendente-digisac>",
  "origin": "user"
}
```

### Número ainda não cadastrado

O mesmo endpoint aceita `number` e `serviceId` no lugar de `contactId`.

```json
{
  "text": "Olá!",
  "type": "chat",
  "serviceId": "<id-da-conexao>",
  "number": "5511999999999",
  "userId": "<id-do-atendente>",
  "origin": "user"
}
```

Há também `dontOpenTicket: true` para envio que não abre chamado. No CRM essa
opção deve virar um parâmetro explícito de envio. Ela não deve ser aplicada por
padrão, porque o atendimento comercial normalmente precisa de uma conversa
ativa para ser acompanhado.

### Impacto no CRM

- Direcionar o envio conforme `whatsapp_instances.provider`. Para `digisac`,
  usar o adaptador Digisac; para `official`, manter o cliente Meta atual.
- Normalizar o número antes da chamada e registrar o `messageId` devolvido como
  identificador externo com prefixo do provedor/linha.
- Criar a mensagem local primeiro como pendente e atualizá-la após a resposta
  do Digisac; falhas não podem criar duplicatas quando a interface tentar de
  novo.
- `origin: bot` só será usado pelo motor de automação aprovado. Envios manuais
  devem preservar o atendente em `sent_by` e `origin: user`.

## 3. Envio de arquivos

Arquivos também usam `POST /api/v1/messages`. A coleção mostra o objeto
`file` com conteúdo Base64, MIME e, quando aplicável, nome do arquivo.

```json
{
  "text": "Segue o documento.",
  "number": "5511999999999",
  "serviceId": "<id-da-conexao>",
  "file": {
    "base64": "<conteudo-base64>",
    "mimetype": "application/pdf",
    "name": "documento.pdf"
  }
}
```

Exemplos da coleção: imagem com `image/jpeg`, PDF com `application/pdf` e
áudio com `audio/mpeg`.

### Regra de implementação

1. Receber o arquivo da interface apenas pelo servidor; validar tamanho e MIME.
2. Manter a cópia privada no Supabase Storage, com hash e caminho estável.
3. Converter para Base64 somente no worker de envio e somente para o Digisac.
4. Registrar no CRM a mídia, MIME, tamanho, hash, ID da mensagem e resultado.
5. Para histórico vindo do Digisac, baixar o binário e armazená-lo no bucket;
   nunca guardar somente uma URL temporária da origem.

Isso evita estouro de memória no endpoint Next.js e evita que um anexo antigo
fique inacessível quando o Digisac expirar ou desativar a URL.

## 4. HSM / templates WhatsApp Business

Templates são consultados em:

```text
GET /api/v1/whatsapp-business-templates?perPage=40
GET /api/v1/whatsapp-business-templates/<templateId>
POST /api/v1/whatsapp-business-templates/refresh-templates
POST /api/v1/whatsapp-business-templates/<hsmId>/send-to-review
```

O envio do template volta a usar `POST /api/v1/messages`. O conjunto mínimo é
`type: "chat"`, `number` ou `contactId`, `serviceId` quando necessário, e
`hsmId`. Parâmetros são agrupados por componente.

```json
{
  "type": "chat",
  "number": "5511999999999",
  "serviceId": "<id-da-conexao>",
  "hsmId": "<id-do-template>",
  "parameters": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Responsável" },
        { "type": "text", "text": "visita de terça-feira" }
      ]
    }
  ],
  "file": {}
}
```

Para botão URL, há outro bloco em `parameters` com `type: "button"`,
`sub_type: "url"`, `index` e o valor da rota. Logo, o CRM não deve guardar
somente o texto do HSM: ele precisa preservar componentes, quantidade e ordem
dos parâmetros, botões e o ID específico do provedor.

### Regra de implementação

- Importar templates Digisac em `message_templates`, mas acrescentar campos de
  provedor como `provider_template_id`, `provider`, status e estrutura JSON.
- Validar localmente os parâmetros exigidos antes do envio.
- Restringir HSM a instância Digisac/WhatsApp Business correspondente; um ID
  HSM não deve ser enviado pelo adaptador Meta atual.
- Sincronizar templates sob demanda e guardar a data da última sincronização.

## 5. Webhooks e bot

O Digisac permite criar e administrar webhooks nestas rotas:

```text
GET  /api/v1/me/webhooks?perPage=40
POST /api/v1/me/webhooks
GET  /api/v1/me/webhooks/<webhookId>
PUT  /api/v1/me/webhooks/<webhookId>
```

O exemplo de criação contém `active`, `name`, `url`, `events`, `type`, `userId`
e `accountId`. Entre os eventos exemplificados estão `message.created` e
`message.updated`.

```json
{
  "active": true,
  "name": "crm-colegio-leibniz",
  "url": "https://<dominio-do-crm>/api/digisac/webhook",
  "events": ["message.created", "message.updated"],
  "type": "general",
  "userId": "<id-do-usuario-digisac>",
  "accountId": "<id-da-conta-digisac>"
}
```

Também há um acionamento de flag de robô:

```text
POST /api/v1/bots/<botId>/trigger-signal/<contactId>?flag=<nome-da-flag>
```

### Regra de implementação

- Criar `POST /api/digisac/webhook` no CRM, com segredo exclusivo e validação
  da assinatura/autenticação que a conta Digisac disponibilizar.
- Registrar o payload bruto com um identificador idempotente antes do
  processamento. A resposta ao Digisac deve ser rápida; normalização e mídia
  seguem em segundo plano.
- Tratar `message.created` e `message.updated` desde o início. Eventos de
  ticket, transferência e fechamento serão adicionados após a descoberta do
  payload real da conta.
- Nunca acionar o bot em uma mensagem recebida sem regra de negócio explícita;
  a flag deve ser auditada com contato, bot, usuário e motivo.

## Checklist mínimo antes de produção

- [ ] token de servidor configurado fora do repositório;
- [ ] instância Digisac cadastrada e com envio desligado em homologação;
- [ ] teste de texto, imagem, PDF, áudio e HSM com parâmetros;
- [ ] webhook recebendo e deduplicando `message.created` e `message.updated`;
- [ ] status de entrega atualizado na mensagem local;
- [ ] cópia de mídia no Storage privado e acesso por URL assinada;
- [ ] importação histórica marcada para não disparar automações;
- [ ] reconciliação de mensagens/anexos concluída antes da virada.
