package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	backOffBase = 10 * time.Second
	backOffCap  = time.Hour
)

type Job struct {
	ID, Kind, ClaimToken string
	Payload              json.RawMessage
	EndpointID           *string
	Attempts             int
}

type sendFunc func(ctx context.Context, j Job) error

func claim(ctx context.Context, db *pgxpool.Pool, limit int) ([]Job, error) {
	panic("todo")
}

func complete(ctx context.Context, db *pgxpool.Pool, j Job) error {
	panic("todo")
}

func fail(ctx context.Context, db *pgxpool.Pool, j Job, sendErr error, delay time.Duration) error {
	panic("todo")
}

func backoff(attempt int, randN func(int64) int64) time.Duration {
	attempt = min(attempt, 20)
	d := min(backOffCap, backOffBase << attempt)
	n := randN(int64(d) + 1)
	return time.Duration(n)
}

func listen(ctx context.Context, db *pgxpool.Pool, wake chan<- struct{}) {
	panic("todo")
}

func run(ctx context.Context, db *pgxpool.Pool, workers int, send sendFunc) {
	panic("todo")
}
