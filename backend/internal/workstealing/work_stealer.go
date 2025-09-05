package workstealing

import (
	"context"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// Priority define os níveis de prioridade para tasks
type Priority int

const (
	PriorityLow Priority = iota
	PriorityNormal
	PriorityHigh
	PriorityCritical
)

// Task representa uma unidade de trabalho
type Task struct {
	ID          string
	Priority    Priority
	Execute     func() error
	CreatedAt   time.Time
	Retries     int
	MaxRetries  int
	Context     context.Context
	Cancel      context.CancelFunc
	OnComplete  func(error)
	OnProgress  func(string)
}

// WorkerPool representa um pool de workers com work stealing
type WorkerPool struct {
	// Configuration
	workers        []*Worker
	numWorkers     int
	ctx            context.Context
	cancel         context.CancelFunc
	
	// Task queues (por prioridade)
	criticalQueue  *ThreadSafeQueue
	highQueue      *ThreadSafeQueue
	normalQueue    *ThreadSafeQueue
	lowQueue       *ThreadSafeQueue
	
	// Metrics
	totalTasks     int64
	completedTasks int64
	failedTasks    int64
	activeTasks    int64
	
	// Synchronization
	wg             sync.WaitGroup
	mutex          sync.RWMutex
	started        bool
	
	// Load balancing
	loadBalancer   *LoadBalancer
}

// Worker representa um worker individual
type Worker struct {
	id             int
	pool           *WorkerPool
	localQueue     *ThreadSafeQueue
	isActive       int32
	tasksProcessed int64
	tasksStolen    int64
	lastActive     time.Time
	ctx            context.Context
}

// ThreadSafeQueue implementa uma fila thread-safe com work stealing
type ThreadSafeQueue struct {
	tasks  []*Task
	mutex  sync.RWMutex
	cond   *sync.Cond
	closed bool
}

// LoadBalancer gerencia o balanceamento de carga entre workers
type LoadBalancer struct {
	workers       []*Worker
	robin         int64
	stealAttempts int64
	successfulSteals int64
	mutex         sync.RWMutex
}

// NewThreadSafeQueue cria uma nova fila thread-safe
func NewThreadSafeQueue() *ThreadSafeQueue {
	q := &ThreadSafeQueue{
		tasks: make([]*Task, 0),
	}
	q.cond = sync.NewCond(&q.mutex)
	return q
}

// Push adiciona uma task à fila
func (q *ThreadSafeQueue) Push(task *Task) {
	q.mutex.Lock()
	defer q.mutex.Unlock()
	
	if q.closed {
		return
	}
	
	q.tasks = append(q.tasks, task)
	q.cond.Signal()
}

// Pop remove e retorna uma task da fila
func (q *ThreadSafeQueue) Pop() *Task {
	q.mutex.Lock()
	defer q.mutex.Unlock()
	
	for len(q.tasks) == 0 && !q.closed {
		q.cond.Wait()
	}
	
	if len(q.tasks) == 0 {
		return nil
	}
	
	task := q.tasks[0]
	q.tasks = q.tasks[1:]
	return task
}

// PopNonBlocking tenta remover uma task sem bloquear
func (q *ThreadSafeQueue) PopNonBlocking() *Task {
	q.mutex.Lock()
	defer q.mutex.Unlock()
	
	if len(q.tasks) == 0 {
		return nil
	}
	
	task := q.tasks[0]
	q.tasks = q.tasks[1:]
	return task
}

// Steal tenta roubar uma task do final da fila (work stealing)
func (q *ThreadSafeQueue) Steal() *Task {
	q.mutex.Lock()
	defer q.mutex.Unlock()
	
	if len(q.tasks) == 0 {
		return nil
	}
	
	// Rouba do final para minimizar conflitos
	task := q.tasks[len(q.tasks)-1]
	q.tasks = q.tasks[:len(q.tasks)-1]
	return task
}

// Size retorna o tamanho da fila
func (q *ThreadSafeQueue) Size() int {
	q.mutex.RLock()
	defer q.mutex.RUnlock()
	return len(q.tasks)
}

// Close fecha a fila
func (q *ThreadSafeQueue) Close() {
	q.mutex.Lock()
	defer q.mutex.Unlock()
	
	q.closed = true
	q.cond.Broadcast()
}

// NewLoadBalancer cria um novo load balancer
func NewLoadBalancer(workers []*Worker) *LoadBalancer {
	return &LoadBalancer{
		workers: workers,
	}
}

// GetNextWorker retorna o próximo worker em round-robin
func (lb *LoadBalancer) GetNextWorker() *Worker {
	lb.mutex.RLock()
	defer lb.mutex.RUnlock()
	
	if len(lb.workers) == 0 {
		return nil
	}
	
	index := atomic.AddInt64(&lb.robin, 1) % int64(len(lb.workers))
	return lb.workers[index]
}

// GetLeastBusyWorker retorna o worker menos ocupado
func (lb *LoadBalancer) GetLeastBusyWorker() *Worker {
	lb.mutex.RLock()
	defer lb.mutex.RUnlock()
	
	if len(lb.workers) == 0 {
		return nil
	}
	
	var leastBusy *Worker
	minTasks := int64(^uint64(0) >> 1) // Max int64
	
	for _, worker := range lb.workers {
		if atomic.LoadInt32(&worker.isActive) == 0 {
			continue // Worker inativo
		}
		
		localTasks := int64(worker.localQueue.Size())
		if localTasks < minTasks {
			minTasks = localTasks
			leastBusy = worker
		}
	}
	
	return leastBusy
}

// AttemptWorkStealing tenta roubar trabalho de outros workers
func (lb *LoadBalancer) AttemptWorkStealing(thiefWorker *Worker) *Task {
	atomic.AddInt64(&lb.stealAttempts, 1)
	
	lb.mutex.RLock()
	defer lb.mutex.RUnlock()
	
	// Tenta roubar de workers com mais tasks
	for _, victim := range lb.workers {
		if victim == thiefWorker {
			continue
		}
		
		if victim.localQueue.Size() > 1 { // Só rouba se o victim tem > 1 task
			if task := victim.localQueue.Steal(); task != nil {
				atomic.AddInt64(&lb.successfulSteals, 1)
				atomic.AddInt64(&thiefWorker.tasksStolen, 1)
				return task
			}
		}
	}
	
	return nil
}

// GetStats retorna estatísticas do load balancer
func (lb *LoadBalancer) GetStats() map[string]interface{} {
	lb.mutex.RLock()
	defer lb.mutex.RUnlock()
	
	attempts := atomic.LoadInt64(&lb.stealAttempts)
	successful := atomic.LoadInt64(&lb.successfulSteals)
	
	stealRate := float64(0)
	if attempts > 0 {
		stealRate = float64(successful) / float64(attempts) * 100
	}
	
	return map[string]interface{}{
		"steal_attempts":     attempts,
		"successful_steals":  successful,
		"steal_success_rate": stealRate,
		"active_workers":     len(lb.workers),
	}
}

// NewWorkerPool cria um novo pool de workers com work stealing
func NewWorkerPool(numWorkers int) *WorkerPool {
	if numWorkers <= 0 {
		numWorkers = runtime.NumCPU()
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	
	pool := &WorkerPool{
		numWorkers:    numWorkers,
		ctx:           ctx,
		cancel:        cancel,
		criticalQueue: NewThreadSafeQueue(),
		highQueue:     NewThreadSafeQueue(),
		normalQueue:   NewThreadSafeQueue(),
		lowQueue:      NewThreadSafeQueue(),
		workers:       make([]*Worker, numWorkers),
	}
	
	// Cria workers
	for i := 0; i < numWorkers; i++ {
		pool.workers[i] = &Worker{
			id:         i,
			pool:       pool,
			localQueue: NewThreadSafeQueue(),
			ctx:        ctx,
			lastActive: time.Now(),
		}
	}
	
	// Cria load balancer
	pool.loadBalancer = NewLoadBalancer(pool.workers)
	
	return pool
}

// Start inicia o pool de workers
func (wp *WorkerPool) Start() error {
	wp.mutex.Lock()
	defer wp.mutex.Unlock()
	
	if wp.started {
		return fmt.Errorf("worker pool already started")
	}
	
	wp.started = true
	
	// Inicia todos os workers
	for _, worker := range wp.workers {
		wp.wg.Add(1)
		go worker.run()
	}
	
	// Inicia monitoramento em background
	wp.wg.Add(1)
	go wp.monitor()
	
	return nil
}

// Submit envia uma task para o pool
func (wp *WorkerPool) Submit(task *Task) error {
	if task == nil {
		return fmt.Errorf("task cannot be nil")
	}
	
	// Define contexto se não fornecido
	if task.Context == nil {
		task.Context, task.Cancel = context.WithCancel(wp.ctx)
	}
	
	// Define timestamp se não fornecido
	if task.CreatedAt.IsZero() {
		task.CreatedAt = time.Now()
	}
	
	atomic.AddInt64(&wp.totalTasks, 1)
	
	// Envia para a fila apropriada baseada na prioridade
	switch task.Priority {
	case PriorityCritical:
		wp.criticalQueue.Push(task)
	case PriorityHigh:
		wp.highQueue.Push(task)
	case PriorityNormal:
		wp.normalQueue.Push(task)
	case PriorityLow:
		wp.lowQueue.Push(task)
	default:
		wp.normalQueue.Push(task)
	}
	
	return nil
}

// run executa o loop principal do worker
func (w *Worker) run() {
	defer w.pool.wg.Done()
	atomic.StoreInt32(&w.isActive, 1)
	defer atomic.StoreInt32(&w.isActive, 0)
	
	for {
		select {
		case <-w.ctx.Done():
			return
		default:
			task := w.getNextTask()
			if task == nil {
				// Sem trabalho, aguarda um pouco
				time.Sleep(10 * time.Millisecond)
				continue
			}
			
			w.processTask(task)
		}
	}
}

// getNextTask obtém a próxima task para processamento
func (w *Worker) getNextTask() *Task {
	// 1. Verifica fila local primeiro
	if task := w.localQueue.PopNonBlocking(); task != nil {
		return task
	}
	
	// 2. Verifica filas globais por prioridade
	if task := w.pool.criticalQueue.PopNonBlocking(); task != nil {
		return task
	}
	if task := w.pool.highQueue.PopNonBlocking(); task != nil {
		return task
	}
	if task := w.pool.normalQueue.PopNonBlocking(); task != nil {
		return task
	}
	if task := w.pool.lowQueue.PopNonBlocking(); task != nil {
		return task
	}
	
	// 3. Tenta work stealing de outros workers
	if task := w.pool.loadBalancer.AttemptWorkStealing(w); task != nil {
		return task
	}
	
	return nil
}

// processTask processa uma task individual
func (w *Worker) processTask(task *Task) {
	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("task panicked: %v", r)
			w.completeTask(task, err)
		}
	}()
	
	atomic.AddInt64(&w.pool.activeTasks, 1)
	defer atomic.AddInt64(&w.pool.activeTasks, -1)
	
	w.lastActive = time.Now()
	atomic.AddInt64(&w.tasksProcessed, 1)
	
	// Executa a task
	err := task.Execute()
	w.completeTask(task, err)
}

// completeTask completa o processamento de uma task
func (w *Worker) completeTask(task *Task, err error) {
	if err != nil {
		// Se falhou e ainda tem retries
		if task.Retries < task.MaxRetries {
			task.Retries++
			
			// Reenviar para a mesma fila com delay
			go func() {
				delay := time.Duration(task.Retries) * time.Second
				time.Sleep(delay)
				w.pool.Submit(task)
			}()
			return
		}
		
		atomic.AddInt64(&w.pool.failedTasks, 1)
	} else {
		atomic.AddInt64(&w.pool.completedTasks, 1)
	}
	
	// Callback de conclusão
	if task.OnComplete != nil {
		go task.OnComplete(err)
	}
	
	// Cancela contexto da task
	if task.Cancel != nil {
		task.Cancel()
	}
}

// monitor monitora o pool em background
func (wp *WorkerPool) monitor() {
	defer wp.wg.Done()
	
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			wp.logStats()
		case <-wp.ctx.Done():
			return
		}
	}
}

// logStats registra estatísticas do pool
func (wp *WorkerPool) logStats() {
	stats := wp.GetStats()
	fmt.Printf("[WorkerPool] %+v\n", stats)
}

// GetStats retorna estatísticas detalhadas do pool
func (wp *WorkerPool) GetStats() map[string]interface{} {
	wp.mutex.RLock()
	defer wp.mutex.RUnlock()
	
	total := atomic.LoadInt64(&wp.totalTasks)
	completed := atomic.LoadInt64(&wp.completedTasks)
	failed := atomic.LoadInt64(&wp.failedTasks)
	active := atomic.LoadInt64(&wp.activeTasks)
	
	completionRate := float64(0)
	if total > 0 {
		completionRate = float64(completed) / float64(total) * 100
	}
	
	// Worker stats
	var activeWorkers int
	var totalProcessed int64
	var totalStolen int64
	
	for _, worker := range wp.workers {
		if atomic.LoadInt32(&worker.isActive) == 1 {
			activeWorkers++
		}
		totalProcessed += atomic.LoadInt64(&worker.tasksProcessed)
		totalStolen += atomic.LoadInt64(&worker.tasksStolen)
	}
	
	// Queue sizes
	queueSizes := map[string]int{
		"critical": wp.criticalQueue.Size(),
		"high":     wp.highQueue.Size(),
		"normal":   wp.normalQueue.Size(),
		"low":      wp.lowQueue.Size(),
	}
	
	stats := map[string]interface{}{
		"total_tasks":       total,
		"completed_tasks":   completed,
		"failed_tasks":      failed,
		"active_tasks":      active,
		"completion_rate":   completionRate,
		"active_workers":    activeWorkers,
		"total_workers":     wp.numWorkers,
		"total_processed":   totalProcessed,
		"total_stolen":      totalStolen,
		"queue_sizes":       queueSizes,
	}
	
	// Load balancer stats
	if wp.loadBalancer != nil {
		lbStats := wp.loadBalancer.GetStats()
		for k, v := range lbStats {
			stats["lb_"+k] = v
		}
	}
	
	return stats
}

// Stop para o pool de workers
func (wp *WorkerPool) Stop() error {
	wp.mutex.Lock()
	defer wp.mutex.Unlock()
	
	if !wp.started {
		return nil
	}
	
	// Cancela contexto para parar todos os workers
	wp.cancel()
	
	// Fecha todas as filas
	wp.criticalQueue.Close()
	wp.highQueue.Close()
	wp.normalQueue.Close()
	wp.lowQueue.Close()
	
	for _, worker := range wp.workers {
		worker.localQueue.Close()
	}
	
	// Aguarda todos os workers terminarem
	wp.wg.Wait()
	
	wp.started = false
	return nil
}

// IsHealthy verifica se o pool está saudável
func (wp *WorkerPool) IsHealthy() bool {
	wp.mutex.RLock()
	defer wp.mutex.RUnlock()
	
	if !wp.started {
		return false
	}
	
	// Verifica se pelo menos 50% dos workers estão ativos
	activeWorkers := 0
	for _, worker := range wp.workers {
		if atomic.LoadInt32(&worker.isActive) == 1 {
			activeWorkers++
		}
	}
	
	return float64(activeWorkers)/float64(wp.numWorkers) >= 0.5
}

// GetQueueSizes retorna os tamanhos atuais das filas
func (wp *WorkerPool) GetQueueSizes() map[string]int {
	return map[string]int{
		"critical": wp.criticalQueue.Size(),
		"high":     wp.highQueue.Size(),
		"normal":   wp.normalQueue.Size(),
		"low":      wp.lowQueue.Size(),
	}
}