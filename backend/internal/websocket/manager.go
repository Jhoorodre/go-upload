package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Message representa uma mensagem WebSocket
type Message struct {
	Action      string      `json:"action"`
	Data        interface{} `json:"data,omitempty"`
	Payload     interface{} `json:"payload,omitempty"`
	RequestID   string      `json:"requestId,omitempty"`
	ConnectionID string     `json:"connectionId,omitempty"`
}

// Response representa uma resposta WebSocket
type Response struct {
	Status      string      `json:"status"`
	Data        interface{} `json:"data,omitempty"`
	Error       string      `json:"error,omitempty"`
	RequestID   string      `json:"requestId,omitempty"`
	Progress    *Progress   `json:"progress,omitempty"`
	File        string      `json:"file,omitempty"`
	URL         string      `json:"url,omitempty"`
	Payload     interface{} `json:"payload,omitempty"`
	Metadata    interface{} `json:"metadata,omitempty"`
	
	// JSON generation fields
	MangaID     string      `json:"mangaId,omitempty"`
	MangaTitle  string      `json:"mangaTitle,omitempty"`
	JSONPath    string      `json:"jsonPath,omitempty"`
}

// Progress representa informações de progresso
type Progress struct {
	Current     int    `json:"current"`
	Total       int    `json:"total"`
	Percentage  int    `json:"percentage"`
	CurrentFile string `json:"currentFile,omitempty"`
	Stage       string `json:"stage,omitempty"`
}

// Connection representa uma conexão WebSocket gerenciada
type Connection struct {
	ID           string
	conn         *websocket.Conn
	send         chan Response
	manager      *Manager
	ctx          context.Context
	cancel       context.CancelFunc
	lastPing     time.Time
	LastActivity time.Time // Adicionado para massive_manager
	mu           sync.RWMutex
	wg           sync.WaitGroup
}

// Manager gerencia múltiplas conexões WebSocket
type Manager struct {
	connections map[string]*Connection
	register    chan *Connection
	unregister  chan *Connection
	broadcast   chan Response
	handlers    map[string]MessageHandler
	mu          sync.RWMutex
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

// MessageHandler define o tipo de handler para mensagens
type MessageHandler func(conn *Connection, msg Message) error

// NewManager cria um novo gerenciador de WebSocket
func NewManager() *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	
	manager := &Manager{
		connections: make(map[string]*Connection),
		register:    make(chan *Connection, 100),
		unregister:  make(chan *Connection, 100),
		broadcast:   make(chan Response, 1000),
		handlers:    make(map[string]MessageHandler),
		ctx:         ctx,
		cancel:      cancel,
	}
	
	// Iniciar o loop principal do gerenciador
	manager.wg.Add(1)
	go manager.run()
	
	return manager
}

// RegisterHandler registra um handler para uma ação específica
func (m *Manager) RegisterHandler(action string, handler MessageHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.handlers[action] = handler
}

// NewConnection cria uma nova conexão gerenciada
func (m *Manager) NewConnection(conn *websocket.Conn, connectionID string) *Connection {
	ctx, cancel := context.WithCancel(m.ctx)
	
	connection := &Connection{
		ID:           connectionID,
		conn:         conn,
		send:         make(chan Response, 256),
		manager:      m,
		ctx:          ctx,
		cancel:       cancel,
		lastPing:     time.Now(),
		LastActivity: time.Now(), // Inicializar LastActivity
	}
	
	// Registrar conexão
	m.register <- connection
	
	// Iniciar goroutines para leitura e escrita
	connection.wg.Add(2)
	go connection.writePump()
	go connection.readPump()
	
	return connection
}

// run executa o loop principal do gerenciador
func (m *Manager) run() {
	defer m.wg.Done()
	
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case conn := <-m.register:
			m.mu.Lock()
			m.connections[conn.ID] = conn
			m.mu.Unlock()
			log.Printf("WebSocket connection registered: %s", conn.ID)
			
		case conn := <-m.unregister:
			m.mu.Lock()
			if _, ok := m.connections[conn.ID]; ok {
				delete(m.connections, conn.ID)
				close(conn.send)
			}
			m.mu.Unlock()
			log.Printf("WebSocket connection unregistered: %s", conn.ID)
			
		case response := <-m.broadcast:
			m.mu.RLock()
			for _, conn := range m.connections {
				select {
				case conn.send <- response:
				default:
					// Canal de envio está cheio, remover conexão
					delete(m.connections, conn.ID)
					close(conn.send)
				}
			}
			m.mu.RUnlock()
			
		case <-ticker.C:
			// Verificar conexões inativas
			m.cleanupInactiveConnections()
			
		case <-m.ctx.Done():
			return
		}
	}
}

// SendToConnection envia uma resposta para uma conexão específica
func (m *Manager) SendToConnection(connectionID string, response Response) error {
	m.mu.RLock()
	conn, exists := m.connections[connectionID]
	m.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("connection not found: %s", connectionID)
	}
	
	select {
	case conn.send <- response:
		return nil
	case <-time.After(5 * time.Second):
		return fmt.Errorf("timeout sending to connection: %s", connectionID)
	}
}

// Broadcast envia uma resposta para todas as conexões
func (m *Manager) Broadcast(response Response) {
	select {
	case m.broadcast <- response:
	default:
		log.Printf("Broadcast channel full, dropping message")
	}
}

// GetConnectionCount retorna o número de conexões ativas
func (m *Manager) GetConnectionCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.connections)
}

// cleanupInactiveConnections remove conexões inativas
func (m *Manager) cleanupInactiveConnections() {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	now := time.Now()
	for id, conn := range m.connections {
		conn.mu.RLock()
		lastPing := conn.lastPing
		conn.mu.RUnlock()
		
		if now.Sub(lastPing) > 60*time.Second {
			delete(m.connections, id)
			conn.cancel()
			close(conn.send)
			log.Printf("Removed inactive connection: %s", id)
		}
	}
}

// Close fecha o gerenciador e todas as conexões
func (m *Manager) Close() {
	m.cancel()
	
	m.mu.Lock()
	for _, conn := range m.connections {
		conn.cancel()
		close(conn.send)
	}
	m.mu.Unlock()
	
	m.wg.Wait()
	
	close(m.register)
	close(m.unregister)
	close(m.broadcast)
}

// Connection methods

// readPump gerencia a leitura de mensagens da conexão
func (c *Connection) readPump() {
	defer func() {
		c.wg.Done()
		c.manager.unregister <- c
		c.conn.Close()
	}()
	
	c.conn.SetReadLimit(512 * 1024) // 512KB limit per message
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.mu.Lock()
		c.lastPing = time.Now()
		c.mu.Unlock()
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	
	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			_, messageBytes, err := c.conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket error: %v", err)
				}
				return
			}
			
			var msg Message
			if err := json.Unmarshal(messageBytes, &msg); err != nil {
				log.Printf("JSON unmarshal error: %v", err)
				continue
			}
			
			// LOG DETALHADO DE TODAS AS MENSAGENS
			log.Printf("🔍 WebSocket: Mensagem recebida - Action: %s, RequestID: %s, Raw: %s", msg.Action, msg.RequestID, string(messageBytes))
			
			// Atualizar LastActivity quando receber mensagem
			c.mu.Lock()
			c.LastActivity = time.Now()
			c.mu.Unlock()
			
			msg.ConnectionID = c.ID
			
			// Log para debug de handlers da AniList
			if msg.Action == "get_anilist_config" {
				log.Printf("🔧 WebSocket: Recebida ação get_anilist_config - RequestID: %s", msg.RequestID)
			}
			
			// Executar handler da mensagem
			c.manager.mu.RLock()
			handler, exists := c.manager.handlers[msg.Action]
			c.manager.mu.RUnlock()
			
			if exists {
				if msg.Action == "get_anilist_config" {
					log.Printf("🔧 WebSocket: Handler encontrado para get_anilist_config")
				}
				go func(msg Message) {
					if err := handler(c, msg); err != nil {
						response := Response{
							Status:    "error",
							Error:     err.Error(),
							RequestID: msg.RequestID,
						}
						c.send <- response
					}
				}(msg)
			} else {
				log.Printf("No handler found for action: %s", msg.Action)
				if msg.Action == "get_anilist_config" {
					log.Printf("🔧 WebSocket: ERRO - Handler NÃO encontrado para get_anilist_config!")
				}
			}
		}
	}
}

// writePump gerencia o envio de mensagens para a conexão
func (c *Connection) writePump() {
	defer func() {
		c.wg.Done()
		c.conn.Close()
	}()
	
	ticker := time.NewTicker(54 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case response, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			
			if err := c.conn.WriteJSON(response); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
			
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
			
		case <-c.ctx.Done():
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			c.conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}
	}
}

// Send envia uma resposta para esta conexão
func (c *Connection) Send(response Response) error {
	// Verificar se o contexto ainda está ativo
	select {
	case <-c.ctx.Done():
		return c.ctx.Err()
	default:
	}
	
	// Tentar enviar com timeout e verificação de contexto
	select {
	case c.send <- response:
		return nil
	case <-time.After(5 * time.Second):
		return fmt.Errorf("timeout sending response")
	case <-c.ctx.Done():
		return c.ctx.Err()
	}
}

// Close fecha a conexão
func (c *Connection) Close() {
	c.cancel()
	c.wg.Wait()
}