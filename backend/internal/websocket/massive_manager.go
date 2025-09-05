package websocket

import (
	"context"
	"fmt"
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// Enhanced WebSocket Manager for massive connections
type MassiveConnectionManager struct {
	connections     sync.Map // map[string]*Connection
	connectionPools sync.Map // map[string]*ConnectionPool
	messageQueue    chan *QueuedMessage
	metrics         *ConnectionMetrics
	config          *MassiveConfig
	ctx             context.Context
	cancel          context.CancelFunc
	workers         []*MessageWorker
}

type MassiveConfig struct {
	MaxConnections      int
	MaxMessageQueue     int
	WorkerCount         int
	HeartbeatInterval   time.Duration
	CleanupInterval     time.Duration
	MessageRateLimit    int // messages per second per connection
	BroadcastBatchSize  int
	EnableCompression   bool
	EnablePooling       bool
}

type ConnectionMetrics struct {
	TotalConnections    int64
	ActiveConnections   int64
	MessagesProcessed   int64
	MessageQueueLength  int64
	BytesSent          int64
	BytesReceived      int64
	ErrorCount         int64
	LastCleanup        time.Time
}

type QueuedMessage struct {
	ConnectionID string
	Message      *Message
	Priority     int
	Timestamp    time.Time
	Retries      int
}

type MessageWorker struct {
	id       int
	manager  *MassiveConnectionManager
	queue    chan *QueuedMessage
	stopCh   chan struct{}
	running  bool
}

type ConnectionPool struct {
	connections []*Connection
	roundRobin  int64
	mu          sync.RWMutex
}

func NewMassiveConnectionManager(config *MassiveConfig) *MassiveConnectionManager {
	ctx, cancel := context.WithCancel(context.Background())
	
	if config == nil {
		config = &MassiveConfig{
			MaxConnections:     10000,
			MaxMessageQueue:    100000,
			WorkerCount:        runtime.NumCPU() * 4,
			HeartbeatInterval:  30 * time.Second,
			CleanupInterval:    5 * time.Minute,
			MessageRateLimit:   100,
			BroadcastBatchSize: 1000,
			EnableCompression:  true,
			EnablePooling:      true,
		}
	}

	manager := &MassiveConnectionManager{
		messageQueue: make(chan *QueuedMessage, config.MaxMessageQueue),
		metrics:      &ConnectionMetrics{},
		config:       config,
		ctx:          ctx,
		cancel:       cancel,
	}

	// Initialize workers
	manager.workers = make([]*MessageWorker, config.WorkerCount)
	for i := 0; i < config.WorkerCount; i++ {
		worker := &MessageWorker{
			id:      i,
			manager: manager,
			queue:   make(chan *QueuedMessage, config.MaxMessageQueue/config.WorkerCount),
			stopCh:  make(chan struct{}),
		}
		manager.workers[i] = worker
		go worker.start()
	}

	// Start background routines
	go manager.heartbeatLoop()
	go manager.cleanupLoop()
	go manager.messageDispatcher()
	go manager.metricsLogger()

	log.Printf("🚀 MassiveConnectionManager initialized: %d workers, %d max connections", 
		config.WorkerCount, config.MaxConnections)

	return manager
}

func (mcm *MassiveConnectionManager) RegisterConnection(conn *Connection) error {
	if atomic.LoadInt64(&mcm.metrics.ActiveConnections) >= int64(mcm.config.MaxConnections) {
		return fmt.Errorf("connection limit reached: %d", mcm.config.MaxConnections)
	}

	mcm.connections.Store(conn.ID, conn)
	atomic.AddInt64(&mcm.metrics.ActiveConnections, 1)
	atomic.AddInt64(&mcm.metrics.TotalConnections, 1)

	// Add to pool if pooling is enabled
	if mcm.config.EnablePooling {
		mcm.addToPool(conn)
	}

	log.Printf("📡 Connection registered: %s (Total: %d)", 
		conn.ID, atomic.LoadInt64(&mcm.metrics.ActiveConnections))
	
	return nil
}

func (mcm *MassiveConnectionManager) UnregisterConnection(connectionID string) {
	if conn, exists := mcm.connections.LoadAndDelete(connectionID); exists {
		atomic.AddInt64(&mcm.metrics.ActiveConnections, -1)
		
		// Remove from pool
		if mcm.config.EnablePooling {
			mcm.removeFromPool(conn.(*Connection))
		}
		
		log.Printf("📡 Connection unregistered: %s (Remaining: %d)", 
			connectionID, atomic.LoadInt64(&mcm.metrics.ActiveConnections))
	}
}

func (mcm *MassiveConnectionManager) SendToConnection(connectionID string, message *Message, priority int) error {
	queuedMsg := &QueuedMessage{
		ConnectionID: connectionID,
		Message:      message,
		Priority:     priority,
		Timestamp:    time.Now(),
		Retries:      0,
	}

	select {
	case mcm.messageQueue <- queuedMsg:
		atomic.AddInt64(&mcm.metrics.MessageQueueLength, 1)
		return nil
	default:
		atomic.AddInt64(&mcm.metrics.ErrorCount, 1)
		return fmt.Errorf("message queue full")
	}
}

func (mcm *MassiveConnectionManager) BroadcastMessage(message *Message, filter func(*Connection) bool) {
	batch := []*Connection{}
	batchSize := 0

	mcm.connections.Range(func(key, value interface{}) bool {
		conn := value.(*Connection)
		if filter == nil || filter(conn) {
			batch = append(batch, conn)
			batchSize++
			
			// Send in batches to avoid blocking
			if batchSize >= mcm.config.BroadcastBatchSize {
				mcm.sendBatch(batch, message)
				batch = []*Connection{}
				batchSize = 0
			}
		}
		return true
	})

	// Send remaining batch
	if batchSize > 0 {
		mcm.sendBatch(batch, message)
	}
}

func (mcm *MassiveConnectionManager) sendBatch(connections []*Connection, message *Message) {
	for _, conn := range connections {
		mcm.SendToConnection(conn.ID, message, 1)
	}
}

func (mcm *MassiveConnectionManager) messageDispatcher() {
	for {
		select {
		case <-mcm.ctx.Done():
			return
		case queuedMsg := <-mcm.messageQueue:
			atomic.AddInt64(&mcm.metrics.MessageQueueLength, -1)
			
			// Distribute to workers by connection ID hash
			workerIndex := hash(queuedMsg.ConnectionID) % len(mcm.workers)
			
			select {
			case mcm.workers[workerIndex].queue <- queuedMsg:
			default:
				// Worker queue full, try next worker
				nextWorker := (workerIndex + 1) % len(mcm.workers)
				select {
				case mcm.workers[nextWorker].queue <- queuedMsg:
				default:
					atomic.AddInt64(&mcm.metrics.ErrorCount, 1)
					log.Printf("⚠️ Failed to dispatch message, all workers busy")
				}
			}
		}
	}
}

func (worker *MessageWorker) start() {
	worker.running = true
	defer func() { worker.running = false }()

	for {
		select {
		case <-worker.stopCh:
			return
		case queuedMsg := <-worker.queue:
			worker.processMessage(queuedMsg)
		}
	}
}

func (worker *MessageWorker) processMessage(queuedMsg *QueuedMessage) {
	if conn, exists := worker.manager.connections.Load(queuedMsg.ConnectionID); exists {
		connection := conn.(*Connection)
		
		if err := connection.Send(Response{
			Status: queuedMsg.Message.Action,
			Data:   queuedMsg.Message.Data,
			Payload: queuedMsg.Message.Payload,
		}); err != nil {
			atomic.AddInt64(&worker.manager.metrics.ErrorCount, 1)
			
			// Retry logic
			if queuedMsg.Retries < 3 {
				queuedMsg.Retries++
				time.AfterFunc(time.Duration(queuedMsg.Retries)*time.Second, func() {
					select {
					case worker.queue <- queuedMsg:
					default:
						// Give up
					}
				})
			}
		} else {
			atomic.AddInt64(&worker.manager.metrics.MessagesProcessed, 1)
		}
	}
}

func (mcm *MassiveConnectionManager) heartbeatLoop() {
	ticker := time.NewTicker(mcm.config.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-mcm.ctx.Done():
			return
		case <-ticker.C:
			mcm.sendHeartbeat()
		}
	}
}

func (mcm *MassiveConnectionManager) sendHeartbeat() {
	message := &Message{
		Action: "heartbeat",
		Data:   map[string]interface{}{"timestamp": time.Now().Unix()},
	}
	
	mcm.BroadcastMessage(message, func(conn *Connection) bool {
		return time.Since(conn.LastActivity) > mcm.config.HeartbeatInterval/2
	})
}

func (mcm *MassiveConnectionManager) cleanupLoop() {
	ticker := time.NewTicker(mcm.config.CleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-mcm.ctx.Done():
			return
		case <-ticker.C:
			mcm.cleanup()
		}
	}
}

func (mcm *MassiveConnectionManager) cleanup() {
	deadConnections := []string{}
	
	mcm.connections.Range(func(key, value interface{}) bool {
		conn := value.(*Connection)
		if time.Since(conn.LastActivity) > mcm.config.HeartbeatInterval*3 {
			deadConnections = append(deadConnections, conn.ID)
		}
		return true
	})
	
	for _, connID := range deadConnections {
		mcm.UnregisterConnection(connID)
	}
	
	mcm.metrics.LastCleanup = time.Now()
	
	if len(deadConnections) > 0 {
		log.Printf("🧹 Cleaned up %d dead connections", len(deadConnections))
	}
	
	// Force garbage collection if memory usage is high
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	if m.Alloc > 100*1024*1024 { // 100MB
		runtime.GC()
	}
}

func (mcm *MassiveConnectionManager) metricsLogger() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-mcm.ctx.Done():
			return
		case <-ticker.C:
			mcm.logMetrics()
		}
	}
}

func (mcm *MassiveConnectionManager) logMetrics() {
	log.Printf("📊 Massive WebSocket Metrics: Active=%d, Total=%d, Processed=%d, Queue=%d, Errors=%d", 
		atomic.LoadInt64(&mcm.metrics.ActiveConnections),
		atomic.LoadInt64(&mcm.metrics.TotalConnections),
		atomic.LoadInt64(&mcm.metrics.MessagesProcessed),
		atomic.LoadInt64(&mcm.metrics.MessageQueueLength),
		atomic.LoadInt64(&mcm.metrics.ErrorCount))
}

func (mcm *MassiveConnectionManager) GetMetrics() *ConnectionMetrics {
	return &ConnectionMetrics{
		TotalConnections:   atomic.LoadInt64(&mcm.metrics.TotalConnections),
		ActiveConnections:  atomic.LoadInt64(&mcm.metrics.ActiveConnections),
		MessagesProcessed:  atomic.LoadInt64(&mcm.metrics.MessagesProcessed),
		MessageQueueLength: atomic.LoadInt64(&mcm.metrics.MessageQueueLength),
		BytesSent:         atomic.LoadInt64(&mcm.metrics.BytesSent),
		BytesReceived:     atomic.LoadInt64(&mcm.metrics.BytesReceived),
		ErrorCount:        atomic.LoadInt64(&mcm.metrics.ErrorCount),
		LastCleanup:       mcm.metrics.LastCleanup,
	}
}

func (mcm *MassiveConnectionManager) addToPool(conn *Connection) {
	poolKey := "default" // Could be based on connection type/region
	
	var pool *ConnectionPool
	if p, exists := mcm.connectionPools.Load(poolKey); exists {
		pool = p.(*ConnectionPool)
	} else {
		pool = &ConnectionPool{
			connections: make([]*Connection, 0),
		}
		mcm.connectionPools.Store(poolKey, pool)
	}
	
	pool.mu.Lock()
	pool.connections = append(pool.connections, conn)
	pool.mu.Unlock()
}

func (mcm *MassiveConnectionManager) removeFromPool(conn *Connection) {
	mcm.connectionPools.Range(func(key, value interface{}) bool {
		pool := value.(*ConnectionPool)
		pool.mu.Lock()
		for i, c := range pool.connections {
			if c.ID == conn.ID {
				pool.connections = append(pool.connections[:i], pool.connections[i+1:]...)
				break
			}
		}
		pool.mu.Unlock()
		return true
	})
}

func (mcm *MassiveConnectionManager) Shutdown() {
	log.Println("🛑 Shutting down MassiveConnectionManager...")
	
	mcm.cancel()
	
	// Stop all workers
	for _, worker := range mcm.workers {
		close(worker.stopCh)
	}
	
	// Close all connections
	mcm.connections.Range(func(key, value interface{}) bool {
		conn := value.(*Connection)
		conn.Close()
		return true
	})
	
	log.Println("✅ MassiveConnectionManager shutdown complete")
}

// Simple hash function for worker distribution
func hash(s string) int {
	h := 0
	for _, c := range s {
		h = 31*h + int(c)
	}
	if h < 0 {
		h = -h
	}
	return h
}
