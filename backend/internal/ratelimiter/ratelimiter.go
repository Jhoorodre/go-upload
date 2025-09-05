package ratelimiter

import (
	"context"
	"sync"
	"time"
)

// RateLimiter controls the rate of operations using a token bucket algorithm
type RateLimiter struct {
	tokens     chan struct{}
	ticker     *time.Ticker
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup
	maxTokens  int
	refillRate time.Duration
}

// NewRateLimiter creates a new rate limiter
// maxTokens: maximum number of concurrent operations
// refillRate: how often tokens are added back
func NewRateLimiter(maxTokens int, refillRate time.Duration) *RateLimiter {
	ctx, cancel := context.WithCancel(context.Background())
	
	rl := &RateLimiter{
		tokens:     make(chan struct{}, maxTokens),
		ticker:     time.NewTicker(refillRate),
		ctx:        ctx,
		cancel:     cancel,
		maxTokens:  maxTokens,
		refillRate: refillRate,
	}

	// Fill initial tokens
	for i := 0; i < maxTokens; i++ {
		select {
		case rl.tokens <- struct{}{}:
		default:
			break
		}
	}

	// Start token refill goroutine
	rl.wg.Add(1)
	go rl.refillTokens()

	return rl
}

// Acquire waits for a token to become available
func (rl *RateLimiter) Acquire(ctx context.Context) error {
	select {
	case <-rl.tokens:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-rl.ctx.Done():
		return rl.ctx.Err()
	}
}

// Release returns a token to the bucket
func (rl *RateLimiter) Release() {
	select {
	case rl.tokens <- struct{}{}:
	default:
		// Bucket is full, ignore
	}
}

// refillTokens periodically adds tokens back to the bucket
func (rl *RateLimiter) refillTokens() {
	defer rl.wg.Done()
	
	for {
		select {
		case <-rl.ticker.C:
			// Try to add a token
			select {
			case rl.tokens <- struct{}{}:
			default:
				// Bucket is full
			}
		case <-rl.ctx.Done():
			rl.ticker.Stop()
			return
		}
	}
}

// Close shuts down the rate limiter
func (rl *RateLimiter) Close() {
	rl.cancel()
	rl.wg.Wait()
	close(rl.tokens)
}

// Available returns the number of available tokens
func (rl *RateLimiter) Available() int {
	return len(rl.tokens)
}