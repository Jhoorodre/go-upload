# Estrutura de JSON Individual por Obra

## Objetivo
Garantir que cada manga tenha seu próprio arquivo JSON com metadados completos, facilitando:
- Upload individual para GitHub
- Edição de metadados específicos por obra
- Manutenção independente de cada série

## Estrutura de Diretórios
```
manga_library/
├── kagurabachi/
│   ├── metadata.json          # ← JSON individual da obra
│   ├── chapter_001/
│   │   ├── page_01.jpg
│   │   └── page_02.jpg
│   └── chapter_002/
│       ├── page_01.jpg
│       └── page_02.jpg
├── gachiakuta/
│   ├── metadata.json          # ← JSON individual da obra
│   ├── chapter_001/
│   └── chapter_002/
└── mushoku/
    ├── metadata.json          # ← JSON individual da obra
    └── chapter_001/
```

## Formato do JSON Individual (metadata.json)

### Exemplo para Kagurabachi:
```json
{
  "title": "Kagurabachi",
  "description": "Chihiro busca vingança com a ajuda das lâminas encantadas forjadas por seu pai.",
  "artist": "Takeru Hokazono",
  "author": "Takeru Hokazono", 
  "cover": "https://placehold.co/200x300/1f2937/9ca3af?text=Kagurabachi",
  "status": "Em Andamento",
  "chapters": {
    "001": {
      "title": "Capítulo 1",
      "volume": "1",
      "last_updated": "2024-01-15T10:30:00Z",
      "groups": {
        "scan_group": [
          "https://catbox.moe/c/abc123.jpg",
          "https://catbox.moe/c/def456.jpg"
        ]
      }
    },
    "002": {
      "title": "Capítulo 2", 
      "volume": "1",
      "last_updated": "2024-01-16T14:45:00Z",
      "groups": {
        "scan_group": [
          "https://catbox.moe/c/ghi789.jpg",
          "https://catbox.moe/c/jkl012.jpg"
        ]
      }
    }
  }
}
```

## Fluxo de Geração de JSON Individual

### 1. Durante o Upload (Botão UPLOAD)
- Arquivos são agrupados por `mangaId`
- Para cada `mangaId` único:
  1. Coleta metadados da obra (título, autor, etc.)
  2. Agrupa arquivos por capítulo
  3. Gera JSON individual no formato acima
  4. Salva em `manga_library/{mangaId}/metadata.json`

### 2. WebSocket Messages

#### Requisição (Frontend → Backend):
```json
{
  "action": "batch_upload",
  "includeJSON": true,
  "generateIndividualJSONs": true,
  "mangaList": ["kagurabachi", "gachiakuta", "mushoku"],
  "files": [
    {
      "manga": "Kagurabachi",
      "mangaId": "kagurabachi", 
      "chapter": 1,
      "fileName": "page_01.jpg",
      "fileSize": 1024000
    }
  ]
}
```

#### Respostas (Backend → Frontend):
```json
// Quando JSON é gerado para uma obra
{
  "status": "json_generated",
  "mangaId": "kagurabachi", 
  "mangaTitle": "Kagurabachi",
  "jsonPath": "manga_library/kagurabachi/metadata.json"
}

// Quando JSON é finalizado 
{
  "status": "json_complete",
  "mangaId": "kagurabachi",
  "mangaTitle": "Kagurabachi"
}
```

### 3. Logs Esperados no Frontend
```
INFO: Iniciando upload em lote: 25 arquivos de 3 obra(s)
INFO: 📚 Kagurabachi: 12 arquivos, 2 capítulo(s) → JSON individual será gerado
INFO: 📚 Gachiakuta: 8 arquivos, 1 capítulo(s) → JSON individual será gerado  
INFO: 📚 Mushoku Tensei: 5 arquivos, 1 capítulo(s) → JSON individual será gerado
INFO: 🚀 Upload iniciado: cada obra terá seu JSON individual em manga_library/{mangaId}/metadata.json
INFO: JSON gerado: Kagurabachi → manga_library/kagurabachi/metadata.json
SUCCESS: JSON concluído: Kagurabachi - metadados atualizados
SUCCESS: Upload concluído: page_01.jpg
```

## Benefícios

1. **Separação Clara**: Cada obra tem seu próprio arquivo JSON
2. **Upload Seletivo**: GitHub pode fazer upload apenas de obras específicas
3. **Manutenção Independente**: Editar uma obra não afeta outras
4. **Escalabilidade**: Fácil adicionar/remover obras sem impacto
5. **Rastreabilidade**: Logs específicos por obra
6. **Flexibilidade**: Diferentes grupos de scan por obra

## Validação

### Frontend deve validar:
- [x] Cada `mangaId` único tem arquivos agrupados corretamente
- [x] JSON é gerado no formato esperado
- [x] Logs mostram progresso por obra individual
- [x] WebSocket envia lista de `mangaIds` únicos

### Backend deve implementar:
- [ ] Processamento individual por `mangaId`  
- [ ] Geração de JSON no formato especificado
- [ ] Salvamento em `manga_library/{mangaId}/metadata.json`
- [ ] Resposta com status `json_generated` e `json_complete`