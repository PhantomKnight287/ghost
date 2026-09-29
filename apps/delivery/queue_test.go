package main

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBackoff(t *testing.T) {
	maxRand := func(n int64) int64 { return n - 1 } // always picks the ceiling

	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{0, 10 * time.Second},
		{1, 20 * time.Second},
		{2, 40 * time.Second},
		{3, 80 * time.Second},
		{8, 2560 * time.Second},
		{9, time.Hour}, // 5120s, capped
		{30, time.Hour},
		{100, time.Hour},
	}
	for _, tt := range tests {
		got := backoff(tt.attempt, maxRand)
		if got != tt.want {
			t.Errorf("backoff(%d) = %v, want %v", tt.attempt, got, tt.want)
		}
	}
}

// Tests only touch rows whose idempotency_key starts with this prefix,
// so they are safe to run against a shared dev database.
const testKeyPrefix = "test:"

// testDB connects to TEST_DATABASE_URL, or skips the test when it is unset.
// It refuses to run if the queue holds real pending jobs, because claim
// would lease them. Cleanup deletes only the rows the test inserted.
func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	db, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}

	var real int
	err = db.QueryRow(t.Context(),
		`SELECT count(*) FROM delivery_job WHERE status = 'pending' AND idempotency_key NOT LIKE $1 || '%'`,
		testKeyPrefix).Scan(&real)
	if err != nil {
		t.Fatal(err)
	}
	if real > 0 {
		t.Fatalf("%d real pending jobs in delivery_job; refusing to run, claim would lease them", real)
	}

	t.Cleanup(func() {
		// t.Context() is already canceled when cleanup runs.
		_, err := db.Exec(context.Background(),
			`DELETE FROM delivery_job WHERE idempotency_key LIKE $1 || '%'`, testKeyPrefix)
		if err != nil {
			t.Errorf("cleanup: %v", err)
		}
		db.Close()
	})
	return db
}

// insertJobs adds n pending email jobs and returns their ids.
func insertJobs(t *testing.T, db *pgxpool.Pool, n int) map[string]bool {
	t.Helper()
	ids := make(map[string]bool, n)
	for range n {
		var id string
		err := db.QueryRow(t.Context(),
			`INSERT INTO delivery_job (kind, idempotency_key, payload)
			 VALUES ('email', $1 || gen_random_uuid()::text, '{}')
			 RETURNING id`, testKeyPrefix).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		ids[id] = true
	}
	return ids
}

func TestClaimNeverHandsOutAJobTwice(t *testing.T) {
	db := testDB(t)
	inserted := insertJobs(t, db, 100)

	var (
		mu      sync.Mutex
		claimed = map[string]int{} // id -> times claimed
		wg      sync.WaitGroup
	)
	for range 4 {
		wg.Go(func() {
			for {
				jobs, err := claim(t.Context(), db, 7)
				if err != nil {
					t.Error(err)
					return
				}
				if len(jobs) == 0 {
					return
				}
				mu.Lock()
				for _, j := range jobs {
					claimed[j.ID]++
				}
				mu.Unlock()
			}
		})
	}
	wg.Wait()

	if len(claimed) != len(inserted) {
		t.Errorf("claimed %d distinct jobs, want %d", len(claimed), len(inserted))
	}
	for id, n := range claimed {
		if n > 1 {
			t.Errorf("job %s claimed %d times", id, n)
		}
		if !inserted[id] {
			t.Errorf("claimed job %s that this test did not insert", id)
		}
	}
}

func TestClaimReclaimsAfterLeaseExpires(t *testing.T) {
	db := testDB(t)
	insertJobs(t, db, 1)

	first, err := claim(t.Context(), db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 {
		t.Fatalf("first claim got %d jobs, want 1", len(first))
	}

	// Lease is held: nobody else may take it.
	again, err := claim(t.Context(), db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("claimed %d jobs while lease was held, want 0", len(again))
	}

	// Simulate the worker dying: expire the lease instead of sleeping 60s.
	_, err = db.Exec(t.Context(),
		`UPDATE delivery_job SET locked_until = now() - interval '1 second' WHERE id = $1`, first[0].ID)
	if err != nil {
		t.Fatal(err)
	}

	second, err := claim(t.Context(), db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 || second[0].ID != first[0].ID {
		t.Fatalf("reclaim got %v, want job %s", second, first[0].ID)
	}
	if second[0].ClaimToken == first[0].ClaimToken {
		t.Error("reclaim kept the old claim_token; a stale worker could overwrite the result")
	}
	if second[0].Attempts != 2 {
		t.Errorf("attempts = %d, want 2", second[0].Attempts)
	}

	// The worker that lost its lease must not overwrite the new owner's result.
	if err := complete(t.Context(), db, first[0]); !errors.Is(err, errLeaseLost) {
		t.Errorf("complete with stale token = %v, want errLeaseLost", err)
	}
	if err := complete(t.Context(), db, second[0]); err != nil {
		t.Fatalf("complete with current token: %v", err)
	}
	if got := jobStatus(t, db, second[0].ID); got != "succeeded" {
		t.Errorf("status = %s, want succeeded", got)
	}
}

func TestFailSchedulesRetry(t *testing.T) {
	db := testDB(t)
	insertJobs(t, db, 1)
	jobs, err := claim(t.Context(), db, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("claim = %v, %v", jobs, err)
	}

	if err := fail(t.Context(), db, jobs[0], errors.New("boom"), 30*time.Second); err != nil {
		t.Fatal(err)
	}

	var (
		status, lastError string
		delay             time.Duration
	)
	err = db.QueryRow(t.Context(),
		`SELECT status, last_error, next_attempt_at - now() FROM delivery_job WHERE id = $1`,
		jobs[0].ID).Scan(&status, &lastError, &delay)
	if err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Errorf("status = %s, want pending", status)
	}
	if lastError != "boom" {
		t.Errorf("last_error = %q, want boom", lastError)
	}
	if delay < 29*time.Second || delay > 30*time.Second {
		t.Errorf("next attempt in %v, want about 30s", delay)
	}

	// Not due yet, so it must not be claimable.
	again, err := claim(t.Context(), db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Errorf("claimed %d jobs before next_attempt_at, want 0", len(again))
	}
}

func TestFailPastMaxAgeIsDead(t *testing.T) {
	db := testDB(t)
	_, err := db.Exec(t.Context(),
		`INSERT INTO delivery_job (kind, idempotency_key, payload, created_at)
		 VALUES ('email', $1 || gen_random_uuid()::text, '{}', now() - interval '4 days')`,
		testKeyPrefix)
	if err != nil {
		t.Fatal(err)
	}
	jobs, err := claim(t.Context(), db, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("claim = %v, %v", jobs, err)
	}

	if err := fail(t.Context(), db, jobs[0], errors.New("still down"), time.Second); err != nil {
		t.Fatal(err)
	}
	if got := jobStatus(t, db, jobs[0].ID); got != "dead" {
		t.Errorf("status = %s, want dead", got)
	}
}

func jobStatus(t *testing.T, db *pgxpool.Pool, id string) string {
	t.Helper()
	var s string
	if err := db.QueryRow(t.Context(), `SELECT status FROM delivery_job WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}
