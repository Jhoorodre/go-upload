# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão Geral do Projeto

Aplicação de upload de mangás com duas partes principais:
- **Backend**: Servidor Go usando WebSockets para comunicação em tempo real, localizado em `backend/`
- **Frontend**: Aplicação Next.js 15 com React 19, localizada em `frontend/`

O aplicativo permite aos usuários selecionar pastas do navegador, descobrir a estrutura hierárquica (agregador/scan/obra/capítulo) e fazer upload de imagens para vários serviços de hospedagem.

## Comandos de Desenvolvimento

### Backend (Go)
```bash
# Do diretório backend/
go mod download         # Instalar dependências
go run main.go          # Executar servidor de desenvolvimento na porta :8080
go build               # Construir binário
go test ./test -v       # Executar testes específicos
./backend/test/run_tests.sh  # Executar suite completa de testes
```

### Frontend (Next.js)
```bash
# Do diretório frontend/
npm install            # Instalar dependências
npm run dev            # Executar servidor de desenvolvimento na porta :3000
npm run build          # Construir para produção
npm run start          # Iniciar servidor de produção
npm run lint           # Executar ESLint
npx tsc --noEmit       # Verificação de tipos TypeScript
```

### Testes
```bash
# Backend - do diretório backend/
go test -v ./test -run TestUpdateModes        # Testar modos de atualização
go test -v ./test -run TestCompleteWorkflow   # Testar workflow completo
./test/run_tests.sh                           # Suite completa de testes

# Frontend - do diretório frontend/
npm run lint           # Linting com ESLint
npx tsc --noEmit       # Verificação de tipos
```

## Arquitetura

### Sistema de Descoberta e Upload
1. **Seleção de Pasta**: Frontend permite seleção de pastas via `webkitdirectory`
2. **Descoberta**: Backend analisa estrutura em `manga_library/[basePath]` usando `discoverStructureV2()`
3. **Visualização**: Frontend renderiza árvore hierárquica com `LibraryTree` component
4. **Upload**: Arquivos são codificados em Base64 e enviados via WebSocket

### Comunicação WebSocket
Endpoint `/ws` no backend com duas ações principais:

**Descoberta de Estrutura:**
```json
{
  "action": "discover",
  "basePath": "nome-da-pasta"
}
```

**Upload de Arquivo:**
```json
{
  "action": "upload",
  "host": "catbox",
  "manga": "titulo",
  "chapter": "numero",
  "fileName": "arquivo.jpg",
  "fileContent": "dados-base64"
}
```

**Respostas do Servidor:**
```json
{
  "status": "discover_complete|complete|error",
  "payload": { /* estrutura hierárquica */ },
  "file": "arquivo.jpg",
  "url": "https://...",
  "error": "mensagem de erro"
}
```

### Componentes Backend

#### Core Server (main.go:2652 linhas)
- **HighPerformanceServer**: Servidor principal com gerenciamento de WebSocket, upload em lote, descoberta concorrente
- **ServerConfig**: Configuração com MaxWorkers (100), MaxConnections (1000), DiscoveryWorkers (20)
- **Constantes**: LIBRARY_ROOT="manga_library", SERVER_PORT=":8080"

#### Módulos Internos
- **discovery/concurrent.go**: Descoberta concorrente de estruturas de diretório
- **upload/batch.go**: Sistema de upload em lotes com workers
- **websocket/manager.go**: Gerenciamento de conexões WebSocket em massa
- **anilist/**: Integração com AniList API incluindo circuit breakers e rate limiting
- **monitoring/**: Métricas avançadas e monitoramento
- **workstealing/**: Pool de workers com work stealing
- **metadata/json_generator.go**: Geração automática de metadados JSON

#### Uploaders
- **catbox.go**: Implementação completa com circuit breaker, outros hosts retornam URLs mock
- **Circuit Breaker**: Prevenção de falhas em cascata com estados Closed/Open/HalfOpen

### Estrutura Frontend

#### Tecnologias
- **Next.js 15** com App Router
- **React 19** com hooks modernos
- **TypeScript** com configuração strict
- **TailwindCSS 4** para estilização
- **Framer Motion** para animações
- **ESLint** com config Next.js

#### Componentes Principais
- **AppProvider/AppContext**: Estado global da aplicação
- **LibraryPage**: Visualização da estrutura de diretórios
- **ProgressDashboard**: Dashboard de progresso de uploads
- **MangaDetailPage**: Detalhes específicos de manga
- **ControlSidebar**: Controles e configurações

### Processamento de Arquivos
- **Extensões Suportadas**: .avif, .jpg, .jpeg, .png, .webp, .bmp, .tiff
- **Estrutura**: Agregador/Scan/Obra/Capítulo com chave especial `_files` para imagens
- **Upload**: Catbox totalmente implementado, outros hosts retornam URLs mock
- **Segurança**: Arquivos temporários são criados e removidos após upload

### Integrações Externas
- **AniList API**: Busca de metadados de manga com rate limiting e circuit breakers
- **GitHub**: Integração para versionamento e backup
- **Catbox**: Serviço de hospedagem de imagens

## Arquivos-Chave
- `backend/main.go`: Servidor WebSocket, descoberta de estrutura e orquestração de upload (2652 linhas)
- `backend/uploaders/catbox.go`: Implementação específica do Catbox com circuit breaker
- `backend/internal/`: Módulos especializados para descoberta, upload, WebSocket, monitoramento
- `frontend/app/page.tsx`: Interface principal com seleção de pasta e árvore interativa
- `frontend/contexts/AppContext.tsx`: Estado global da aplicação
- Constante `LIBRARY_ROOT = "manga_library"`: Diretório raiz para todas as scans

## Configurações de Desenvolvimento
- Go 1.23.0+ com toolchain 1.24.6
- Dependências Go: gorilla/websocket, shurcooL/graphql, wabarc/go-catbox
- Node.js com npm para frontend
- ESLint configurado com next/core-web-vitals e next/typescript
- TypeScript em modo strict com resolução bundler

## Instruções Especiais
- ASCII e UTF-8
- Não crie várias versões de vários arquivos, apenas atualize os que existem
- Responda apenas em pt-BR
- Arquivos para testes ficam na pasta "test"
- Mantenha os arquivos organizados em pastas
- Sempre use os Agents apropriados para cada trabalho de forma automática
- Não gosto de ícones
- Sempre quando eu fizer uma pergunta, primeiro me responda antes de fazer qualquer coisa. Eu não autorizo qualquer alteração no código sem antes me explicar, e só após minha confirmação o código será alterado.
- Sempre após analisar o código faça duas coisas: Primeiro: Me explique detalhadamente o que será feito, Segundo: Qual o resultado esperado da implementação.
- Nunca faça algo sem minha autorização
- Nunca faça algo sem que eu tenha pedido antes
