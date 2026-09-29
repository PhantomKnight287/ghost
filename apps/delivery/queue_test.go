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

// Tests only touch rows whose idempotency_key starts with this prefix, so they are safe on a shared dev database.
const testKeyPrefix = "test:"

// testDB refuses to run while the queue holds real pending jobs, because claim would lease them.
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

	again, err := claim(t.Context(), db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("claimed %d jobs while lease was held, want 0", len(again))
	}

	// the worker died: expire the lease instead of sleeping 60s
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

func TestListenWakesOnNotify(t *testing.T) {
	db := testDB(t)
	wake := make(chan struct{}, 1)
	go listen(t.Context(), db, wake)

	waitWake := func(what string) {
		t.Helper()
		select {
		case <-wake:
		case <-time.After(2 * time.Second):
			t.Fatalf("no wake-up for %s within 2s", what)
		}
	}

	waitWake("initial LISTEN") // proves LISTEN is registered before we NOTIFY
	if _, err := db.Exec(t.Context(), "NOTIFY delivery"); err != nil {
		t.Fatal(err)
	}
	waitWake("NOTIFY delivery")
}

// The returned stop cancels run and waits for it to drain.
func startRun(t *testing.T, db *pgxpool.Pool, workers int, send sendFunc) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		run(ctx, db, workers, nil, send) // nil wake: never fires, freed and the first claim drive it
		close(done)
	}()
	return func() {
		cancel()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			t.Fatal("run did not return after cancel")
		}
	}
}

func TestRunDeliversEveryJob(t *testing.T) {
	db := testDB(t)
	inserted := insertJobs(t, db, 20)

	var (
		mu   sync.Mutex
		sent = map[string]int{}
		all  = make(chan struct{})
	)
	send := func(ctx context.Context, j Job) error {
		time.Sleep(10 * time.Millisecond)
		mu.Lock()
		defer mu.Unlock()
		sent[j.ID]++
		if len(sent) == len(inserted) {
			close(all)
		}
		return nil
	}

	stop := startRun(t, db, 4, send) // 4 workers, 20 jobs: slots must be reused
	select {
	case <-all:
	case <-time.After(5 * time.Second):
		t.Fatal("not every job was sent within 5s")
	}
	stop()

	for id := range inserted {
		if sent[id] != 1 {
			t.Errorf("job %s sent %d times, want 1", id, sent[id])
		}
		if got := jobStatus(t, db, id); got != "succeeded" {
			t.Errorf("job %s status = %s, want succeeded", id, got)
		}
	}
}

func TestRunDrainsInFlightSendOnShutdown(t *testing.T) {
	db := testDB(t)
	inserted := insertJobs(t, db, 1)

	started := make(chan struct{})
	release := make(chan struct{})
	send := func(ctx context.Context, j Job) error {
		close(started)
		<-release
		return ctx.Err() // non-nil would mean shutdown aborted the send
	}

	stop := startRun(t, db, 1, send)
	<-started
	go func() {
		time.Sleep(100 * time.Millisecond) // shutdown begins while the send is in flight
		close(release)
	}()
	stop()

	for id := range inserted {
		if got := jobStatus(t, db, id); got != "succeeded" {
			t.Errorf("status = %s, want succeeded: in-flight send was not drained", got)
		}
	}
}

// Runs in a transaction that is rolled back, so it prunes nothing for real.
func TestPruneDeletesOnlyOldFinishedJobs(t *testing.T) {
	db := testDB(t)
	tx, err := db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())

	insert := func(status, age string) string {
		var id string
		err := tx.QueryRow(t.Context(),
			`INSERT INTO delivery_job (kind, idempotency_key, payload, status, updated_at)
			 VALUES ('email', $1 || gen_random_uuid()::text, '{}', $2, now() - $3::interval)
			 RETURNING id`, testKeyPrefix, status, age).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	oldDone := insert("succeeded", "31 days")
	oldDead := insert("dead", "31 days")
	recent := insert("succeeded", "1 day")
	oldPending := insert("pending", "31 days")

	if _, err := prune(t.Context(), tx); err != nil {
		t.Fatal(err)
	}

	exists := func(id string) bool {
		var n int
		if err := tx.QueryRow(t.Context(), `SELECT count(*) FROM delivery_job WHERE id = $1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	for id, want := range map[string]bool{oldDone: false, oldDead: false, recent: true, oldPending: true} {
		if got := exists(id); got != want {
			t.Errorf("job %s exists = %v, want %v", id, got, want)
		}
	}
}

func TestRunRoutesSendOutcomes(t *testing.T) {
	db := testDB(t)
	tests := []struct {
		name       string
		err        error
		wantStatus string
		wantDelay  time.Duration
	}{
		{"permanent failure gives up at once", permanentError{errors.New("gone")}, "dead", 0},
		{"Retry-After sets the next try", retryAfterError{errors.New("slow down"), 30 * time.Minute}, "pending", 30 * time.Minute},
		{"Retry-After is capped", retryAfterError{errors.New("slow down"), 48 * time.Hour}, "pending", backOffCap},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ids := insertJobs(t, db, 1)
			done := make(chan struct{})
			stop := startRun(t, db, 1, func(context.Context, Job) error {
				defer close(done)
				return tt.err
			})
			<-done
			stop()

			for id := range ids {
				var (
					status string
					delay  time.Duration
				)
				err := db.QueryRow(t.Context(), `SELECT status, next_attempt_at - now() FROM delivery_job WHERE id = $1`, id).Scan(&status, &delay)
				if err != nil {
					t.Fatal(err)
				}
				if status != tt.wantStatus {
					t.Errorf("status = %s, want %s", status, tt.wantStatus)
				}
				if tt.wantDelay > 0 && (delay < tt.wantDelay-time.Minute || delay > tt.wantDelay) {
					t.Errorf("next try in %v, want about %v", delay, tt.wantDelay)
				}
			}
		})
	}
}

func TestQueueCallsReturnDatabaseErrors(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	closed, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	closed.Close()
	j := Job{ID: "00000000-0000-0000-0000-000000000000", ClaimToken: "00000000-0000-0000-0000-000000000000"}

	if _, err := claim(t.Context(), closed, 1); err == nil {
		t.Error("claim on a closed pool succeeded")
	}
	if err := complete(t.Context(), closed, j); err == nil || errors.Is(err, errLeaseLost) {
		t.Errorf("complete = %v, want the database error", err)
	}
	if err := fail(t.Context(), closed, j, errors.New("x"), time.Second); err == nil || errors.Is(err, errLeaseLost) {
		t.Errorf("fail = %v, want the database error", err)
	}
	if err := giveUp(t.Context(), closed, j, errors.New("x")); err == nil || errors.Is(err, errLeaseLost) {
		t.Errorf("giveUp = %v, want the database error", err)
	}
	if _, err := prune(t.Context(), closed); err == nil {
		t.Error("prune on a closed pool succeeded")
	}

	// a canceled pruneEvery returns after its first pass instead of waiting for the tick
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	pruneEvery(ctx, closed, time.Hour)
}
