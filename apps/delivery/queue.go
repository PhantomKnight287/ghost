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

const completeSQL = `
UPDATE delivery_job
SET status = 'succeeded', last_error = NULL, locked_until = now(), updated_at = now()
WHERE id = $1 AND claim_token = $2`

func complete(ctx context.Context, db *pgxpool.Pool, j Job) error {
	tag, err := db.Exec(ctx, completeSQL, j.ID, j.ClaimToken)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errLeaseLost
	}
	return nil
}

const failSQL = `
UPDATE delivery_job SET
  status = CASE WHEN created_at < now() - interval '3 days'
                THEN 'dead'::delivery_job_status ELSE 'pending' END,
  next_attempt_at = now() + $3 * interval '1 millisecond',
  last_error = $4, locked_until = now(), updated_at = now()
WHERE id = $1 AND claim_token = $2
`

func fail(ctx context.Context, db *pgxpool.Pool, j Job, sendErr error, delay time.Duration) error {
	tag, err := db.Exec(ctx, failSQL, j.ID, j.ClaimToken, delay.Milliseconds(), sendErr.Error())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errLeaseLost
	}
	return nil
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
