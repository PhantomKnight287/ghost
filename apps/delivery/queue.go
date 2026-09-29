package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
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

const claimSQL = `
UPDATE delivery_job
SET locked_until = now() + interval '60 seconds',
    claim_token  = gen_random_uuid(),
    attempts     = attempts + 1,
    updated_at   = now()
WHERE id IN (
  SELECT id FROM delivery_job
  WHERE status = 'pending' AND next_attempt_at <= now() AND locked_until < now()
  ORDER BY next_attempt_at
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, kind, claim_token, payload, endpoint_id, attempts;`

func claim(ctx context.Context, db *pgxpool.Pool, limit int) ([]Job, error) {
	rows, err := db.Query(ctx, claimSQL, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Job])
}

func complete(ctx context.Context, db *pgxpool.Pool, j Job) error {
	panic("todo")
}

func fail(ctx context.Context, db *pgxpool.Pool, j Job, sendErr error, delay time.Duration) error {
	panic("todo")
}

func backoff(attempt int, randN func(int64) int64) time.Duration {
	attempt = min(attempt, 20)
	d := min(backOffCap, backOffBase<<attempt)
	n := randN(int64(d) + 1)
	return time.Duration(n)
}

func listen(ctx context.Context, db *pgxpool.Pool, wake chan<- struct{}) {
	panic("todo")
}

func run(ctx context.Context, db *pgxpool.Pool, workers int, send sendFunc) {
	panic("todo")
}
